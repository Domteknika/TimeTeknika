# Livraison React — 2026.11.17-react-7

Cette livraison vise /opt/timeteknika, version 2026.11.17-react-6. Elle conserve le projet Compose, le volume de données et .env. SQLite est conservé. La table de droits `user_admins`, ajoutée en version 6, est conservée. Cette correction change uniquement l’indicateur de chrono dans l’onglet : couleur normale fixe en cours, gris fixe à l’arrêt.

## Préparer

Exécuter `pnpm test`, `pnpm test:ui`, puis `pnpm release`. La livraison commence par `pnpm check:public`. Le paquet et son SHA-256 sont dans .qa/releases/. Il contient le code et le build React testé, sans base, secrets ni node_modules.

## Installer

Transférer le paquet, son .sha256 et scripts/install-update.sh dans un dossier privé du serveur, puis exécuter :

```bash
sha256sum -c timeteknika-2026.11.17-react-7.tar.gz.sha256
sudo bash install-update.sh "$PWD/timeteknika-2026.11.17-react-7.tar.gz" IDENTIFIANT_ADMIN
```

Remplacer IDENTIFIANT_ADMIN par l’identifiant d’un responsable existant et actif. Ce paramètre est écrit uniquement dans la configuration privée du serveur. Seul ce compte devient administrateur lors de la première initialisation ; les autres responsables gardent leur rôle. Une initialisation ultérieure conserve les administrateurs déjà présents.

Le script vérifie la version précédente, les empreintes et les modules exécutés. Il construit la nouvelle image pendant que le service actuel reste disponible, conserve le code et l’image précédents, puis crée une sauvegarde SQLite cohérente.

Le test de restauration monte uniquement cette sauvegarde en lecture seule, sans réseau externe. Il contrôle SQLite, les relations, le journal, les comptes, leur isolation, les trois exports et les fichiers React. Les empreintes des 11 tables métier doivent rester identiques. Il vérifie également que seul le compte désigné reçoit le nouveau rôle.

La bascule conserve exactement le volume Docker. Elle vérifie ensuite la version, tous les fichiers React servis et le journal. Un échec après la bascule déclenche le retour à l’image précédente.

Le redémarrage entraîne une brève interruption. Les chronos restent enregistrés avec leur heure de départ. Recharger le navigateur ou l’application Windows après installation.

## Retour et sauvegarde

Le dossier privé /opt/timeteknika/.qa/rollback/<version>-<date>/ contient database.sqlite, son empreinte, l’ancien code, les résultats et rollback.sh. La commande exacte est affichée à la fin :

```bash
sudo bash /opt/timeteknika/.qa/rollback/<version>-<date>/rollback.sh
```

Le retour conserve la base actuelle et les nouvelles saisies. L’ancienne version ignore la table additive ; les comptes administrateurs restent représentés comme responsables dans l’ancien schéma. En cas de retour, les anciennes permissions des responsables s’appliquent à nouveau.

La sauvegarde reste sur le serveur : conserver aussi une copie hors de cette machine. Ne pas supprimer les volumes Docker.

## Validations

La compilation, les tests métier, les parcours navigateur et la restauration de données fictives sont vérifiés localement. La construction Docker et le contrôle de la copie réelle sont exécutés sur le serveur avant la bascule.
