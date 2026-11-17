# Vue sobre et palette — installation vérifiée

Version : **2026.11.10-sobre-palette-1**.

Contrôle du site public effectué avant cette livraison : les fichiers de la palette de 15 couleurs étaient déjà servis, mais la disposition sobre manquait dans les archives précédentes. Cette livraison intègre réellement cette disposition, le calendrier utilisant la hauteur disponible, le bouton « Ajuster » et la palette modifiable depuis les fiches projets.

Les fonctionnalités précédentes (suppression avec conservation des heures, calendrier proportionnel, saisie rapide, logo rouge/gris) sont incluses. Le mode Ajuster est actif par défaut ; les boutons de zoom passent en mode manuel. Le choix est enregistré pour chaque utilisateur. Les couleurs existantes ne sont pas modifiées automatiquement.

## 1. PowerShell sur le PC

```powershell
scp "C:\Users\Cholier\Documents\Git\Toggleteknika\.qa\releases\timeteknika-2026.11.10-sobre-palette-1.tar.gz" dtkserver@10.69.1.146:/opt/timeteknika/
ssh dtkserver@10.69.1.146
```

## 2. Session SSH sur le serveur

```bash
cd /opt/timeteknika &&
mkdir -p .qa &&
tar -xOf timeteknika-2026.11.10-sobre-palette-1.tar.gz scripts/install-update.sh > .qa/install-update.sh &&
bash .qa/install-update.sh timeteknika-2026.11.10-sobre-palette-1.tar.gz
```

L’installateur vérifie les fichiers du paquet, sauvegarde la base active et le code existant, reconstruit l’image, recrée le conteneur du service `teknika`, puis compare la version et les fichiers réellement servis à la livraison. `.env`, la configuration Compose et le volume de données sont conservés. Le redémarrage ne supprime pas les chronos enregistrés. Ne pas utiliser `docker compose down -v`.

Le succès doit se terminer par :

```text
VERSION VALIDÉE : 2026.11.10-sobre-palette-1 — 12 fichiers publics identiques à la livraison.
INSTALLATION TERMINÉE : 2026.11.10-sobre-palette-1
```

Un simple `status: ok` n’est plus suffisant pour annoncer que la mise à jour est installée. En cas d’échec, le script indique que l’installation n’est pas validée et donne le chemin de la sauvegarde de code ; ne pas considérer cette situation comme un succès. Il ne restaure pas automatiquement l’ancien conteneur.

## 3. Vérifier aussi l’adresse extérieure

```bash
sudo docker compose exec -T teknika node scripts/verify-release.mjs https://timeteknika.domteknika.ch
```

Ce contrôle vérifie les mêmes fichiers à travers Nginx et Cloudflare. Une page d’authentification supplémentaire ou un ancien fichier servi fera échouer la vérification.

Recharger ensuite le navigateur avec **Ctrl + F5**. Dans **Mon temps**, le chrono et les compteurs sont compacts au-dessus du calendrier. Dans **Projets → ouvrir un projet → Couleur**, 15 couleurs sont disponibles. Dans **Mon profil**, la version affichée doit être **2026.11.10-sobre-palette-1**.

Validation locale : 69 tests réussis, dont le rendu DOM complet de la vue sobre, l’ajustement à plusieurs hauteurs, le zoom manuel, les 15 couleurs et le rejet d’un serveur ancien ou de fichiers incorrects. La syntaxe Bash de l’installateur a également été vérifiée. Le déploiement Docker sur Ubuntu et le rendu visuel dans un navigateur restent à vérifier après installation sur le serveur.
