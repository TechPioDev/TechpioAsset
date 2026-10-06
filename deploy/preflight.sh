#!/usr/bin/env bash
#
# Deploy preflight for the TechpioAsset production stack (v2.8 S3).
#
# Born from the 2026-08-03 incident (docs/incident-2026-08-03-rls-switch.md):
# a production credential was "verified" over a path that could not fail, so a
# bad value became a crash loop instead of an aborted change.
#
# The governing rule here: A CHECK THAT CANNOT PROVE ITS CLAIM FAILS THE
# DEPLOY. There is no "probably fine" branch — that is precisely how the
# incident happened.
#
# Usage (on the VPS, from /opt/techpioasset):
#   deploy/preflight.sh              # check the current configuration
#   deploy/preflight.sh --verbose    # show each check's evidence
#
# Exit code 0 means every check proved its claim. Anything else means do not
# deploy until you understand why.
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/techpioasset}"
VERBOSE=0
[[ "${1:-}" == "--verbose" ]] && VERBOSE=1
cd "$APP_DIR"

DC="docker compose -f $APP_DIR/docker-compose.vps.yml --env-file $APP_DIR/.env.prod"
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; [[ $VERBOSE == 1 && -n "${2:-}" ]] && printf '        %s\n' "$2"; return 0; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [[ -n "${2:-}" ]] && printf '        %s\n' "$2"; return 0; }
note() { printf '  ----  %s\n' "$1"; }

envval() { grep -E "^$1=" .env.prod 2>/dev/null | head -1 | sed "s/^$1=//"; }
dburl_user() { printf '%s' "$1" | sed -E 's#.*://([^:]+):.*#\1#'; }
dburl_pw()   { printf '%s' "$1" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#'; }

echo "TechpioAsset deploy preflight — $(date -Is)"
echo

# ── 1. The serving credential, over the path the APPLICATION uses ────────────
# The incident in one check: pg_hba ships `127.0.0.1/32 trust`, so a psql test
# from inside the postgres container succeeds WITHOUT checking the password.
# This deliberately connects over the docker network (host `postgres`), which
# is what the api container does and where scram-sha-256 actually applies.
SERVE_URL="$(envval DATABASE_URL)"
if [[ -z "$SERVE_URL" ]]; then
  bad "DATABASE_URL is set" "nothing to serve with"
else
  SERVE_USER="$(dburl_user "$SERVE_URL")"
  SERVE_PW="$(dburl_pw "$SERVE_URL")"
  DBNAME="$(envval POSTGRES_DB)"
  if $DC exec -T -e PGPASSWORD="$SERVE_PW" postgres \
       psql -qtAX -U "$SERVE_USER" -h postgres -d "$DBNAME" -c 'SELECT 1' </dev/null >/dev/null 2>&1; then
    ok "serving credential authenticates over the real network path" "user=$SERVE_USER host=postgres (scram-sha-256, not the 127.0.0.1 trust shortcut)"
  else
    bad "serving credential authenticates over the real network path" \
        "user=$SERVE_USER cannot log in via host 'postgres'. THIS IS THE INCIDENT. Do not restart the api container."
  fi
fi

# ── 2. Migrations still have an owner-capable connection ─────────────────────
MIGRATE_URL="$(envval MIGRATE_DATABASE_URL)"
if [[ -z "$MIGRATE_URL" ]]; then
  if [[ "$(dburl_user "$SERVE_URL")" == "$(envval POSTGRES_USER)" ]]; then
    ok "migrations have an owner connection" "MIGRATE_DATABASE_URL unset, but DATABASE_URL is still the owner"
  else
    bad "migrations have an owner connection" \
        "DATABASE_URL is a restricted role and MIGRATE_DATABASE_URL is unset: migrate-on-start will fail at the next deploy"
  fi
else
  MIG_USER="$(dburl_user "$MIGRATE_URL")"
  if $DC exec -T -e PGPASSWORD="$(dburl_pw "$MIGRATE_URL")" postgres \
       psql -qtAX -U "$MIG_USER" -h postgres -d "$(envval POSTGRES_DB)" \
       -c "SELECT has_database_privilege('$MIG_USER', current_database(), 'CREATE')" </dev/null 2>/dev/null | grep -q '^t$'; then
    ok "migrations have an owner connection" "user=$MIG_USER holds CREATE on the database"
  else
    bad "migrations have an owner connection" "user=$MIG_USER cannot authenticate or lacks CREATE"
  fi
fi

# ── 3. RLS posture is coherent ───────────────────────────────────────────────
RLS="$(envval RLS_ENFORCE)"
if [[ "$RLS" == "true" || "$RLS" == "1" ]]; then
  BYPASS="$($DC exec -T -e PGPASSWORD="$(envval POSTGRES_PASSWORD)" postgres \
    psql -qtAX -U "$(envval POSTGRES_USER)" -d "$(envval POSTGRES_DB)" \
    -c "SELECT rolbypassrls FROM pg_roles WHERE rolname='$(dburl_user "$SERVE_URL")'" </dev/null 2>/dev/null | tr -d '[:space:]')"
  if [[ "$BYPASS" == "f" ]]; then
    ok "RLS enforcement is real" "the serving role cannot bypass row-level security"
  else
    bad "RLS enforcement is real" \
        "RLS_ENFORCE=true but the serving role reports rolbypassrls='$BYPASS' — enforcement is theatre"
  fi
else
  note "RLS_ENFORCE is off — tenant isolation rests on the application layer alone"
fi

# ── 4. A backup exists, and is recent ────────────────────────────────────────
NEWEST="$(ls -1t /var/backups/techpioasset/techpioasset_*.sql.gz 2>/dev/null | head -1)"
if [[ -z "$NEWEST" ]]; then
  bad "a recent backup exists" "no dump found in /var/backups/techpioasset — deploying now risks an unrecoverable mistake"
else
  AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST") ) / 3600 ))
  if (( AGE_H <= 26 )); then
    ok "a recent backup exists" "$(basename "$NEWEST"), ${AGE_H}h old"
  else
    bad "a recent backup exists" "newest dump is ${AGE_H}h old ($(basename "$NEWEST")) — take a fresh one before deploying"
  fi
fi

# ── 5. Off-site copy configured (v2.8 S1) ────────────────────────────────────
#
# This used to pass on a non-empty BACKUP_S3_BUCKET alone, and so printed
# "PASS  backups are shipped off-site" on a server where the bucket name was a
# placeholder, no credentials existed, and every nightly run had logged
# "off-site SKIPPED". A green tick on the one failure that loses data for good.
#
# The uploader (apps/api/src/backup/backup-storage.ts, targetFromEnv) needs the
# bucket AND both keys, and returns null - "no destination configured" - if any
# one is missing. This now asks the same question, then asks the LOG whether
# last night actually shipped: configuration is a plan, the log is evidence.
OFFSITE_BUCKET="$(envval BACKUP_S3_BUCKET)"
OFFSITE_KEY="$(envval BACKUP_S3_ACCESS_KEY_ID)"
OFFSITE_SECRET="$(envval BACKUP_S3_SECRET_ACCESS_KEY)"
LAST_OFFSITE="$(grep -E "off-site (ok|SKIPPED|failed)" /var/log/techpioasset-backup.log 2>/dev/null | tail -1)"

if [[ -z "$OFFSITE_BUCKET" && -z "$OFFSITE_KEY" && -z "$OFFSITE_SECRET" ]]; then
  note "no off-site backup destination configured — the local copy is the only copy"
elif [[ -z "$OFFSITE_BUCKET" || -z "$OFFSITE_KEY" || -z "$OFFSITE_SECRET" ]]; then
  OFFSITE_STATE="bucket=${OFFSITE_BUCKET:-<unset>}"
  [[ -n "$OFFSITE_KEY" ]]    && OFFSITE_STATE="$OFFSITE_STATE, access key set" || OFFSITE_STATE="$OFFSITE_STATE, access key MISSING"
  [[ -n "$OFFSITE_SECRET" ]] && OFFSITE_STATE="$OFFSITE_STATE, secret set"     || OFFSITE_STATE="$OFFSITE_STATE, secret MISSING"
  warn "off-site backup is HALF configured - nothing is being shipped" \
       "$OFFSITE_STATE. The uploader needs all three and skips without them, so the local copy is still the only copy."
elif [[ "$LAST_OFFSITE" == *"off-site ok"* ]]; then
  ok "backups are shipped off-site" "bucket=$OFFSITE_BUCKET; last run: $LAST_OFFSITE"
else
  bad "backups are shipped off-site" \
      "credentials are present but the last nightly run did not ship: ${LAST_OFFSITE:-<no off-site line in /var/log/techpioasset-backup.log>}"
fi

# ── 6. Containers healthy right now ──────────────────────────────────────────
if [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health/ready)" == "200" ]]; then
  ok "the API is healthy before we touch anything" "/health/ready returned 200"
else
  bad "the API is healthy before we touch anything" "/health/ready is not 200 — fix the current state before layering a deploy on top"
fi

echo
if (( FAIL > 0 )); then
  printf '\033[31m%d check(s) failed, %d passed. DO NOT DEPLOY.\033[0m\n' "$FAIL" "$PASS"
  exit 1
fi
printf '\033[32mAll %d checks passed. Safe to deploy.\033[0m\n' "$PASS"
