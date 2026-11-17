#!/usr/bin/env bash
set -Eeuo pipefail

expected_version='2026.11.16-journal-1'
archive=${1:?Indiquer le fichier de mise à jour .tar.gz}
cd /opt/timeteknika
archive=$(realpath -- "$archive")
test -f compose.yaml && test -f .env
test -f "$archive"
sudo -v
sudo docker compose ps --status running --services | grep -qx teknika

mkdir -p .qa/rollback .qa/staging
stage=$(mktemp -d /opt/timeteknika/.qa/staging/update.XXXXXXXX)
stamp=$(date +%Y%m%d-%H%M%S)
backup="/opt/timeteknika/.qa/rollback/avant-${expected_version}-${stamp}.tar.gz"
trap 'printf "\nInstallation NON VALIDÉE (ligne %s). Le volume de données est conservé.\nCode précédent : %s\n" "$LINENO" "$backup" >&2' ERR

# Only regular code files from the prepared package may be extracted.
tar -tzf "$archive" > "$stage/files.txt"
while IFS= read -r name; do
  [[ "$name" =~ ^(public|server|scripts)/[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { echo "Chemin inattendu : $name" >&2; exit 1; }
done < "$stage/files.txt"
tar -tvzf "$archive" | awk 'substr($1,1,1)!="-" {bad=1} END {exit bad}'
tar --no-same-owner -xzf "$archive" -C "$stage"
grep -Fq "APP_VERSION='$expected_version'" "$stage/public/release.js"
(cd "$stage" && sha256sum -c scripts/release-files.sha256)

echo 'Sauvegarde de la base active et du code actuel…'
sudo docker compose exec -T teknika node scripts/backup.mjs </dev/null
tar -czf "$backup" server public scripts
echo 'Installation du code et reconstruction de l’image…'
cp -a "$stage/public/." public/
cp -a "$stage/server/." server/
cp -a "$stage/scripts/." scripts/
sudo docker compose build teknika
sudo docker compose up -d --no-build --force-recreate teknika

echo 'Vérification de la version et des fichiers réellement servis…'
ready=0
for attempt in {1..15}; do
  if sudo docker compose exec -T teknika node scripts/verify-release.mjs </dev/null; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]]
sudo docker compose exec -T teknika node scripts/verify-journal.mjs </dev/null
echo "INSTALLATION TERMINÉE : $expected_version"
echo 'Rechargez le navigateur avec Ctrl + F5. La version apparaît aussi dans Mon profil.'
