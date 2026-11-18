#!/usr/bin/env bash
# Update the React interface on the existing PostgreSQL application.
# The previous image and the same database are retained for rollback.
set -Eeuo pipefail
umask 077
root=/opt/timeteknika
previous=2026.11.17-postgres-1
version=2026.11.17-postgres-2
[[ $EUID == 0 && $# == 1 ]] || { echo 'Utiliser sudo bash scripts/install-ui-update.sh DOSSIER_LIVRAISON.' >&2; exit 1; }
# sudo has already authenticated through its controlling terminal. Docker's
# interactive stdin must not retain that terminal while output is redirected.
exec </dev/null
source_stage=$(realpath -e -- "$1")
[[ -d "$source_stage" && "$source_stage" != "$root" ]]
[[ -f "$root/.env.postgres" && ! -L "$root/.env.postgres" && $(stat -c '%u:%a' "$root/.env.postgres") == 0:600 ]]
unset DATABASE_URL COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_ENV_FILES TEKNIKA_APP_IMAGE
source "$root/.env.postgres"
[[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]]
export DATABASE_URL COMPOSE_PROJECT_NAME
install -d -m 700 -o root -g root /var/lib/timeteknika-updates
exec 9>/var/lib/timeteknika-updates/update.lock
flock -n 9 || { echo 'Une mise à jour est déjà en cours.' >&2; exit 1; }
state=$(mktemp -d /var/lib/timeteknika-updates/react.XXXXXXXX)
stage="$state/release"
mkdir -m 700 "$stage"
compose=(docker compose --project-directory "$root" --project-name "$COMPOSE_PROJECT_NAME" --env-file "$root/.env" --env-file "$root/.env.postgres" -f "$root/compose.yaml" -f "$root/compose.override.yaml")
health() { curl -fsS --max-time 5 http://127.0.0.1:4310/health | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["status"]=="ok"; print(r["version"])'; }
[[ $(health) == "$previous" ]] || { echo 'Version source inattendue ; aucune mise à jour.' >&2; exit 1; }
container=$("${compose[@]}" ps -q teknika)
[[ "$container" =~ ^[a-f0-9]{12,64}$ ]]
metadata=$(docker inspect "$container" | python3 -c '
import json, os, re, sys
c=json.load(sys.stdin)[0]
assert c["State"]["Running"]
env=dict(v.split("=",1) for v in c["Config"]["Env"])
assert env.get("DATABASE_URL")==os.environ["DATABASE_URL"] and env.get("DEMO_MODE","0")=="0"
assert c["Config"]["Labels"]["com.docker.compose.project"]==os.environ["COMPOSE_PROJECT_NAME"]
networks=list(c["NetworkSettings"]["Networks"])
assert len(networks)==1 and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*",networks[0])
print(c["Image"]); print(networks[0])
' 2>/dev/null)
old_image=${metadata%%$'\n'*}
network=${metadata#*$'\n'}
[[ "$old_image" =~ ^sha256:[a-f0-9]{64}$ ]]
(cd "$root" && sha256sum --quiet -c scripts/release-files.sha256)

# Copy a verified release privately. Reject any backend, dependency, migration
# or other public-file change: this installer does not perform database upgrades.
python3 - "$source_stage" "$stage" "$root" "$version" <<'PY'
import hashlib,json,os,pathlib,re,sys
source,target,current=map(pathlib.Path,sys.argv[1:4])
new=json.loads((source/'scripts/release-manifest.json').read_text())
old=json.loads((current/'scripts/release-manifest.json').read_text())
roots={'Dockerfile','.dockerignore','package.json','pnpm-lock.yaml','tsconfig.json','tsconfig.db.json','drizzle.config.ts','vite.config.ts','index.html','components.json','deploy/compose.postgres.yaml'}
def allowed(name):
    return name in roots or (bool(re.fullmatch(r'(server|public|scripts|src|web-assets|drizzle|dist/web)/[a-zA-Z0-9_./-]+',name)) and all(p and not p.startswith('.') for p in name.split('/')))
def protected(name):
    return name in {'package.json','pnpm-lock.yaml','scripts/backup-postgres.sh','deploy/compose.postgres.yaml'} or name.startswith(('server/','drizzle/')) or (name.startswith('public/') and name!='public/release.js')
assert new['version']==sys.argv[4] and new['frontend']=='react'
assert {k:v for k,v in old['files'].items() if protected(k)}=={k:v for k,v in new['files'].items() if protected(k)}, 'Modification hors interface refusée'
assert {'dist/web/index.html','public/release.js'}<=new['files'].keys()
for name in [*new['files'],'scripts/release-manifest.json','scripts/release-files.sha256']:
    assert allowed(name), 'Chemin non autorisé'
    path=source/name
    assert path.is_file() and not any(p.is_symlink() for p in [path,*path.parents]), 'Lien interdit'
    body=path.read_bytes()
    if name in new['files']: assert hashlib.sha256(body).hexdigest()==new['files'][name], 'Empreinte incorrecte'
    out=target/name; out.parent.mkdir(parents=True,exist_ok=True); out.write_bytes(body); out.chmod(0o644)
for directory,children,_ in os.walk(target):
    for child in children: os.chmod(os.path.join(directory,child),0o755)
PY
cp -- "$root/.env.postgres" "$state/previous.env"
tar -czf "$state/code-before.tar.gz" -C "$root" Dockerfile .dockerignore package.json pnpm-lock.yaml tsconfig.json tsconfig.db.json drizzle.config.ts vite.config.ts index.html components.json deploy/compose.postgres.yaml server public scripts src web-assets drizzle dist
installed=0
switched=0
smoke=''
rollback() {
  result=$?
  trap - EXIT INT TERM
  [[ $result != 0 ]] || return 0
  set +e
  [[ -z "$smoke" ]] || docker rm -f "$smoke" >> "$state/cleanup.log" 2>&1
  if [[ $installed == 1 ]]; then
    tar -xzf "$state/code-before.tar.gz" -C "$root"
    install -m 600 -o root -g root "$state/previous.env" "$root/.env.postgres"
  fi
  if [[ $switched == 1 ]]; then
    restored=0
    if "${compose[@]}" -f "$state/previous-image.yaml" up -d --no-build --no-deps --force-recreate teknika > "$state/rollback.log" 2>&1; then
      for attempt in {1..30}; do
        if [[ $(health 2>/dev/null) == "$previous" ]]; then restored=1; break; fi
        sleep 2
      done
    fi
    if [[ $restored == 1 ]]; then
      echo 'Retour à l’image précédente validé sur la même base PostgreSQL.' >&2
    else
      echo 'Retour à l’image précédente non confirmé ; intervention nécessaire. Base PostgreSQL conservée.' >&2
    fi
  fi
  echo "Mise à jour non validée. Diagnostics privés : $state" >&2
  exit "$result"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
base_tag="timeteknika:ui-base-${state##*.}"
docker image tag "$old_image" "$base_tag"
printf 'services:\n  teknika:\n    image: %s\n' "$base_tag" > "$state/previous-image.yaml"
new_image="timeteknika:$version-$(date -u +%Y%m%dT%H%M%SZ)"
cat > "$state/Dockerfile.ui" <<EOF
FROM $base_tag
USER root
COPY --chown=node:node dist/web /app/dist/web
COPY --chown=node:node public/release.js /app/public/release.js
COPY --chown=node:node scripts /app/scripts
RUN find /app/dist/web /app/scripts -type d -exec chmod 755 {} + && find /app/dist/web /app/scripts -type f -exec chmod 644 {} + && chmod 644 /app/public/release.js
USER node
EOF
echo 'Construction de l’interface, service actuel disponible…'
docker build -f "$state/Dockerfile.ui" -t "$new_image" "$stage" > "$state/build.log" 2>&1
echo 'Interface construite. Sauvegarde PostgreSQL…'
bash "$root/scripts/backup-postgres.sh" > "$state/backup.log" 2>&1
echo 'Sauvegarde terminée. Vérification du journal et de l’interface…'
docker exec "$container" node scripts/verify-journal.mjs --postgres > "$state/before-journal.json"
printf 'services:\n  teknika:\n    image: %s\n' "$new_image" > "$state/new-image.yaml"
smoke="tt-ui-check-${state##*.}"
"${compose[@]}" -f "$state/new-image.yaml" run -d --no-deps --name "$smoke" teknika > "$state/smoke.log" 2>&1
healthy=0
for attempt in {1..30}; do
  if docker exec "$smoke" node --input-type=module -e 'const r=await fetch("http://127.0.0.1:4310/health");const h=await r.json();if(!r.ok||h.version!==process.argv[1])process.exit(1)' "$version" >> "$state/smoke.log" 2>&1; then healthy=1; break; fi
  sleep 2
done
[[ $healthy == 1 ]]
docker exec "$smoke" node scripts/verify-release.mjs http://127.0.0.1:4310 >> "$state/smoke.log" 2>&1
docker stop -t 30 "$smoke" >> "$state/smoke.log" 2>&1
docker rm "$smoke" >> "$state/smoke.log" 2>&1
smoke=''
installed=1
python3 - "$stage" "$root" "$state/previous.env" "$state/new.env" "$new_image" <<'PY'
import json,os,pathlib,shutil,sys
source,target=map(pathlib.Path,sys.argv[1:3]); owner=target.stat()
files=[*json.loads((source/'scripts/release-manifest.json').read_text())['files'],'scripts/release-manifest.json','scripts/release-files.sha256']
for name in files:
    out=target/name
    assert not any(p.is_symlink() for p in [out,*out.parents]), 'Lien cible interdit'
    out.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(source/name,out); out.chmod(0o644); os.chown(out,owner.st_uid,owner.st_gid)
    parent=out.parent
    while parent!=target:
        parent.chmod(0o755); os.chown(parent,owner.st_uid,owner.st_gid); parent=parent.parent
lines=pathlib.Path(sys.argv[3]).read_text().splitlines()
assert sum(line.startswith('TEKNIKA_APP_IMAGE=') for line in lines)==1
pathlib.Path(sys.argv[4]).write_text('\n'.join('TEKNIKA_APP_IMAGE='+sys.argv[5] if line.startswith('TEKNIKA_APP_IMAGE=') else line for line in lines)+'\n')
PY
install -m 600 -o root -g root "$state/new.env" "$root/.env.postgres"
echo 'Publication de l’interface corrigée…'
switched=1
"${compose[@]}" -f "$state/new-image.yaml" up -d --no-build --no-deps --force-recreate teknika > "$state/start.log" 2>&1
healthy=0
for attempt in {1..30}; do
  if [[ $(health 2>/dev/null) == "$version" ]]; then healthy=1; break; fi
  sleep 2
done
[[ $healthy == 1 ]]
docker run --rm --init --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 0 \
  --env DATABASE_URL --mount "type=bind,src=$state,dst=/update,readonly" "$new_image" \
  node scripts/verify-journal.mjs --postgres /update/before-journal.json > "$state/after-journal.json"
printf '%s\n' "$version" > "$state/COMPLETE"
echo "Mise à jour validée : $version. Base PostgreSQL conservée et journal vérifié."
