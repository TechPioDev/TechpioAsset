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

# shellcheck disable=SC1090
set -a; . "./$ENV_FILE"; set +a

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
# --no-owner / --no-acl: the production roles do not exist here, and staging
# should not be handed production's role grants even if they did.
compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --no-acl --clean --if-exists < "$DUMP"

# ── One password for every account, generated here ───────────────────────────
# Hashed inside the api image so it uses the application's own argon2id
# parameters rather than a second opinion about them.
STAGING_PASSWORD="staging-$(openssl rand -base64 12 | tr -d '/+=' | head -c 12)"
HASH="$(compose run --rm --no-deps -T api node -e '
  const { hash } = require("@node-rs/argon2");
  hash(process.argv[1], { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 })
    .then((h) => process.stdout.write(h));
' "$STAGING_PASSWORD" | tr -d '\r\n')"

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
