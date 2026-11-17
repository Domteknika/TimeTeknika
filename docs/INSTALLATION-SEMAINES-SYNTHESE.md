# Semaines et synthèse des temps — installation

Version : **2026.11.10-semaines-synthese-1**.

Dans Mon temps, le numéro ISO (S46, par exemple) accompagne la semaine affichée. Dans Rapports → Export, les nouvelles configurations proposent une synthèse par client, projet, tâche et collaborateur : toutes les saisies du même collaborateur sur la même tâche sont cumulées sur la période, même sur plusieurs jours. Deux collaborateurs restent sur deux lignes. Les tâches homonymes de projets différents restent séparées.

Le bouton « Par tâche et collaborateur » applique aussi ce préréglage à une configuration existante en conservant ses filtres, exclusions et son en-tête. Le détail et les regroupements personnalisés restent disponibles. Les modèles enregistrés ne sont pas modifiés automatiquement ; vous pouvez enregistrer le préréglage dans un modèle. Les mêmes lignes sont utilisées dans l’aperçu, le CSV, Excel et le PDF.

## 1. PowerShell sur le PC

```powershell
scp "C:\chemin\TimeTeknika\.qa\releases\timeteknika-2026.11.10-semaines-synthese-1.tar.gz" serveur-timeteknika:/opt/timeteknika/
ssh serveur-timeteknika
```

## 2. Session SSH sur le serveur

```bash
cd /opt/timeteknika &&
mkdir -p .qa &&
tar -xOf timeteknika-2026.11.10-semaines-synthese-1.tar.gz scripts/install-update.sh > .qa/install-update.sh &&
bash .qa/install-update.sh timeteknika-2026.11.10-semaines-synthese-1.tar.gz
```

L’installateur vérifie les fichiers du paquet, sauvegarde la base active et le code existant, reconstruit l’image, recrée le conteneur du service `teknika`, puis compare la version et les fichiers réellement servis à la livraison. `.env`, la configuration Compose et le volume de données sont conservés. Le redémarrage ne supprime pas les chronos enregistrés. Ne pas utiliser `docker compose down -v`.

Le succès doit se terminer par :

```text
VERSION VALIDÉE : 2026.11.10-semaines-synthese-1 — 12 fichiers publics identiques à la livraison.
INSTALLATION TERMINÉE : 2026.11.10-semaines-synthese-1
```

Un simple `status: ok` n’est plus suffisant pour annoncer que la mise à jour est installée. En cas d’échec, le script indique que l’installation n’est pas validée et donne le chemin de la sauvegarde de code ; ne pas considérer cette situation comme un succès. Il ne restaure pas automatiquement l’ancien conteneur.

## 3. Vérifier aussi l’adresse extérieure

```bash
sudo docker compose exec -T teknika node scripts/verify-release.mjs https://timeteknika.domteknika.ch
```

Ce contrôle vérifie les mêmes fichiers à travers Nginx et Cloudflare. Une page d’authentification supplémentaire ou un ancien fichier servi fera échouer la vérification.

Recharger ensuite le navigateur avec **Ctrl + F5**. Dans **Mon profil**, la version affichée doit être **2026.11.10-semaines-synthese-1**.

Validation locale : 71 tests réussis, dont les semaines ISO aux changements d’année, la synthèse sur plusieurs jours, les collaborateurs et tâches homonymes, les exclusions, les trois formats et le constructeur d’exports. La mise à jour n’est pas déployée automatiquement sur le serveur.
