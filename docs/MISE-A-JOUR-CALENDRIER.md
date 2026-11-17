# Mise à jour du calendrier — 10 novembre 2026

Les blocs ont une hauteur minimale pour afficher leur libellé et leur durée. Les collisions visuelles, y compris entre des entrées courtes consécutives, sont réparties en colonnes. Le texte reste dans son bloc ; les libellés longs sont abrégés et accessibles au survol. Le chrono continue de mettre à jour sa durée et sa progression colorée, puis agrandit son bloc au-delà de la hauteur minimale. Les blocs voisins se repositionnent en direct si nécessaire. Les couleurs des projets restent conservées.

Aucune modification des durées enregistrées, de la base ou du fichier `.env`. L’archive contient les trois fichiers d’interface nécessaires et cette notice. Elle inclut aussi les dernières améliorations : création de projet depuis une saisie et logo rouge/gris.

## Depuis PowerShell sur le PC

```powershell
scp "C:\Users\Cholier\Documents\Git\Toggleteknika\.qa\releases\timeteknika-calendrier-20261110.tar.gz" dtkserver@10.69.1.146:/opt/timeteknika/
ssh dtkserver@10.69.1.146
```

## Depuis la session SSH sur Ubuntu

Les commandes s’enchaînent uniquement si la précédente réussit. La sauvegarde est ponctuelle, sans activation de sauvegardes automatiques.

```bash
cd /opt/timeteknika &&
sudo docker compose exec -T teknika node scripts/backup.mjs &&
mkdir -p .qa/rollback &&
tar -czf ".qa/rollback/calendrier-$(date +%Y%m%d-%H%M%S).tar.gz" public/app.js public/styles.css public/calendar-utils.js &&
tar -xzf timeteknika-calendrier-20261110.tar.gz &&
sudo docker compose build teknika &&
sudo docker compose up -d --no-build teknika &&
curl --fail --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:4310/health
```

La réponse attendue est `{"status":"ok"}`. Recharger ensuite l’application avec Ctrl + F5. Le volume Docker existant conserve les données et les chronos en cours. Ne pas utiliser `docker compose down -v`.

## Vérifications

57 tests automatisés réussis, notamment les collisions des entrées courtes, la croissance du chrono, le repositionnement de ses voisins sans remplacer la grille, les différents zooms et les limites de journée. Le rendu visuel n’a pas été vérifié dans un navigateur pendant cette correction.

Après installation, vérifier dans Mon temps → Calendrier les entrées courtes de la journée, le chrono actif et les zooms. Les blocs proches doivent rester côte à côte sans texte superposé.
