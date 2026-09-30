#!/usr/bin/env bash
#
# Reset the basic-auth password on staging.pioassets.com.
#
#   ./deploy/staging-gate-password.sh
#
# The gate keeps crawlers and mistyped-URL visitors off a second copy of the
# company's data. It is not the security boundary - that is TLS plus the
# application's own login - so the password is built to be TYPED rather than to
# resist attack.
#
# The first one was `openssl rand -base64 18` filtered to alphanumerics, which
# produced aJuWGBcP6ZvE2aX8Zz. It contains J/j, Z/z, B/8 and 2/a: four pairs a
# person can read one way and type the other. It was rejected at the browser
# prompt twice while being provably correct on the server, which is the worst
# kind of wrong - nothing to debug, because nothing was broken.
#
# So: one charset, no confusable pairs. Crockford's alphabet drops I, L, O and
# U for exactly this reason; this drops more - B/8, G/6, S/5 and Z/2 are just
# as easy to read wrongly off a screen. Upper case only, so there is no case to
# get wrong either. 24 characters over 8 places is ample for a gate that is not
# the security boundary.
set -euo pipefail

HTPASSWD_FILE="${HTPASSWD_FILE:-/etc/nginx/.htpasswd-staging}"
RECORD_FILE="${RECORD_FILE:-/root/staging-basic-auth.txt}"
USERNAME="${USERNAME:-pioassets}"

# No 0/O, 1/I/L, U/V, B/8, G/6, S/5, Z/2.
ALPHABET='23456789ACDEFHJKMNPQRTWXY'
group() {
  local out=''
  for _ in 1 2 3 4; do
    out+="${ALPHABET:$((RANDOM % ${#ALPHABET})):1}"
  done
  printf '%s' "$out"
}

PASSWORD="PioAssets-$(group)-$(group)"

if command -v htpasswd >/dev/null 2>&1; then
  htpasswd -b -c "$HTPASSWD_FILE" "$USERNAME" "$PASSWORD" >/dev/null 2>&1
else
  # apache2-utils is not installed everywhere; nginx reads APR1 either way.
  printf '%s:%s\n' "$USERNAME" "$(openssl passwd -apr1 "$PASSWORD")" > "$HTPASSWD_FILE"
fi

# Not optional: as root:root the nginx worker cannot read the file and EVERY
# request becomes a 500, which reads as a broken application rather than a
# broken permission.
chown root:www-data "$HTPASSWD_FILE"
chmod 640 "$HTPASSWD_FILE"

umask 077
printf 'staging.pioassets.com basic auth\nuser: %s\npass: %s\n' "$USERNAME" "$PASSWORD" > "$RECORD_FILE"
chmod 600 "$RECORD_FILE"

nginx -t >/dev/null 2>&1 || { echo "gate: nginx config test failed; not reloading" >&2; exit 1; }
systemctl reload nginx

cat <<MSG

─────────────────────────────────────────────────────────────────────────────
 staging.pioassets.com
   user: $USERNAME
   pass: $PASSWORD
 Also written to $RECORD_FILE (mode 600).

 Changing it invalidates whatever the browser had cached, so the next visit
 prompts fresh instead of silently resending a credential that no longer works.
─────────────────────────────────────────────────────────────────────────────
MSG
