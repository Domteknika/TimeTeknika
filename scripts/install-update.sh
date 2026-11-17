#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
expected_version='2026.11.17-react-7'
expected_previous='2026.11.17-react-6'
archive=$(realpath -- "${1:?Indiquer le fichier de mise à jour .tar.gz}")
test -f "$archive"
initial_admin="${2:?Indiquer l’identifiant du responsable à nommer administrateur}"
[[ "$initial_admin" =~ ^[a-zA-Z0-9][a-zA-Z0-9._@+-]{2,199}$ ]] || { echo "Identifiant initial invalide."; exit 1; }
if [[ "$EUID" != 0 ]]; then exec sudo bash "$0" "$archive" "$initial_admin"; fi
root=/opt/timeteknika
cd "$root"
test -f compose.yaml && test -f .env
compose=(docker compose --project-directory "$root" -f "$root/compose.yaml")
"${compose[@]}" ps --status running --services | grep -qx teknika
container=$("${compose[@]}" ps -q teknika)
old_image=$(docker inspect --format '{{.Image}}' "$container")
old_version=$(curl -fsS --max-time 10 http://127.0.0.1:4310/health | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
[[ "$old_version" == "$expected_previous" ]] || { echo "Version source inattendue : $old_version"; exit 1; }
data_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$container")
[[ -n "$data_volume" ]] || { echo 'Volume de données Docker introuvable.'; exit 1; }
mkdir -p "$root/.qa/rollback" "$root/.qa/staging"
stage=$(mktemp -d "$root/.qa/staging/react.XXXXXXXX")
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
state="$root/.qa/rollback/$expected_version-$stamp"
mkdir -m 700 "$state"
new_image="timeteknika:$expected_version-$stamp"
old_tag="timeteknika:rollback-$stamp"
switched=0
rollback() {
  local result=$?
  trap - ERR
  if [[ "$switched" == 1 ]]; then
    echo 'Échec de validation : retour à l’image précédente, base conservée.' >&2
    bash "$state/rollback.sh" || echo "Retour automatique échoué. Exécuter : sudo bash $state/rollback.sh" >&2
  fi
  echo "Installation NON VALIDÉE. Dossier de diagnostic : $state" >&2
  exit "$result"
}
trap rollback ERR

python3 - "$archive" "$stage" "$expected_version" <<'PY'
import sys, tarfile, re, json, hashlib, os
archive, stage, version = sys.argv[1:]
roots={'Dockerfile','.dockerignore','package.json','pnpm-lock.yaml','tsconfig.json','vite.config.ts','index.html','components.json'}
def valid(p):
    return p in roots or (bool(re.fullmatch(r'(server|public|scripts|src|web-assets|dist/web)/[a-zA-Z0-9_./-]+',p)) and all(x and not x.startswith('.') for x in p.split('/')))
with tarfile.open(archive,'r:gz') as tar:
    members=tar.getmembers()
    names=[m.name for m in members]
    if len(set(names))!=len(names) or any(not m.isfile() or not valid(m.name) for m in members):
        raise SystemExit('Archive refusée : chemin ou type de fichier invalide.')
    manifest=json.load(tar.extractfile('scripts/release-manifest.json'))
    if manifest.get('version')!=version or manifest.get('frontend')!='react':
        raise SystemExit('Version ou interface incorrecte.')
    files=manifest['files']
    if 'dist/web/index.html' not in files or 'scripts/Dockerfile.release' not in files:
        raise SystemExit('Livraison React incomplète.')
    if set(names)!=set(files)|{'scripts/release-manifest.json','scripts/release-files.sha256'}:
        raise SystemExit('Liste des fichiers différente du manifeste.')
    for name, expected in files.items():
        if hashlib.sha256(tar.extractfile(name).read()).hexdigest()!=expected:
            raise SystemExit('Empreinte incorrecte : '+name)
    tar.extractall(stage,filter='data')
    # The archive contains code only. Implicit directories inherit umask 077;
    # normalize code permissions for the unprivileged image user. Keep the
    # private staging root and every backup directory untouched.
    for directory, children, files in os.walk(stage):
        for child in children:
            os.chmod(os.path.join(directory, child), 0o755)
        for name in files:
            os.chmod(os.path.join(directory, name), 0o644)
PY
(cd "$stage" && sha256sum -c scripts/release-files.sha256 > "$state/files-verified.log")
# The only schema addition is user_admins. Verify the exact prior store engine.
expected_store_sha=b5e748c37790596b8f3a9a20a37d91bba4d0d6d8d1e78dd3a7bd6c489beba935
docker cp "$container:/app/server/store.mjs" "$state/live-store.mjs"
printf '%s  %s\n' "$expected_store_sha" "$state/live-store.mjs" | sha256sum -c -
for name in domain.mjs journal.mjs; do
  cmp "$root/server/$name" "$stage/server/$name"
  docker cp "$container:/app/server/$name" "$state/live-$name"
  cmp "$state/live-$name" "$stage/server/$name"
done
echo 'Construction de la nouvelle image, service actuel toujours disponible…'
docker build -f "$stage/scripts/Dockerfile.release" -t "$new_image" "$stage" > "$state/build.log" 2>&1
docker image tag "$old_image" "$old_tag"
printf 'services:\n  teknika:\n    image: %s\n    environment:\n      INITIAL_ADMIN_USERNAME: "%s"\n' "$new_image" "$initial_admin" > "$state/new-image.yaml"
printf 'services:\n  teknika:\n    image: %s\n' "$old_tag" > "$state/old-image.yaml"
code_paths=()
for path in Dockerfile .dockerignore package.json pnpm-lock.yaml tsconfig.json vite.config.ts index.html components.json server public scripts src web-assets dist; do
  [[ ! -e "$root/$path" ]] || code_paths+=("$path")
done
tar -czf "$state/code-before.tar.gz" "${code_paths[@]}"
cat > "$state/rollback.sh" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "\$EUID" == 0 ]] || exec sudo bash "\$0"
cd '$root'
tar --no-same-owner -xzf '$state/code-before.tar.gz' -C '$root'
docker compose --project-directory '$root' -f '$root/compose.yaml' -f '$state/old-image.yaml' up -d --no-build --force-recreate teknika
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:4310/health | python3 -c 'import json,sys; assert json.load(sys.stdin)["version"]=="$old_version"'; then
    echo 'Version précédente rétablie. Base actuelle conservée.'
    exit 0
  fi
  sleep 2
done
exit 1
EOF
chmod 700 "$state/rollback.sh"
echo 'Sauvegarde cohérente et test de restauration dans un conteneur isolé…'
backup_name="before-$expected_version-$stamp.sqlite"
"${compose[@]}" exec -T teknika node scripts/backup.mjs /app/data/teknika.sqlite "/app/data/backups/$backup_name" </dev/null
"${compose[@]}" cp "teknika:/app/data/backups/$backup_name" "$state/database.sqlite"
chmod 600 "$state/database.sqlite"
sha256sum "$state/database.sqlite" > "$state/database.sha256"
# Only the backup is mounted, read-only. No access to the production volume.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --user 0 --tmpfs /tmp:rw,nosuid,nodev \
  --mount "type=bind,src=$state/database.sqlite,dst=/backup.sqlite,readonly" \
  "$new_image" node scripts/verify-restored-database.mjs /backup.sqlite "$initial_admin" > "$state/restore-check.json"
owner=$(stat -c '%u:%g' "$root")
switched=1
for path in Dockerfile .dockerignore package.json pnpm-lock.yaml tsconfig.json vite.config.ts index.html components.json server public scripts src web-assets dist; do
  cp -a "$stage/$path" "$root/"
  chown -R "$owner" "$root/$path"
done
echo 'Copie validée. Bascule du service…'
docker compose --project-directory "$root" -f "$root/compose.yaml" -f "$state/new-image.yaml" up -d --no-build --force-recreate teknika
new_container=$("${compose[@]}" ps -q teknika)
new_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$new_container")
[[ "$data_volume" == "$new_volume" ]]
ready=0
for attempt in {1..30}; do
  if "${compose[@]}" exec -T teknika node scripts/verify-release.mjs </dev/null > "$state/live-check.log" 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]]
"${compose[@]}" exec -T teknika node scripts/verify-journal.mjs </dev/null > "$state/journal-check.json"
switched=0
trap - ERR
echo "INSTALLATION VALIDÉE : $expected_version"
cat "$state/restore-check.json"
cat "$state/live-check.log"
echo "Sauvegarde : $state/database.sqlite"
echo "Retour sans effacer les nouvelles saisies : sudo bash $state/rollback.sh"
