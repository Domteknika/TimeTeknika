# Calendrier proportionnel — 10 novembre 2026

La hauteur minimale de 40 pixels a été retirée : elle agrandissait artificiellement les entrées courtes et masquait les pauses. Les blocs suivent maintenant les durées réelles, avec uniquement un repère de 2 pixels pour les entrées quasiment nulles. Une entrée de 8 minutes suivie de 30 minutes de pause laisse bien visible cette demi-heure.

L’échelle de base est désormais de 100 pixels par heure, avec des repères toutes les 30 minutes. Le zoom existant reste utilisable. Les blocs courts affichent une ligne ; les longs affichent le projet/client et la durée. Pour les bandes trop fines pour du texte, survoler pour les détails ou cliquer pour ouvrir la saisie. Le chrono croît en direct et les blocs récupèrent les colonnes disponibles. Les couleurs des projets et les durées enregistrées sont conservées.

Cette mise à jour inclut aussi les fonctionnalités précédentes : suppression de tâches/projets/clients avec conservation des heures, vue 7 h–18 h / 24 h, création de projet depuis une saisie et logo rouge/gris. Aucun changement de schéma de base de données.

## Sur le PC, dans PowerShell

```powershell
scp "C:\chemin\TimeTeknika\.qa\releases\timeteknika-calendrier-proportionnel-20261110.tar.gz" serveur-timeteknika:/opt/timeteknika/
ssh serveur-timeteknika
```

## Sur le serveur, dans la session SSH

```bash
cd /opt/timeteknika &&
sudo docker compose exec -T teknika node scripts/backup.mjs &&
mkdir -p .qa/rollback &&
tar -czf ".qa/rollback/calendrier-proportionnel-$(date +%Y%m%d-%H%M%S).tar.gz" server public &&
tar -xzf timeteknika-calendrier-proportionnel-20261110.tar.gz &&
sudo docker compose build teknika &&
sudo docker compose up -d --no-build teknika &&
curl --fail --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:4310/health
```

Attendre `{"status":"ok"}`, puis recharger l’application avec Ctrl + F5. Le volume des données et `.env` restent conservés. La sauvegarde est ponctuelle ; aucune sauvegarde automatique n’est activée. Ne pas utiliser `docker compose down -v`.

Validation : 65 tests réussis, dont le cas « 8 minutes puis 30 minutes de pause » à tous les zooms, les colonnes disponibles, la croissance du chrono et les vues horaires. Le rendu visuel n’a pas été vérifié dans un navigateur pendant cette correction.
