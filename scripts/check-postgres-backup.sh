#!/usr/bin/env bash
# Verify a copy on the independently backed-up storage, using disposable PostgreSQL.
set -Eeuo pipefail
umask 077
[[ $# == 2 ]] || { echo 'Usage: check-postgres-backup.sh DOSSIER_COPIES_HORS_SERVEUR IMAGE_APPLICATION' >&2; exit 2; }
directory=$(realpath -e -- "$1")
image=$2
shopt -s nullglob
archives=("$directory"/timeteknika-postgres-*.dump)
(( ${#archives[@]} )) || { echo 'Aucune sauvegarde PostgreSQL trouvée.' >&2; exit 1; }
archive=${archives[-1]}
name=${archive##*/}
[[ -f "$archive" && -f "$archive.sha256" && ! -L "$archive" && ! -L "$archive.sha256" ]]
[[ "$name" =~ ^timeteknika-postgres-([0-9]{8})T([0-9]{6})[0-9]*Z\.dump$ ]] || exit 1
day=${BASH_REMATCH[1]}
hour=${BASH_REMATCH[2]}
created=$(date -u -d "${day:0:4}-${day:4:2}-${day:6:2} ${hour:0:2}:${hour:2:2}:${hour:4:2}" +%s)
age=$(( $(date -u +%s) - created ))
max_hours=${MAX_BACKUP_AGE_HOURS:-48}
[[ "$max_hours" =~ ^[1-9][0-9]{0,3}$ ]]
(( age >= 0 && age <= max_hours * 3600 )) || { echo "Copie trop ancienne ou date invalide : $name" >&2; exit 1; }
read -r expected _ < "$archive.sha256"
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
printf '%s  %s\n' "$expected" "$archive" | sha256sum --status -c -
# The temporary database is reachable only via its isolated loopback interface.
container=$(docker run -d --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-bookworm)
trap 'docker rm --force --volumes "$container" >/dev/null' EXIT
for attempt in {1..60}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -q; then break; fi
  sleep 1
done
docker exec "$container" createdb -h 127.0.0.1 -U postgres rehearsal
docker exec -i "$container" pg_restore -h 127.0.0.1 -U postgres -d rehearsal --exit-on-error --no-owner --no-acl < "$archive"
docker run --rm --network "container:$container" -e DATABASE_URL=postgresql://postgres@127.0.0.1/rehearsal \
  "$image" node scripts/verify-journal.mjs --postgres
printf 'Restauration et journal vérifiés pour %s (%s).\n' "$name" "$expected"
