#!/usr/bin/env bash
# Read-only post-migration audit. No import, restore, restart, grant or repair.
set -Eeuo pipefail
umask 077
root=/opt/timeteknika
private=/var/lib/timeteknika-postgres-migration
backups=/var/backups/timeteknika
expected_version='2026.11.17-postgres-1'
phase='précontrôles'
fail() { echo "Audit PostgreSQL interrompu (étape : $phase). Aucune importation ni restauration n’a été lancée." >&2; }
trap fail ERR
[[ "$EUID" == 0 ]] || { echo 'Exécuter cet audit avec sudo sur le serveur.' >&2; exit 1; }
[[ $# == 0 ]] || { echo 'Cet audit ne prend aucun argument.' >&2; exit 1; }
for command in docker python3 curl sha256sum cmp stat readlink; do command -v "$command" >/dev/null; done
script_dir=$(cd -- "$(dirname -- "$(readlink -f -- "$0")")" && pwd)
helper="$script_dir/audit-postgres-migration.mjs"
[[ -f "$helper" && ! -L "$helper" ]]
[[ -d "$root" && ! -L "$root" && -d "$private" && ! -L "$private" && -d "$backups" && ! -L "$backups" ]]
[[ -f "$root/.env" && -f "$root/compose.yaml" && -f "$root/compose.override.yaml" ]]
[[ -f "$root/.env.postgres" && ! -L "$root/.env.postgres" ]]
[[ "$(stat -c '%u:%a' "$root/.env.postgres")" == 0:600 ]]

# Compose prioritizes inherited shell variables over --env-file. Only use the
# private configuration produced by the migration installer.
unset DATABASE_URL POSTGRES_USER POSTGRES_PASSWORD TEKNIKA_APP_IMAGE TEKNIKA_DATABASE \
  TEKNIKA_MIGRATOR_PASSWORD TEKNIKA_APP_PASSWORD COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_ENV_FILES
source "$root/.env.postgres"
[[ ${COMPOSE_PROJECT_NAME:-} =~ ^[a-z0-9][a-z0-9_-]*$ ]]
[[ ${TEKNIKA_DATABASE:-} =~ ^tt_production_[a-z0-9_]+$ ]]
[[ ${TEKNIKA_APP_IMAGE:-} =~ ^timeteknika:2026\.11\.17-postgres-1-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{16}$ ]]
[[ -n ${DATABASE_URL:-} ]]
export DATABASE_URL TEKNIKA_DATABASE TEKNIKA_APP_IMAGE COMPOSE_PROJECT_NAME

phase='sélection des rapports de la base active'
matches=()
shopt -s nullglob
for candidate in "$private"/*; do
  [[ -d "$candidate" && ! -L "$candidate" ]] || continue
  [[ "${candidate##*/}" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{16}$ ]] || continue
  [[ -f "$candidate/runtime.env" && ! -L "$candidate/runtime.env" ]] || continue
  if cmp -s "$candidate/runtime.env" "$root/.env.postgres"; then matches+=("$candidate"); fi
done
[[ ${#matches[@]} == 1 ]]
state=${matches[0]}
[[ "$(stat -c '%u:%a' "$state")" == 0:700 ]]

phase='intégrité de la livraison installée'
(
  cd "$root"
  sha256sum --quiet -c scripts/release-files.sha256
)

phase='version HTTP et conteneurs actifs'
version=$(curl -fsS --max-time 10 http://127.0.0.1:4310/health |
  python3 -c 'import json,sys; h=json.load(sys.stdin); assert h["status"]=="ok"; print(h["version"])')
[[ "$version" == "$expected_version" ]]
compose=(docker compose --project-directory "$root" --project-name "$COMPOSE_PROJECT_NAME" \
  --env-file "$root/.env" --env-file "$root/.env.postgres" -f "$root/compose.yaml" -f "$root/compose.override.yaml")
container=$("${compose[@]}" ps -q teknika)
postgres=$("${compose[@]}" ps -q postgres)
[[ "$container" =~ ^[a-f0-9]{12,64}$ && "$postgres" =~ ^[a-f0-9]{12,64}$ ]]
# Inspect in a pipe: no credentials in argv, disk output, or terminal output.
# The temporary audit container uses the exact immutable image currently live.
metadata=$(docker inspect "$container" "$postgres" | python3 -c '
import json, os, re, sys
app, database = json.load(sys.stdin)
expected_project = os.environ["COMPOSE_PROJECT_NAME"]
for item, service in [(app,"teknika"),(database,"postgres")]:
    assert item["State"]["Running"]
    labels = item["Config"]["Labels"]
    assert labels["com.docker.compose.project"] == expected_project
    assert labels["com.docker.compose.service"] == service
assert app["Config"]["Image"] == os.environ["TEKNIKA_APP_IMAGE"]
environment = dict(value.split("=",1) for value in app["Config"]["Env"])
assert environment.get("DATABASE_URL") == os.environ["DATABASE_URL"]
assert environment.get("DEMO_MODE", "0") == "0"
assert database["State"]["Health"]["Status"] == "healthy"
assert not any((database["HostConfig"].get("PortBindings") or {}).values())
networks = list(database["NetworkSettings"]["Networks"])
assert len(networks) == 1 and networks[0] in app["NetworkSettings"]["Networks"]
assert re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", networks[0])
assert re.fullmatch(r"sha256:[a-f0-9]{64}", app["Image"])
print(app["Image"])
print(networks[0])
' 2>/dev/null)
image=${metadata%%$'\n'*}
network=${metadata#*$'\n'}
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ && "$network" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]

phase='comparaison des sauvegardes, rapports et données PostgreSQL'
checkpoint_mount=()
checkpoint_argument=()
checkpoint="$script_dir/external-journal-checkpoint.json"
if [[ -e "$checkpoint" || -L "$checkpoint" ]]; then
  [[ -f "$checkpoint" && ! -L "$checkpoint" ]]
  checkpoint_mount=(--mount "type=bind,src=$checkpoint,dst=/external-journal-checkpoint.json,readonly")
  checkpoint_argument=(/external-journal-checkpoint.json)
fi
# Only the application URL reaches this process, not administrator or migration
# credentials. All mounted files are read-only; SQLite scratch space is in tmpfs.
docker run --rm --init --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --user 0 --tmpfs /tmp:rw,nosuid,nodev --env DATABASE_URL --env TEKNIKA_DATABASE \
  --mount "type=bind,src=$state,dst=/migration,readonly" \
  --mount "type=bind,src=$backups,dst=/backups,readonly" \
  --mount "type=bind,src=$helper,dst=/app/scripts/audit-postgres-migration.mjs,readonly" \
  "${checkpoint_mount[@]}" \
  "$image" node scripts/audit-postgres-migration.mjs /migration /backups "${checkpoint_argument[@]}"
