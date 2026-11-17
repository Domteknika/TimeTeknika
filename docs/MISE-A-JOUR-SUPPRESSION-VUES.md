# Suppression et vues du calendrier — 10 novembre 2026

Cette archive regroupe la correction des blocs du calendrier, la vue 7 h–18 h / 24 h, la suppression réelle des éléments du catalogue et les précédentes améliorations de saisie et du logo.

## Fonctionnement

- Dans une tâche ou un projet, le bouton **Supprimer** se trouve en bas de la fiche. Pour un client, il est dans la liste des clients. Ces actions sont réservées aux responsables.
- Une confirmation montre le nombre de clients, projets, tâches et entrées concernés, avec le détail des projets et tâches. Une case doit être cochée avant de confirmer. Si les éléments ont changé entre l’ouverture et la confirmation, la suppression est refusée : rouvrir la confirmation pour vérifier le nouveau périmètre.
- Supprimer une tâche retire uniquement cette tâche du classement des temps ; le projet et le client sont conservés.
- Supprimer un projet supprime ses tâches. Supprimer un client supprime ses projets et leurs tâches. Les heures concernées sont alors sans projet ni tâche et apparaissent dans « À classer ».
- Toutes les entrées restent enregistrées, avec leurs descriptions, horaires, propriétaires et durées. Les entrées précédemment supprimées restent supprimées et peuvent toujours être restaurées. Les chronos en cours continuent à tourner. L’historique consigne le retrait du classement. Les éléments du catalogue sont réellement supprimés : il n’y a pas de corbeille pour les rétablir.
- Dans Mon temps → Calendrier, **7 h–18 h / 24 h** se trouve à côté du zoom. Ce choix est enregistré sur le serveur pour chaque personne et synchronisé entre ses sessions. Les totaux journaliers incluent toujours les heures hors de la plage affichée. Le glisser-déposer utilise les heures de la plage choisie.

## 1. Transfert depuis PowerShell sur le PC

```powershell
scp "C:\chemin\TimeTeknika\.qa\releases\timeteknika-suppression-vues-20261110.tar.gz" serveur-timeteknika:/opt/timeteknika/
ssh serveur-timeteknika
```

## 2. Installation depuis la session SSH

Ce bloc sauvegarde la base et le code existant avant l’installation. Les commandes s’arrêtent au premier échec.

```bash
cd /opt/timeteknika &&
sudo docker compose exec -T teknika node scripts/backup.mjs &&
mkdir -p .qa/rollback &&
tar -czf ".qa/rollback/suppression-vues-$(date +%Y%m%d-%H%M%S).tar.gz" server public &&
tar -xzf timeteknika-suppression-vues-20261110.tar.gz &&
sudo docker compose build teknika &&
sudo docker compose up -d --no-build teknika &&
curl --fail --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:4310/health
```

La réponse attendue est `{"status":"ok"}`. Recharger l’application avec **Ctrl + F5**. Le volume des données et `.env` sont conservés ; aucune migration de schéma n’est nécessaire. Ne pas utiliser `docker compose down -v`. La sauvegarde de cette procédure est ponctuelle ; aucune sauvegarde automatique n’est activée.

## Vérification

63 tests automatisés réussis : suppressions en cascade, conservation des temps, chronos et historiques, droits des responsables, confirmations périmées, reprises sans doublon, nouvelles vues horaires et absence de recouvrement des blocs. Le rendu visuel n’a pas été contrôlé dans un navigateur pendant cette mise à jour.

Après installation, vérifier le passage entre 7 h–18 h et 24 h, puis sa conservation après rechargement. Pour essayer la suppression, utiliser un client/projet/tâche de test et vérifier le récapitulatif avant confirmation.
