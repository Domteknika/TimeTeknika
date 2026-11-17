# Palette de 15 couleurs — 10 novembre 2026

La couleur se choisit à la création d’un projet, dans la création rapide depuis une saisie, ou depuis la fiche d’un projet existant. Le sélecteur présente 15 pastilles nommées : Lavande, Terracotta, Sauge, Bleu, Rose, Sable, Corail, Pêche, Abricot, Citron, Pistache, Menthe, Turquoise, Pervenche et Lilas.

Les six couleurs originales restent inchangées. Aucun projet n’est recoloré automatiquement. Choisir une nouvelle couleur puis enregistrer la fiche actualise les vues de ce projet, notamment ses tâches et son calendrier, sans modifier les temps saisis. Le choix est conservé sur le serveur et synchronisé entre les utilisateurs.

L’archive inclut les corrections précédentes du calendrier proportionnel, la suppression des éléments du catalogue, les plages horaires et la création rapide de projet. La nouvelle composition sobre présentée en maquette n’est pas intégrée dans cette archive. Aucune migration de schéma n’est nécessaire.

## Sur le PC, dans PowerShell

```powershell
scp "C:\chemin\TimeTeknika\.qa\releases\timeteknika-palette-20261110.tar.gz" serveur-timeteknika:/opt/timeteknika/
ssh serveur-timeteknika
```

## Sur le serveur, dans la session SSH

```bash
cd /opt/timeteknika &&
sudo docker compose exec -T teknika node scripts/backup.mjs &&
mkdir -p .qa/rollback &&
tar -czf ".qa/rollback/palette-$(date +%Y%m%d-%H%M%S).tar.gz" server public &&
tar -xzf timeteknika-palette-20261110.tar.gz &&
sudo docker compose build teknika &&
sudo docker compose up -d --no-build teknika &&
curl --fail --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:4310/health
```

Après `{"status":"ok"}`, recharger avec Ctrl + F5. Cette procédure conserve le volume de données et `.env`, et crée une sauvegarde ponctuelle. Ne pas utiliser `docker compose down -v`.

Validation : 67 tests réussis, dont les 15 choix à la création et à la modification, la conservation des temps, la synchronisation des couleurs entre sessions et la validation des conflits de version. Le rendu visuel du sélecteur n’a pas été contrôlé dans un navigateur pendant cette mise à jour.
