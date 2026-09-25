#!/usr/bin/env bash
#
# Deploy the API and the website to the VPS.
#
# One command, so the permission to run it can be narrow: allowing this script
# is not the same as allowing any command on the production server.
#
#   ./deploy/deploy-vps.sh              # api and web
#   ./deploy/deploy-vps.sh web          # website only - no API restart
#   ./deploy/deploy-vps.sh api          # API only
#
# What it does, in the order that matters:
#
#   1. Refuses to run on a dirty tree. Hand edits on the server are how a
#      deploy silently ships something nobody reviewed, and `git pull` would
#      either clobber them or fail halfway.
#   2. Prints the commit it is leaving, so a rollback is one command away.
#   3. BUILDS before it swaps. A build that fails then costs nothing: the
#      running containers are untouched and the site stays up.
#   4. Swaps with --no-deps, so Postgres and Redis are never restarted.
#   5. Waits for the site to answer correctly and fails loudly if it does not.
#
# Database migrations run from the API container's own start command, so they
# happen as part of step 4 and are covered by the health check in step 5.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/techpioasset}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
ENV_FILE="${ENV_FILE:-.env.prod}"
SITE="${SITE:-https://pioassets.com}"
BRANCH="${BRANCH:-main}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

# The two health-check URLs, overridable because staging sits behind basic auth.
# Pointing them at the public URL there would make nginx answer 401 for BOTH -
# and a 401 is exactly what the API check expects, so a dead API would PASS.
# Staging aims them at the container ports instead, where a 401 can only have
# come from the application.
HEALTH_WEB_URL="${HEALTH_WEB_URL:-$SITE/login}"
HEALTH_API_URL="${HEALTH_API_URL:-$SITE/api/v1/auth/me}"

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# ── Which services ───────────────────────────────────────────────────────────
#
# Only api and web. Anything else is a typo or an attempt to use this script
# as a general remote shell, and neither should reach docker.
SERVICES=("$@")
if [ "${#SERVICES[@]}" -eq 0 ]; then
  SERVICES=(api web)
fi
for svc in "${SERVICES[@]}"; do
  case "$svc" in
    api | web) ;;
    *)
      echo "deploy: '$svc' is not a deployable service. Use: api, web, or neither for both." >&2
      exit 2
      ;;
  esac
done

cd "$APP_DIR"

# ── 1. A clean tree, or nothing ──────────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "deploy: the working tree on this server has uncommitted changes." >&2
  echo "        Deploying would discard or trip over them. Showing them and stopping:" >&2
  git status --short >&2
  exit 1
fi

# ── 2. Where we are now, for the rollback ────────────────────────────────────
FROM="$(git rev-parse --short HEAD)"
echo "deploy: at $FROM ($(git log -1 --format=%s))"

git fetch --quiet origin "$BRANCH"
git merge --ff-only "origin/$BRANCH"

TO="$(git rev-parse --short HEAD)"
if [ "$FROM" = "$TO" ]; then
  echo "deploy: already at origin/$BRANCH; rebuilding anyway."
else
  echo "deploy: $FROM -> $TO"
  git log --oneline "$FROM..$TO" | sed 's/^/          /'
fi

# ── 3. Build first; a failure here changes nothing that is running ───────────
echo "deploy: building ${SERVICES[*]}"
compose build "${SERVICES[@]}"

# ── 4. Swap. --no-deps keeps Postgres and Redis running ──────────────────────
echo "deploy: starting ${SERVICES[*]}"
compose up -d --no-deps "${SERVICES[@]}"

# ── 5. Prove it came back ────────────────────────────────────────────────────
#
# Two checks, because one is not enough: the sign-in page proves the website is
# serving, and an unauthenticated /auth/me answering 401 proves the API is up
# AND still refusing strangers. A 200 there would be worse news than a 502.
echo "deploy: waiting for the site (up to ${HEALTH_TIMEOUT}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
login=""
me=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  login="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_WEB_URL" || echo 000)"
  me="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_API_URL" || echo 000)"
  if [ "$login" = "200" ] && [ "$me" = "401" ]; then
    echo "deploy: ok - login=200 auth/me=401, now at $TO"
    compose ps "${SERVICES[@]}"
    exit 0
  fi
  sleep 5
done

echo "deploy: FAILED health check - login=$login auth/me=$me" >&2
echo "        Last 40 lines from each service:" >&2
compose logs --tail=40 "${SERVICES[@]}" >&2 || true
echo "        To go back:  git reset --hard $FROM && ./deploy/deploy-vps.sh ${SERVICES[*]}" >&2
exit 1
