# Mise à jour : création de projet et logo du chrono

Cette mise à jour ajoute « Créer un projet » en bas du sélecteur Projet des saisies de temps. Le client, la description et la couleur du projet se choisissent dans le formulaire. Le nouveau projet est sélectionné automatiquement ; la description et les horaires de la saisie sont conservés. Il faut ensuite enregistrer la saisie pour conserver son classement.

Le logo de l’onglet devient rouge lorsque le chrono personnel tourne et gris lorsqu’il est arrêté. Il suit l’état confirmé par le serveur, y compris les changements depuis une autre session. Une interruption de connexion ne signifie pas que le chrono est arrêté : le dernier état confirmé reste affiché jusqu’à la reconnexion.

L’archive ne remplace que `public/app.js` et cette notice. Aucun changement de schéma de base de données, de volume Docker ou de configuration `.env`.

## 1. Envoyer depuis PowerShell sur votre PC

```powershell
scp "C:\Users\Cholier\Documents\Git\Toggleteknika\.qa\releases\timeteknika-saisie-chrono-20261110.tar.gz" dtkserver@10.69.1.146:/opt/timeteknika/
```

## 2. Installer sur le serveur Ubuntu

Exécuter dans le terminal SSH. Arrêter la procédure si une commande échoue.

```bash
cd /opt/timeteknika
sudo docker compose exec -T teknika node scripts/backup.mjs
mkdir -p .qa/rollback
cp public/app.js ".qa/rollback/app-$(date +%Y%m%d-%H%M%S).js"
tar -xzf timeteknika-saisie-chrono-20261110.tar.gz
sudo docker compose up -d --build teknika
curl --fail http://127.0.0.1:4310/health
```

La sauvegarde est ponctuelle, dans le volume existant ; cette procédure n’active pas de sauvegarde automatique. Le redémarrage du conteneur conserve les entrées et les chronos en cours dans ce même volume. Ne pas utiliser `docker compose down -v`.

## 3. Vérifier

Recharger complètement TimeTeknika. Depuis une saisie, ouvrir Projet puis « Créer un projet ». Vérifier le client prérempli, le choix de couleur et le retour dans la saisie. Démarrer puis arrêter son chrono : le logo de l’onglet doit passer du gris au rouge puis au gris.

Validation locale : 52 tests réussis, dont création de projet, annulation, conservation du brouillon, reprise réseau sans doublon, création de tâche et états du logo. Le rendu visuel dans le navigateur n’a pas été contrôlé pendant cette mise à jour.
