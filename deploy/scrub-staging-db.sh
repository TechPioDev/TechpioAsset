#!/usr/bin/env bash
#
# Restore production into staging, then make it safe to look at.
#
#   ./deploy/scrub-staging-db.sh /var/backups/techpioasset/latest.dump
#
# The order is the whole point. The staging API is NOT started until the scrub
# has committed, because an API booted against an unscrubbed restore can mail
# and notify real people within seconds of coming up - mail_settings in the
# database beats MAIL_PROVIDER=mock in the environment.
#
#   1. Staging containers down (nothing can read a half-scrubbed database).
#   2. Drop and recreate the staging database.
#   3. Restore the production dump into it.
#   4. Scrub - refuses if the database is not a staging one, or if the schema
#      has grown a personal column the scrub does not handle.
#   5. Only now, bring staging up.
#
# Every account ends up with ONE password, generated here at random and printed
# once. It is never stored in the repo and never typed by anyone.
set -euo pipefail

DUMP="${1:-}"
APP_DIR="${APP_DIR:-/opt/techpioasset-staging}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
ENV_FILE="${ENV_FILE:-.env.staging}"

if [ -z "$DUMP" ]; then
  echo "usage: $0 <path-to-production-dump>" >&2
  exit 2
fi
if [ ! -r "$DUMP" ]; then
  echo "scrub: cannot read dump '$DUMP'" >&2
  exit 2
fi

cd "$APP_DIR"
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# Read the two values this script needs, rather than sourcing the whole file.
# Sourcing executes it: MAIL_FROM="PioAssets Staging <no-reply@staging.invalid>"
# is a perfectly good env-file line and a shell redirection, and the script died
# on it. An env file is data, and reading it as data is also the safer habit.
env_value() {
  sed -n "s/^$1=//p" "./$ENV_FILE" | head -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}
POSTGRES_DB="$(env_value POSTGRES_DB)"
POSTGRES_USER="$(env_value POSTGRES_USER)"

if [ -z "$POSTGRES_DB" ] || [ -z "$POSTGRES_USER" ]; then
  echo "scrub: $ENV_FILE is missing POSTGRES_DB or POSTGRES_USER." >&2
  exit 2
fi

# ── A second lock on the door ────────────────────────────────────────────────
# The SQL refuses a database whose name lacks "staging"; refuse here too, before
# anything is dropped. The SQL guard cannot save a database this script has
# already destroyed.
case "$POSTGRES_DB" in
  *staging*) ;;
  *)
    echo "scrub: POSTGRES_DB is '$POSTGRES_DB' - refusing. This script only ever touches a staging database." >&2
    exit 1
    ;;
esac

echo "scrub: stopping staging app containers"
compose stop api web 2>/dev/null || true
compose up -d postgres
compose exec -T postgres sh -c 'until pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; do sleep 1; done'

echo "scrub: recreating $POSTGRES_DB"
compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE);" \
  -c "CREATE DATABASE \"$POSTGRES_DB\";"

echo "scrub: restoring $(basename "$DUMP")"

# The nightly backup is GZIPPED PLAIN SQL - deploy/backup-db.sh runs pg_dump
# without -Fc - so psql reads it and pg_restore cannot. Sniffed rather than
# assumed, because the two fail in opposite and equally confusing ways: given
# plain SQL, pg_restore says the input is not a valid archive; given an
# archive, psql spews binary at the terminal.
decompress() {
  case "$DUMP" in
    *.gz) gunzip -c "$DUMP" ;;
    *) cat "$DUMP" ;;
  esac
}

if decompress | head -c 5 | grep -q 'PGDMP'; then
  # --no-owner / --no-acl: the production roles do not exist here, and staging
  # should not be handed production's role grants even if they did.
  decompress | compose exec -T postgres     pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl
else
  # ON_ERROR_STOP so a half-applied dump stops here rather than being scrubbed
  # and served as though it were whole.
  decompress | compose exec -T postgres     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --quiet
fi

# ── One password for every account, generated here ───────────────────────────
# Hashed inside the api image so it uses the application's own argon2id
# parameters rather than a second opinion about them.
STAGING_PASSWORD="staging-$(openssl rand -base64 12 | tr -d '/+=' | head -c 12)"
# Build first, separately. `compose run` builds on demand and prints the build
# log to STDOUT, which the command substitution below would otherwise capture
# as the hash - the first real run came back with "#1 [internal] load local
# bake definition" where an argon2 digest should have been.
echo "scrub: preparing the api image"
compose build api >/dev/null

# And take the hash by marker rather than trusting the whole of stdout, because
# compose narrates container lifecycle there too.
HASH="$(compose run --rm --no-deps -T api node -e '
  const { hash } = require("@node-rs/argon2");
  hash(process.argv[1], { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 })
    .then((h) => console.log("ARGON2HASH:" + h));
' "$STAGING_PASSWORD" 2>/dev/null | sed -n 's/^.*ARGON2HASH://p' | tail -1)"

case "$HASH" in
  '$argon2id$'*) ;;
  *) echo "scrub: could not generate a password hash - got '${HASH:0:40}'" >&2; exit 1 ;;
esac

echo "scrub: scrubbing"
compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v ON_ERROR_STOP=1 -v "password_hash=$HASH" < ./deploy/staging-scrub.sql

echo "scrub: starting staging"
compose up -d

cat <<MSG

─────────────────────────────────────────────────────────────────────────────
 Staging password for EVERY account: $STAGING_PASSWORD
 Shown once. Not stored anywhere. Run this script again to get a new one.
─────────────────────────────────────────────────────────────────────────────
MSG
