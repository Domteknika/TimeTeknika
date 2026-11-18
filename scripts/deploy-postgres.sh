#!/usr/bin/env bash
# Run on the existing server: sudo bash STAGING/scripts/deploy-postgres.sh STAGING
# No database is transferred off the server, cleared, or replaced in place.
set -Eeuo pipefail
umask 077
expected_previous='2026.11.17-react-7'
expected_version='2026.11.17-postgres-1'
root=/opt/timeteknika
private=/var/lib/timeteknika-postgres-migration
[[ "$EUID" == 0 ]] || { echo 'Exécuter cette commande avec sudo sur le serveur.' >&2; exit 1; }
[[ $# == 1 ]] || { echo 'Indiquer le dossier de livraison décompressé.' >&2; exit 1; }
# Compose gives inherited shell variables priority over explicit env files.
# Never let a caller's development URL or project redirect this migration.
unset DATABASE_URL POSTGRES_USER POSTGRES_PASSWORD TEKNIKA_APP_IMAGE TEKNIKA_DATABASE \
  TEKNIKA_MIGRATOR_PASSWORD TEKNIKA_APP_PASSWORD COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_ENV_FILES
source_stage=$(realpath -e -- "$1")
[[ -d "$source_stage" && "$source_stage" != "$root" && "$source_stage" != / ]] || exit 1
for command in docker python3 curl tar sha256sum flock; do command -v "$command" >/dev/null; done
[[ -d "$root" && ! -L "$root" && -f "$root/compose.yaml" && -f "$root/.env" ]] || exit 1
for path in compose.override.yaml compose.override.yml docker-compose.override.yml docker-compose.override.yaml .env.postgres; do
  [[ ! -e "$root/$path" && ! -L "$root/$path" ]] || { echo "Migration initiale refusée : $path existe déjà. Aucun import automatique supplémentaire." >&2; exit 1; }
done
[[ ! -L "$private" ]] || exit 1
install -d -m 700 -o root -g root "$private"
exec 9>"$private/deploy.lock"
flock -n 9 || { echo 'Une migration est déjà en cours.' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
nonce=$(python3 -c 'import secrets; print(secrets.token_hex(8))')
state="$private/$stamp-$nonce"
mkdir -m 700 "$state"
stage="$state/release"
mkdir -m 700 "$stage"
published=0
stopped=0
installed=0
smoke=''
scratch=''
postgres=''
phase='validation de la livraison'

# Validate and copy only the manifested release into a root-private directory.
python3 - "$source_stage" "$stage" "$expected_version" <<'PY'
import hashlib, json, os, pathlib, re, shutil, sys
source, target = map(pathlib.Path, sys.argv[1:3])
manifest = json.loads((source/'scripts/release-manifest.json').read_text())
roots = {'Dockerfile','.dockerignore','package.json','pnpm-lock.yaml','tsconfig.json','tsconfig.db.json','drizzle.config.ts','vite.config.ts','index.html','components.json','deploy/compose.postgres.yaml'}
def valid(name):
    return name in roots or (bool(re.fullmatch(r'(server|public|scripts|src|web-assets|drizzle|dist/web)/[a-zA-Z0-9_./-]+', name)) and all(part and not part.startswith('.') for part in name.split('/')))
assert manifest.get('version') == sys.argv[3] and manifest.get('frontend') == 'react', 'Version de livraison incorrecte'
files = manifest['files']
required = {'scripts/Dockerfile.release','scripts/import-sqlite.mjs','scripts/migrate-database.mjs','scripts/verify-postgres-migration.mjs','scripts/backup-postgres.sh','scripts/prepare-sqlite-backup.py','deploy/compose.postgres.yaml','dist/web/index.html'}
assert required <= files.keys(), 'Livraison PostgreSQL incomplète'
for name in [*files, 'scripts/release-manifest.json', 'scripts/release-files.sha256']:
    assert valid(name), 'Chemin hors livraison'
    path = source/name
    assert path.is_file() and not any(p.is_symlink() for p in [path, *path.parents] if p != source.parent), 'Lien symbolique interdit'
    body = path.read_bytes()
    if name in files:
        assert hashlib.sha256(body).hexdigest() == files[name], 'Empreinte incorrecte : '+name
    destination = target/name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(body)
    destination.chmod(0o644)
for directory, children, _ in os.walk(target):
    for child in children: os.chmod(os.path.join(directory, child), 0o755)
PY

# Discover the live service by its Compose working-directory label before
# choosing a project name; the server may use a custom name in its launcher.
container=$(docker ps --filter label=com.docker.compose.service=teknika \
  --filter "label=com.docker.compose.project.working_dir=$root" --format '{{.ID}}')
[[ "$container" =~ ^[a-f0-9]{12,64}$ ]] || { echo 'Un unique conteneur de production est requis.' >&2; exit 1; }
project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || exit 1
base=(docker compose --project-directory "$root" --project-name "$project" --env-file "$root/.env" -f "$root/compose.yaml")
old_image=$(docker inspect --format '{{.Image}}' "$container")
data_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$container")
[[ "$old_image" =~ ^sha256:[a-f0-9]{64}$ && "$data_volume" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || exit 1
docker inspect "$container" > "$state/old-container.json"
python3 - "$state/old-container.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))[0]
env = dict(item.split('=', 1) for item in c['Config']['Env'])
assert c['State']['Running'] and not env.get('DATABASE_URL') and env.get('DEMO_MODE', '0') == '0', 'La source doit être le service SQLite normal'
assert env.get('DATA_DIR', '/app/data') == '/app/data', 'Emplacement SQLite inattendu'
assert any(m['Destination']=='/app/data' and m['Type']=='volume' for m in c['Mounts'])
PY
health_version() {
  curl -fsS --max-time 5 http://127.0.0.1:4310/health | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])'
}
[[ "$(health_version)" == "$expected_previous" ]] || { echo 'Version du serveur source inattendue.' >&2; exit 1; }
new_image="timeteknika:$expected_version-$stamp-$nonce"
printf 'services:\n  teknika:\n    image: %s\n' "$old_image" > "$state/old-image.yaml"
code_paths=()
for path in Dockerfile .dockerignore package.json pnpm-lock.yaml tsconfig.json tsconfig.db.json drizzle.config.ts vite.config.ts index.html components.json server public scripts src web-assets drizzle dist deploy/compose.postgres.yaml; do
  [[ ! -e "$root/$path" ]] || code_paths+=("$path")
done
tar -czf "$state/code-before.tar.gz" -C "$root" "${code_paths[@]}"

rollback() {
  local status=$?
  trap - EXIT ERR INT TERM
  [[ $status != 0 ]] || return 0
  set +e
  [[ -z "$smoke" ]] || docker rm -f "$smoke" >> "$state/cleanup.log" 2>&1
  if [[ "$published" == 0 && "$stopped" == 1 ]]; then
    echo 'Validation interrompue : rétablissement du service SQLite, données originales conservées.' >&2
    if [[ "$installed" == 1 ]]; then
      tar -xzf "$state/code-before.tar.gz" -C "$root"
      # Only these two files were introduced by this attempt; base config is intact.
      rm -f -- "$root/compose.override.yaml" "$root/.env.postgres"
    fi
    "${base[@]}" -f "$state/old-image.yaml" up -d --no-build --no-deps --force-recreate teknika >> "$state/rollback.log" 2>&1
    local healthy=0
    for attempt in {1..30}; do
      if [[ "$(health_version 2>/dev/null)" == "$expected_previous" ]]; then healthy=1; break; fi
      sleep 2
    done
    [[ "$healthy" == 1 ]] && echo 'Service SQLite rétabli.' >&2 || echo 'Le redémarrage SQLite nécessite une intervention ; consulter rollback.log.' >&2
  elif [[ "$published" == 1 ]]; then
    echo 'La publication PostgreSQL a commencé : aucun retour automatique vers SQLite, pour préserver les nouvelles écritures.' >&2
  fi
  echo "Migration non validée (étape : $phase). Diagnostics privés sur le serveur : $state" >&2
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

set_phase() {
  phase=$1
  printf 'Étape : %s\n' "$phase"
}
set_phase 'construction de la livraison'
echo 'Construction de la livraison pendant que le service actuel reste disponible…'
docker build -f "$stage/scripts/Dockerfile.release" -t "$new_image" "$stage" > "$state/build.log" 2>&1

# A separate persistent secret file permits safe retries without resetting a cluster.
credentials="$private/credentials.env"
if [[ ! -e "$credentials" ]]; then
  if docker volume inspect teknika-postgres >/dev/null 2>&1; then
    echo 'Un volume PostgreSQL existe sans les identifiants de cette migration ; arrêt sans modification.' >&2
    exit 1
  fi
  python3 - "$credentials" <<'PY'
import os, secrets, sys
fd = os.open(sys.argv[1], os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    out.write('POSTGRES_USER=postgres\n')
    for name in ['POSTGRES_PASSWORD','TEKNIKA_MIGRATOR_PASSWORD','TEKNIKA_APP_PASSWORD']:
        out.write(name+'='+secrets.token_hex(32)+'\n')
PY
fi
database="tt_production_${stamp,,}_$nonce"
scratch="tt_verify_$nonce"
restore="tt_verify_restore_$nonce"
python3 - "$credentials" "$state" "$new_image" "$database" "$scratch" "$restore" "$project" <<'PY'
import os, pathlib, re, stat, sys
from urllib.parse import urlunsplit
path, directory, image, database, scratch, restore, project = sys.argv[1:]
s = os.lstat(path)
assert stat.S_ISREG(s.st_mode) and s.st_uid == 0 and stat.S_IMODE(s.st_mode) == 0o600, 'Identifiants non privés'
values = dict(line.split('=',1) for line in pathlib.Path(path).read_text().splitlines())
assert set(values) == {'POSTGRES_USER','POSTGRES_PASSWORD','TEKNIKA_MIGRATOR_PASSWORD','TEKNIKA_APP_PASSWORD'} and values['POSTGRES_USER']=='postgres'
assert all(re.fullmatch('[a-f0-9]{64}', value) for key,value in values.items() if key!='POSTGRES_USER')
def url(role, password, name): return urlunsplit(('postgresql',role+':'+password+'@postgres:5432','/'+name,'',''))
def write(name, data):
    p=pathlib.Path(directory)/name
    p.write_text(''.join(key+'='+value+'\n' for key,value in data.items()))
    p.chmod(0o600)
runtime = dict(values)
runtime.update(COMPOSE_PROJECT_NAME=project, TEKNIKA_APP_IMAGE=image, TEKNIKA_DATABASE=database, DATABASE_URL=url('timeteknika_app',values['TEKNIKA_APP_PASSWORD'],database))
write('runtime.env', runtime)
for name, target in [('trial.env',scratch),('restore.env',restore),('production.env',database)]:
    write(name, {'DATABASE_URL':url('timeteknika_migrator',values['TEKNIKA_MIGRATOR_PASSWORD'],target),'APP_DATABASE_URL':url('timeteknika_app',values['TEKNIKA_APP_PASSWORD'],target)})
# Names and passwords are generated/validated alphanumeric values, never user SQL.
sql=[]
for role, key in [('timeteknika_migrator','TEKNIKA_MIGRATOR_PASSWORD'),('timeteknika_app','TEKNIKA_APP_PASSWORD')]:
    sql.append(f"DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '{values[key]}'; END IF; END $$;")
    sql.append(f"DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{role}' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR NOT rolcanlogin)) THEN RAISE EXCEPTION 'Role privileges unexpected'; END IF; END $$;")
(pathlib.Path(directory)/'roles.sql').write_text('\n'.join(sql)+'\n')
PY
set_phase 'préparation PostgreSQL'
compose=(docker compose --project-directory "$root" --project-name "$project" --env-file "$root/.env" --env-file "$state/runtime.env" -f "$root/compose.yaml" -f "$stage/deploy/compose.postgres.yaml")
"${compose[@]}" pull postgres > "$state/postgres-pull.log" 2>&1
"${compose[@]}" up -d --no-deps postgres > "$state/postgres-start.log" 2>&1
postgres=$("${compose[@]}" ps -q postgres)
[[ "$postgres" =~ ^[a-f0-9]{12,64}$ ]] || exit 1
healthy=0
for attempt in {1..60}; do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$postgres")" == healthy ]]; then healthy=1; break; fi
  sleep 3
done
[[ "$healthy" == 1 ]] || { echo 'PostgreSQL ne devient pas disponible.' >&2; exit 1; }
network=$(docker inspect --format '{{range $name, $value := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$postgres")
[[ "$network" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Un unique réseau Docker est requis.' >&2; exit 1; }
docker exec -i "$postgres" psql -Xq -U postgres -d postgres -v ON_ERROR_STOP=1 < "$state/roles.sql" > "$state/roles.log" 2>&1
rm -f -- "$state/roles.sql"

run_cli() {
  local envfile=$1; shift
  docker run --rm --init --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --user 0 --tmpfs /tmp:rw,nosuid,nodev --env-file "$envfile" \
    --mount "type=bind,src=$state,dst=/migration,readonly" "$new_image" node "$@"
}
create_database() {
  local name=$1
  [[ "$name" =~ ^tt_(verify|production)_[a-z0-9_]+$ ]] || return 1
  # CREATE, without IF NOT EXISTS: never reuse or clear another populated target.
  printf 'CREATE DATABASE %s OWNER timeteknika_migrator;\nREVOKE CONNECT ON DATABASE %s FROM PUBLIC;\nGRANT CONNECT ON DATABASE %s TO timeteknika_migrator, timeteknika_app;\n' "$name" "$name" "$name" |
    docker exec -i "$postgres" psql -Xq -U postgres -d postgres -v ON_ERROR_STOP=1
}
grant_application() {
  local name=$1
  [[ "$name" =~ ^tt_(verify|production)_[a-z0-9_]+$ ]] || return 1
  docker exec -i "$postgres" psql -Xq -U postgres -d "$name" -v ON_ERROR_STOP=1 <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, drizzle TO timeteknika_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO timeteknika_app;
REVOKE UPDATE, DELETE ON public.audit, public.event_log FROM timeteknika_app;
GRANT SELECT ON drizzle.__drizzle_migrations TO timeteknika_app;
SQL
}
import_backup() {
  local name=$1 envfile=$2 prefix=$3
  set_phase "$prefix : création de la base dédiée"
  create_database "$name" > "$state/$prefix-create.log" 2>&1
  set_phase "$prefix : contrôle de la sauvegarde SQLite"
  run_cli "$envfile" scripts/import-sqlite.mjs --source "/migration/$prefix.sqlite" --check-source > "$state/$prefix-source.json"
  set_phase "$prefix : migrations du schéma PostgreSQL"
  run_cli "$envfile" scripts/migrate-database.mjs > "$state/$prefix-schema.json"
  set_phase "$prefix : import et comparaison des données"
  run_cli "$envfile" scripts/import-sqlite.mjs --source "/migration/$prefix.sqlite" --checkpoint "/migration/$prefix-source.json" > "$state/$prefix-import.json"
  set_phase "$prefix : permissions applicatives"
  grant_application "$name" > "$state/$prefix-grants.log" 2>&1
}
prepare_snapshot() {
  local prefix=$1
  [[ "$prefix" == trial || "$prefix" == final ]] || return 1
  local snapshot="$state/$prefix.sqlite"
  [[ -f "$snapshot" && ! -L "$snapshot" && "$(stat -c '%h' "$snapshot")" == 1 ]] || return 1
  chown root:root "$snapshot"
  chmod 600 "$snapshot"
  set_phase "$prefix : préparation de la sauvegarde pour la lecture seule"
  # SQLite backup() preserves WAL mode in its destination header. Normalize only
  # this frozen private copy before run_cli mounts it read-only. This step never
  # opens the original database; the importer keeps its read-only source access.
  python3 "$stage/scripts/prepare-sqlite-backup.py" "$snapshot" > "$state/$prefix-prepared.json"
  sha256sum "$snapshot" > "$snapshot.sha256"
}

set_phase 'trial : sauvegarde cohérente SQLite'
echo 'Sauvegarde SQLite cohérente et essai complet sur une base PostgreSQL isolée…'
trial_backup="postgres-trial-$stamp-$nonce.sqlite"
docker exec "$container" node scripts/backup.mjs /app/data/teknika.sqlite "/app/data/backups/$trial_backup" > "$state/trial-backup.log" 2>&1
docker cp "$container:/app/data/backups/$trial_backup" "$state/trial.sqlite" >> "$state/trial-backup.log" 2>&1
prepare_snapshot trial
import_backup "$scratch" "$state/trial.env" trial
# Exercise the native backup/restore path before the concurrency probes append
# trial-only events. The restored copy must match every source table and hash.
set_phase 'trial : sauvegarde et restauration PostgreSQL'
docker exec "$postgres" pg_dump -U postgres -d "$scratch" --format=custom --no-owner --no-acl > "$state/trial-postgres.dump"
[[ -s "$state/trial-postgres.dump" ]] || exit 1
docker exec -i "$postgres" pg_restore --list < "$state/trial-postgres.dump" > "$state/trial-postgres-contents.log"
create_database "$restore" > "$state/restore-create.log" 2>&1
docker exec -i "$postgres" pg_restore --exit-on-error --no-owner --no-acl -U postgres \
  --role=timeteknika_migrator -d "$restore" < "$state/trial-postgres.dump" > "$state/restore.log" 2>&1
grant_application "$restore" > "$state/restore-grants.log" 2>&1
set_phase 'trial : comparaison de la restauration PostgreSQL'
run_cli "$state/restore.env" scripts/verify-postgres-migration.mjs /migration/trial.sqlite /migration/trial-import.json > "$state/restore-verification.json"
[[ "$restore" == "tt_verify_restore_$nonce" && "$nonce" =~ ^[a-f0-9]{16}$ ]] || exit 1
docker exec "$postgres" dropdb -U postgres --if-exists "$restore" > "$state/restore-cleanup.log" 2>&1
set_phase 'trial : vérification des connexions concurrentes'
run_cli "$state/trial.env" scripts/verify-postgres-migration.mjs /migration/trial.sqlite /migration/trial-import.json --concurrency > "$state/trial-verification.json"
# Only the randomly named scratch database created by this attempt is removed.
[[ "$scratch" == "tt_verify_$nonce" && "$nonce" =~ ^[a-f0-9]{16}$ ]] || exit 1
docker exec "$postgres" dropdb -U postgres --if-exists "$scratch" > "$state/trial-cleanup.log" 2>&1
scratch=''

set_phase 'final : arrêt SQLite et sauvegarde des dernières écritures'
echo 'Essai validé. Arrêt bref du service pour capturer les dernières écritures…'
stopped=1
"${base[@]}" stop -t 30 teknika > "$state/stop.log" 2>&1
[[ "$(docker inspect --format '{{.State.Running}}' "$container")" == false ]] || exit 1
[[ -z "$(docker ps -q --filter "volume=$data_volume")" ]] || { echo 'Un autre conteneur utilise le volume SQLite ; migration arrêtée.' >&2; exit 1; }
docker run --rm --network none --read-only --cap-drop ALL --cap-add DAC_READ_SEARCH --security-opt no-new-privileges:true \
  --user 0 --tmpfs /tmp:rw,nosuid,nodev \
  --mount "type=volume,src=$data_volume,dst=/app/data,readonly" \
  --mount "type=bind,src=$state,dst=/migration" \
  "$old_image" node --input-type=module -e '
    import { copyFile, mkdir } from "node:fs/promises";
    await mkdir("/migration/frozen-source", { mode: 0o700 });
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      try { await copyFile("/app/data/teknika.sqlite" + suffix, "/migration/frozen-source/teknika.sqlite" + suffix); }
      catch (error) { if (!suffix || error.code !== "ENOENT") throw error; }
    }
  ' > "$state/final-copy.log" 2>&1
# WAL-mode databases can need writable sidecars even for a read-only connection.
# All writers are stopped: copy the database AND every present sidecar first,
# then use SQLite backup in this private writable copy, never on the live volume.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --user 0 --tmpfs /tmp:rw,nosuid,nodev \
  --mount "type=bind,src=$state,dst=/migration" \
  "$old_image" node scripts/backup.mjs /migration/frozen-source/teknika.sqlite /migration/final.sqlite > "$state/final-backup.log" 2>&1
prepare_snapshot final
import_backup "$database" "$state/production.env" final
set_phase 'final : comparaison complète avant démarrage'
run_cli "$state/production.env" scripts/verify-postgres-migration.mjs /migration/final.sqlite /migration/final-import.json > "$state/final-verification.json"

# Real application boot on the imported database, without publishing a host port.
set_phase 'final : démarrage privé de l’application'
echo 'Contrôle du serveur PostgreSQL avant ouverture aux utilisateurs…'
smoke="tt-pg-smoke-$nonce"
"${compose[@]}" run -d --no-deps --name "$smoke" teknika > "$state/private-start.log" 2>&1
healthy=0
for attempt in {1..30}; do
  if docker exec "$smoke" node --input-type=module -e 'const r=await fetch("http://127.0.0.1:4310/health"); const h=await r.json(); if(!r.ok||h.version!==process.argv[1])process.exit(1)' "$expected_version" > "$state/private-health.log" 2>&1; then healthy=1; break; fi
  sleep 2
done
docker logs "$smoke" > "$state/private-app.log" 2>&1
[[ "$healthy" == 1 ]] || exit 1
docker stop -t 30 "$smoke" >> "$state/private-start.log" 2>&1
docker rm "$smoke" >> "$state/private-start.log" 2>&1
smoke=''
run_cli "$state/production.env" scripts/verify-journal.mjs --postgres /migration/final-import.json > "$state/private-journal.json"

set_phase 'final : installation de la livraison et sauvegarde PostgreSQL'
installed=1
python3 - "$stage" "$root" <<'PY'
import json, os, pathlib, shutil, sys
source, target = map(pathlib.Path, sys.argv[1:])
owner = target.stat()
files = list(json.loads((source/'scripts/release-manifest.json').read_text())['files'])
files += ['scripts/release-manifest.json','scripts/release-files.sha256']
for name in files:
    destination = target/name
    assert not any(p.is_symlink() for p in [destination, *destination.parents] if p != target.parent), 'Lien symbolique cible interdit'
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source/name, destination)
    destination.chmod(0o644)
    os.chown(destination, owner.st_uid, owner.st_gid)
    directory = destination.parent
    while directory != target:
        directory.chmod(0o755)
        os.chown(directory, owner.st_uid, owner.st_gid)
        directory = directory.parent
PY
install -m 600 -o root -g root "$state/runtime.env" "$root/.env.postgres"
install -m 644 -o root -g root "$stage/deploy/compose.postgres.yaml" "$root/compose.override.yaml"
# A native PostgreSQL backup is established before any user can write to it.
bash "$root/scripts/backup-postgres.sh" > "$state/postgres-backup.log" 2>&1

set_phase 'publication PostgreSQL'
echo 'Publication de la version PostgreSQL…'
# From this point an application startup may accept writes. Never roll back to
# the now-stale SQLite automatically, even if the following health check fails.
published=1
"${compose[@]}" up -d --no-build --no-deps --force-recreate teknika > "$state/public-start.log" 2>&1
healthy=0
for attempt in {1..30}; do
  if [[ "$(health_version 2>/dev/null)" == "$expected_version" ]]; then healthy=1; break; fi
  sleep 2
done
[[ "$healthy" == 1 ]] || { echo 'Version publiée mais contrôle HTTP non concluant ; consulter les journaux sans restaurer SQLite.' >&2; exit 1; }
run_cli "$state/production.env" scripts/verify-journal.mjs --postgres /migration/final-import.json > "$state/published-journal.json"
printf '%s\n' "$expected_version" > "$state/COMPLETE"
echo "Migration PostgreSQL validée : $expected_version"
echo "Sauvegarde SQLite, rapports et diagnostics privés conservés sur le serveur : $state"
echo 'Les utilisateurs, sessions, temps et journaux ont été comparés intégralement avant le démarrage.'
