#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
if [[ -f .env.postgres ]]; then
  exec bash scripts/backup-postgres.sh
fi
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
name="timeteknika-${stamp}.sqlite"
install -d -m 700 /var/backups/timeteknika
docker compose exec -T teknika node scripts/backup.mjs /app/data/teknika.sqlite "/app/data/backups/$name"
docker compose cp "teknika:/app/data/backups/$name" "/var/backups/timeteknika/$name"
chmod 600 "/var/backups/timeteknika/$name"
echo "Sauvegarde locale : /var/backups/timeteknika/$name"
