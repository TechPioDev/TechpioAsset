#!/usr/bin/env bash
#
# Pull TechpioAsset's nightly backups from the VPS down to local storage.
#
# The counterpart to backup-db.sh, which runs ON the VPS and leaves its output
# in /var/backups/techpioasset. This runs HERE and fetches it. Pull, not push,
# is deliberate: the VPS is given no credential or route to this machine, so a
# compromise of the VPS cannot reach, rewrite or delete the copies held here.
# That is the property an S3 push does not have unless the bucket also has
# object-lock and versioning.
#
# Relative to the hosting provider this office IS off-site, so this closes the
# gap that BACKUP_S3_* currently reports as "skipped".
#
# Usage:
#   PIOASSETS_SSH=root@vps.example.com ./pull-backups.sh
#   PIOASSETS_SSH=root@1.2.3.4 DEST=/mnt/backups/pioassets KEEP_DAYS=14 ./pull-backups.sh
set -euo pipefail

SSH_TARGET="${PIOASSETS_SSH:?set PIOASSETS_SSH=user@host}"
REMOTE_DIR="${REMOTE_DIR:-/var/backups/techpioasset}"
# Default destination, resolved for whichever shell this runs under: WSL mounts
# Windows drives at /mnt/c, Git Bash at /c. rsync ships with WSL and NOT with Git
# for Windows, so WSL is the intended runtime.
if [ -z "${DEST:-}" ]; then
  if   [ -d /mnt/c ]; then DEST=/mnt/c/PioBackups/pioassets
  elif [ -d /c ];     then DEST=/c/PioBackups/pioassets
  else                     DEST="$HOME/PioBackups/pioassets"
  fi
fi
KEEP_DAYS="${KEEP_DAYS:-14}"
SSH_KEY="${SSH_KEY:-}"

SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
[ -n "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")

mkdir -p "$DEST"
ts() { date -Is; }

# --ignore-existing, and deliberately NO --delete: the VPS rotates at KEEP_DAYS,
# and a deletion there (or an attacker emptying that directory) must never
# propagate into the only other copy. Local retention is pruned separately below.
echo "$(ts) pulling from ${SSH_TARGET}:${REMOTE_DIR} -> ${DEST}"
rsync -az --ignore-existing --partial --info=stats2 \
  -e "ssh ${SSH_OPTS[*]}" \
  "${SSH_TARGET}:${REMOTE_DIR}/" "${DEST}/"

# Verify what landed. A corrupt archive discovered at restore time is a disaster;
# discovered now it is merely a re-run.
fail=0
for f in "$DEST"/techpioasset_*.sql.gz "$DEST"/techpioasset-uploads_*.tar.gz; do
  [ -e "$f" ] || continue
  if ! gzip -t "$f" 2>/dev/null || [ ! -s "$f" ]; then
    echo "$(ts) CORRUPT, removing so the next run refetches it: $f" >&2
    rm -f "$f"; fail=1
  fi
done

# Pair check: a dump whose matching uploads archive is missing cannot restore to
# anything usable, so say so loudly rather than reporting a clean run.
for dump in "$DEST"/techpioasset_*.sql.gz; do
  [ -e "$dump" ] || continue
  stamp="$(basename "$dump" .sql.gz)"; stamp="${stamp#techpioasset_}"
  if [ ! -f "$DEST/techpioasset-uploads_${stamp}.tar.gz" ]; then
    echo "$(ts) ORPHAN: $stamp has a database dump but NO uploads archive" >&2
    fail=1
  fi
done

# Prune locally, only ever whole pairs, so retention can never strand a half.
find "$DEST" -name 'techpioasset_*.sql.gz'         -type f -mtime "+${KEEP_DAYS}" -delete
find "$DEST" -name 'techpioasset-uploads_*.tar.gz' -type f -mtime "+${KEEP_DAYS}" -delete

pairs=$(ls -1 "$DEST"/techpioasset_*.sql.gz 2>/dev/null | wc -l)
echo "$(ts) done: ${pairs} dump(s) held, $(du -sh "$DEST" | cut -f1) on disk"
[ "$fail" -eq 0 ] || { echo "$(ts) COMPLETED WITH ERRORS" >&2; exit 1; }
