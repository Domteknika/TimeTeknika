# TimeTeknika — refonte React locale

Cette branche prépare la nouvelle interface React + TypeScript avec shadcn/ui et un stockage serveur asynchrone. **Les fichiers SQLite existants restent disponibles. Aucun import automatique, déploiement ni push automatique.**

Le serveur utilise **PostgreSQL + Drizzle** lorsque `DATABASE_URL` est renseignée, et conserve SQLite sinon. La migration réelle des 13 tables et la bascule vers `2026.11.17-postgres-1` ont été effectuées sur le serveur, puis contrôlées en lecture seule le **17 novembre 2026**. Les empreintes des tables à l'import, la présence des utilisateurs et temps d'origine, l'historique exact et le checkpoint externe du journal sont vérifiés. Les sauvegardes SQLite et PostgreSQL sont conservées sur le serveur ; aucune installation PostgreSQL n'est nécessaire sur le PC. Le [guide PostgreSQL](docs/MIGRATION-POSTGRESQL.md) décrit l'import explicite et les contrôles.

Pour essayer le build local, double-cliquer sur **Apercu TimeTeknika React.cmd**, puis ouvrir http://127.0.0.1:4312. Cet aperçu utilise des données fictives séparées. Pour développer : `pnpm install --frozen-lockfile`, puis `pnpm dev`. Voir la [notice de la refonte](docs/REFONTE-REACT.md).

Les commandes et fonctions historiques ci-dessous restent documentées pour comparaison.

Un suivi de temps collaboratif en français, inspiré du fonctionnement documenté de Toggl Focus. Les clients, projets et tâches sont partagés ; chaque entrée de temps appartient à une personne.

Le thème reprend les fonds clairs et la typographie sombre de [Domteknika](https://domteknika.ch/en), avec un rouge pâle pour les commandes. Les couleurs des projets et tâches restent indépendantes du thème.

## Essayer sur cet ordinateur

**Lancement au quotidien sous Windows :** double-cliquer sur **`Lancer TimeTeknika.cmd`** à la racine du projet. Le lanceur ouvre l’application dans le navigateur par défaut et démarre le serveur en arrière-plan si nécessaire. Fermer le navigateur n’arrête pas le serveur ; après un redémarrage de Windows, relancer ce même fichier. Vous pouvez créer un raccourci de ce fichier sur le Bureau (conserver le fichier original dans le projet).

Le lanceur réutilise les données actuelles de `data/demo.sqlite`, sans réinitialisation. Il cherche Node.js sur le système, puis dans le runtime local de Codex disponible sur ce poste. Les journaux de démarrage se trouvent dans `data/logs/`. Aucun téléchargement ni droit administrateur n’est nécessaire pour les lancements suivants.

### Installation initiale ou lancement manuel

Prérequis : **Node.js 24 ou plus récent** et **pnpm 11.25.0**. Installer les dépendances une fois ; les exports sont ensuite générés sur le serveur sans service externe.

```powershell
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile --ignore-scripts
node server/index.mjs --demo
```

Ouvrir **http://127.0.0.1:4310**. Les trois boutons de connexion permettent de choisir Alex (responsable), Emma ou Lucas (membres). Ce sont des personnages fictifs. Alex voit les temps de toute l’équipe ; Emma et Lucas voient seulement leurs propres entrées.

La démo écoute uniquement sur la boucle locale. Sans `DEMO_DATABASE_URL`, ses données restent dans `data/demo.sqlite` ; les lanceurs Windows conservent ce mode SQLite. `pnpm demo` permet d'utiliser une base PostgreSQL de démonstration séparée après migration de son schéma. Un redémarrage conserve les changements et le chrono actif. Ne pas utiliser la démo avec de vraies données ni l’exposer par un tunnel.

Les onglets d’un même navigateur partagent le cookie de connexion : changer de profil change le compte de ce navigateur. Pour tester deux personnes simultanément, utiliser deux navigateurs ou une fenêtre privée séparée. Deux onglets du même compte servent à tester la synchronisation de son chrono.

## Ce qui fonctionne

- Chrono, arrêt, reprise dans une nouvelle entrée, saisie manuelle, correction des horaires et du classement ; descriptions individuelles.
- Démarrage sans tâche ; rubrique **À classer** et rappel dans l’application à partir de l’heure choisie (16 h par défaut). Ces heures restent dans les totaux.
- Création de clients, projets, tâches et affectations multiples **par tous les membres**. Créer un projet n’accorde aucun droit supplémentaire sur les temps.
- Sélection d’une tâche → projet et client déduits. Entrée sans tâche : projet facultatif. Le client découle du projet ; un client interne peut regrouper le travail non facturable.
- Dans **Modifier le temps**, le choix d’une tâche est enregistré immédiatement, y compris pour un chrono en cours. La description, les horaires et le choix du projet seul restent à valider avec **Enregistrer**. Une nouvelle entrée se valide aussi avec **Enregistrer**.
- Le bouton **Supprimer** de cette fenêtre permet de retirer ses propres temps arrêtés après confirmation, avec une action **Rétablir**. L’historique est conservé ; arrêter le chrono avant de supprimer une entrée en cours.
- Sélecteur de tâches organisé par projets repliables, avec client, couleur et nombre de tâches. Les projets épinglés sont placés en tête, dans la saisie d’une entrée comme dans le chrono ; ils remontent aussi dans la liste des projets du formulaire. Épingles et projets repliés sont personnels, conservés sur le serveur et synchronisés entre sessions. La recherche trouve les tâches des projets repliés sans changer cette organisation.
- Liste et calendrier hebdomadaires : le créneau actif grandit chaque seconde avec le compteur, sans rechargement. Les projets et les tâches peuvent être archivés et réactivés.
- Chaque date du calendrier affiche son temps travaillé, chrono actif et entrées sans tâche inclus. Les entrées traversant minuit sont réparties entre les journées dans le fuseau Europe/Zurich ; une journée vide affiche **0 h 00**.
- **Mon temps** présente un seul bandeau compact : aujourd’hui, cette semaine avec progression vers l’objectif, solde global et semaines précédentes. Le bouton **À classer** se trouve près des commandes du calendrier ; la flèche du solde global ouvre le détail du calcul. Lorsqu’on consulte une autre semaine, une ligne indique son total enregistré et son objectif.
- **Solde global**, depuis le **26 octobre 2026** par défaut : les écarts de toutes les semaines se compensent. Le total saisi est comparé à la somme des objectifs hebdomadaires ajustés. La semaine en cours est incluse dès lundi, même sans saisie. Le compteur indique les heures **à rattraper** ou **à récupérer**, indépendamment de la semaine consultée. La date de départ et la répartition hebdomadaire se règlent dans **Mon profil**. Les semaines précédant le premier horaire utilisent l’objectif d’origine.
- **Congés et jours fériés** : configurez les heures prévues et cochez **Repos** pour les jours non travaillés dans **Mon profil → Mon temps de travail**. L’onglet **Congés** permet de saisir une journée, une demi-journée ou une période. Il affiche aussi les jours fériés, les fermetures et les repos hebdomadaires du lundi au vendredi. L’administrateur gère les dates chômées dans **Mon profil**. Seules les heures prévues sur les créneaux concernés réduisent l’objectif hebdomadaire. Les congés et les jours fériés se décomptent une seule fois et les pointages restent disponibles dans les rapports.
- **Droit annuel** : chaque personne renseigne son nombre de jours par année dans **Mon profil → Mes congés annuels**. Dans **Congés → Dates de l’équipe**, un administrateur peut ajouter un férié ponctuel ou une période de fermeture. Les congés et les fermetures réduisent le solde annuel pour les créneaux normalement travaillés. Les jours fériés préservent ce solde. Le solde de l’année affichée est visible dans **Congés**.
- **Semaines précédentes** affiche le cumul à récupérer ou à rattraper jusqu’au dimanche précédent, sans inclure la semaine en cours. Le report se renouvelle chaque lundi et reflète les corrections des anciennes entrées. Pendant la première semaine de suivi, il indique la date du premier bilan.
- Alerte dans l’application lorsqu’un chrono personnel dépasse 6 heures sans interruption, avec durée en direct, arrêt immédiat ou correction de l’heure de fin réelle. Elle apparaît aussi à la réouverture de l’application et reste visible tant que le chrono concerné est actif. Pas d’arrêt automatique ni de notification système lorsque l’application est fermée.
- Rapports par période, client, projet, tâche, personne, description et classement ; regroupement croisé avec les contributions individuelles, totaux finalisés/en cours et découpage des périodes au fuseau Europe/Zurich.
- Quatre vues des rapports : bâtons, courbe, camembert et barres comparatives. Couleurs des projets, durées et parts du total ; les vues chronologiques se regroupent par semaine ou mois sur les périodes longues. Le choix du graphique est personnel, conservé sur le serveur et synchronisé entre sessions.
- **Rapports → Exporter les temps** : constructeur d’exports **CSV, Excel et PDF**. Sélections multiples de collaborateurs, clients, projets et tâches, périodes fixes ou relatives, descriptions, classement, chronos arrêtés/en cours et exclusions ponctuelles. Colonnes choisies, renommées et réordonnées ; détail ou synthèse imbriquée par client/projet/tâche/personne/jour/semaine/mois ; sous-totaux et total facultatifs. Aperçu des données actualisé après synchronisation et toutes les 15 secondes.
- Modèles d’export personnels conservés dans SQLite, synchronisés et protégés contre les écrasements concurrents. Les exclusions ponctuelles et la référence de facture ne sont pas mémorisées dans le modèle. Le PDF A4 reprend le thème rouge pâle, un titre, un émetteur, une référence facultative et une note ; il répète les en-têtes et numérote les pages. Les très larges tableaux passent sur plusieurs volets reliés par numéros de ligne, sans réduire le texte. Excel conserve des durées numériques cumulables au-delà de 24 h ; le CSV protège les textes contre l’interprétation comme formules.
- Listes déroulantes harmonisées dans les formulaires, rapports et paramètres : recherche sans accents, couleurs des projets, initiales des clients et personnes, palette de couleurs et statuts. Navigation au clavier et validation des champs obligatoires conservées.
- Pages **Tâches** et **Projets** : recherche sans accents et filtres combinables par client, projet (tâches), archivage et présence de temps. Les projets peuvent être regroupés par client. Le client limite les choix de projets. Les durées portent sur toutes les dates autorisées et incluent les chronos en cours. Les filtres sont réinitialisés au rechargement ou au changement de page.
- Corrections et suppressions réservées à l’auteur, même face au responsable. Historique des corrections et suppression logique avec rétablissement immédiat.
- Journal en ajout seul : changements, erreurs HTTP, connexions et démarrages/arrêts. Consultation, filtres, export et vérification d’intégrité dans **Mon profil → Journal de suivi**, pour les responsables.
- Notifications en direct entre sessions ; données rechargées du serveur après écriture et reconnexion. Les chronos affichés avancent chaque seconde ; les rapports des chronos actifs sont recalculés toutes les 15 secondes.
- Conflits de version signalés, un seul chrono actif par personne, bascule atomique entre activités, requêtes idempotentes et chevauchements signalés avant confirmation explicite.
- Connexion par identifiant sans email, mot de passe de 8 caractères minimum et générateur de 8 caractères. Premier responsable à l’installation, ajout de membres depuis **Mon profil**. Changement personnel et réinitialisation par un responsable avec révocation des autres sessions. Les anciens comptes conservent leur ancienne adresse comme identifiant.

## Données et architecture

Serveur HTTP Node.js avec accès aux données asynchrones : PostgreSQL via Drizzle et le pool `pg`, ou SQLite via un adaptateur de compatibilité. La nouvelle interface utilise React, TypeScript, Vite, Tailwind CSS et shadcn/ui ; les graphiques utilisent Recharts. Les calculs métier et les exports restent sur le serveur. L’ancienne interface est conservée pour comparaison avec `--legacy`.

Seul le serveur accède à la base. SQLite utilise un fichier local avec WAL ; PostgreSQL utilise la connexion configurée et des migrations explicites. Un verrou transactionnel PostgreSQL conserve la sérialisation des mutations, tandis que les instantanés cohérents utilisent une transaction en lecture seule. Le processus applicatif reste unique : les flux SSE et limitations de connexion ne sont pas encore partagés entre plusieurs réplicas.

Les données métier et préférences sont conservées **uniquement côté serveur**. Aucune utilisation de localStorage, sessionStorage, IndexedDB, service worker, cache métier ou service externe. Le navigateur reçoit les données nécessaires en mémoire pour les afficher, et un cookie de session HttpOnly/SameSite. Les réponses comportent `Cache-Control: no-store`. Les formulaires non envoyés n’ont pas de brouillon durable et seront perdus au rechargement.

Les notifications passent par **Server-Sent Events (SSE)** ; les écritures passent par HTTP. Les événements ne contiennent que la révision globale, pas les entrées privées. Chaque session recharge ensuite son état autorisé. Un formulaire déjà ouvert conserve ses valeurs et sa version ; un conflit est signalé au lieu d’écraser la dernière écriture.

Une coupure réseau n’arrête pas un chrono déjà enregistré : sa durée est calculée depuis l’heure de départ serveur. Les modifications hors connexion ne sont pas mises en file locale. Après une réponse incertaine, le client retente avec la même clé ; en cas d’échec persistant, il invite à vérifier l’état synchronisé avant de recréer l’opération. L’arrêt après reconnexion est horodaté à sa réception : corriger l’horaire si nécessaire.

Les responsables ont ici un périmètre **global sur l’équipe** ; les projets et leurs affectations sont visibles par tous. Les membres ne voient ni les entrées ni les cumuls d’équipe qui permettraient de déduire les heures des collègues.

## Ouvrir un espace vierge

Arrêter la démo avec Ctrl+C, puis :

```powershell
pnpm start
```

Sans `DATABASE_URL`, la base séparée `data/teknika.sqlite` est créée. Avec cette variable, appliquer d'abord `pnpm db:migrate` à la base PostgreSQL dédiée. Ouvrir http://127.0.0.1:4310 et créer le premier administrateur. Ajouter ensuite les personnes dans **Mon profil**. Les comptes n’ont aucune relation avec les identifiants Toggl.

Variables disponibles : `HOST` (127.0.0.1), `PORT` (4310), `DATA_DIR`, `DATABASE_URL`, `DEMO_DATABASE_URL`, `APP_URL` (adresse d’accès complète), `PUBLIC_ORIGIN` (ancien nom), `COOKIE_SECURE` (0/1 sans adresse configurée), `SETUP_TOKEN`. Les commandes `pnpm start`, `pnpm demo` et `pnpm dev` chargent `.env` s'il existe. Configurer `APP_URL` avec l’adresse publique exacte ; une adresse HTTPS active automatiquement les cookies sécurisés. L’origine des requêtes, la session et le jeton CSRF sont vérifiés côté serveur.

## Docker — déploiement serveur

La [notice complète Ubuntu Server + Cloudflare Tunnel](docs/INSTALLATION_LINUX.md) couvre l’installation depuis un serveur neuf, les comptes, les sauvegardes quotidiennes, la restauration et les mises à jour.

Les images Docker ont été construites et testées sur le serveur. L'application répond sur la version PostgreSQL `2026.11.17-postgres-1`.

Les images incluent les migrations et l'importeur SQLite. La procédure `scripts/deploy-postgres.sh` et la configuration `deploy/compose.postgres.yaml` ont été exécutées : essai d'import et restauration sur des bases isolées, vérification de douze opérations concurrentes avec deux pools natifs, sauvegarde finale puis bascule. Les permissions du rôle applicatif et le journal ont été contrôlés. L'installateur historique et les quatre étapes ci-dessous concernent le parcours SQLite ; pour une autre reprise de données, suivre le [guide d'import serveur](docs/MIGRATION-POSTGRESQL.md).

1. Copier `.env.example` en `.env` et générer un `SETUP_TOKEN` aléatoire avec la commande indiquée dans ce fichier.
2. Exécuter `docker compose up --build -d`.
3. Ouvrir http://localhost:4310 et entrer le jeton lors de la création du premier responsable. Le jeton est requis à travers la couche réseau Docker.
4. Vérifier la santé, créer deux comptes, tester les notifications et la restauration d’une sauvegarde sur une copie.

Après la migration PostgreSQL, depuis le répertoire applicatif du serveur, charger les deux fichiers de configuration pour toute commande Compose :

```bash
sudo docker compose --env-file .env --env-file .env.postgres ps
sudo docker compose --env-file .env --env-file .env.postgres logs --tail=80 teknika
sudo bash scripts/backup-linux.sh
```

La configuration `.env.postgres` appartient à root en mode `600` ; conserver ces permissions et les comptes séparés de migration et d'application. Ne pas publier ce fichier ni ses identifiants dans Git ou les rapports.

Le port publié est limité à 127.0.0.1 et le mode démo est désactivé. Un proxy doit transmettre le flux `/api/events` sans mise en tampon et tolérer les connexions longues. Le volume `teknika-data` conserve les fichiers SQLite ; la configuration complémentaire crée le volume persistant `teknika-postgres`. Ne pas employer `docker compose down -v` pour une simple mise à jour : cela supprimerait les volumes de données.

## Sauvegarde et restauration

Après migration, `sudo bash scripts/backup-linux.sh` appelle `scripts/backup-postgres.sh` : `pg_dump` crée une archive PostgreSQL, `pg_restore --list` en contrôle la liste, puis une empreinte SHA-256 est conservée. Les fichiers restent privés sur le serveur. Une restauration complète sur une base PostgreSQL isolée a été vérifiée avant la bascule, et l'audit final a confirmé les empreintes des sauvegardes conservées. La fréquence, la rétention et la copie sur un stockage séparé restent à vérifier avec la configuration d'exploitation du serveur.

La procédure ci-dessous concerne **SQLite**. Le script utilise son API de sauvegarde pour produire un fichier cohérent, y compris pendant que l’application tourne ; ne pas copier uniquement la base active en ignorant ses fichiers WAL. `pnpm backup` charge `.env` et refuse une sauvegarde SQLite par défaut si `DATABASE_URL` est configurée.

```powershell
node scripts/backup.mjs data/demo.sqlite data/backups/demo-verifie.sqlite
```

Pour l’espace réel, remplacer `demo.sqlite` par `teknika.sqlite`. La destination doit être nouvelle. Copier ensuite cette sauvegarde vers un emplacement distinct du disque serveur selon votre politique interne. Le script ne programme aucune sauvegarde automatique.

Pour restaurer : arrêter l’application, conserver le dossier de données actuel en secours, créer un **nouveau dossier de données vide**, y placer la sauvegarde sous le nom `teknika.sqlite`, puis démarrer avec `DATA_DIR` pointant sur ce dossier. Ne pas mélanger un ancien fichier WAL avec une base restaurée. Vérifier comptes, entrées, affectations et totaux sur la copie avant de la mettre en service.

## Journal de suivi

Après mise à jour et redémarrage du serveur, les responsables disposent de **Mon profil → Journal de suivi**. Le journal présente 100 événements par page, avec filtres par niveau, catégorie et référence de requête. **Plus anciens** parcourt l’historique ; **Filtrer / Actualiser** revient aux événements récents. Les messages d’erreur affichent une référence également disponible dans l’en-tête HTTP `X-Request-ID` : la rechercher dans le journal relie l’erreur aux changements de la même requête.

Le journal est conservé dans la base applicative sélectionnée, PostgreSQL ou SQLite, dans `event_log`. Pour SQLite, il reste inclus dans les sauvegardes existantes. Il couvre :

- L’historique métier existant : créations et corrections des temps, suppressions et rétablissements, clients/projets/tâches, comptes et changements de mot de passe (sans le mot de passe).
- Chaque mutation validée, dans la même transaction que ses données. Si son écriture au journal échoue, la mutation est annulée. Une requête rejouée avec sa clé d’idempotence ne duplique pas le changement métier.
- Les réponses HTTP en erreur, les interruptions de connexion, et les requêtes d’écriture terminées, dont connexion/déconnexion et téléchargement d’export. Les traces indiquent méthode, route normalisée, statut, durée, personne authentifiée et référence. Les erreurs internes incluent des emplacements de code, sans leur message brut. Les lectures réussies, aperçus et calculs de rapports ne sont pas journalisés systématiquement.
- Les démarrages et arrêts normaux du serveur, avec sa version au démarrage. Un arrêt brutal peut laisser un démarrage sans arrêt correspondant.

Les traces techniques n’enregistrent ni corps de requête, ni paramètres d’URL, ni en-têtes, cookies, jetons ou mots de passe. L’historique métier contient les valeurs avant/après, notamment les descriptions de travail : les exports du journal restent des données internes. Les échecs HTTP sont enregistrés après l’annulation éventuelle de la transaction ; si la base ne permet plus de les écrire, un signal `journal-write-failed` avec la référence apparaît sur la sortie d’erreur du serveur. Les problèmes survenus uniquement dans le navigateur ou avant d’atteindre le serveur ne sont pas capturés.

**Protection et limites.** Des triggers refusent la modification et la suppression du journal et de l'historique métier ; PostgreSQL interdit aussi `TRUNCATE`. Chaque événement est lié au précédent par une empreinte SHA-256. La chaîne et sa correspondance avec l’historique sont vérifiées au démarrage et via **Vérifier l’intégrité**. Une altération détectée empêche le démarrage ; conserver la base concernée et restaurer une sauvegarde vérifiée, sans réinitialiser le journal. L'activation historique SQLite peut intégrer l'ancien audit avec l'indication `legacy` ; PostgreSQL initialise uniquement une base entièrement vide et refuse un import partiel sans marqueur valide. Les modifications directes des tables métier par un outil SQL ne sont pas automatiquement journalisées.

Cette protection est locale à l’application, pas un stockage WORM : une personne qui contrôle le fichier SQLite ou dispose des privilèges d'administration PostgreSQL peut supprimer les protections et recalculer une chaîne. La suppression d’une fin valide ou le remplacement de la base ne sont détectables qu’en comparant avec un point de contrôle conservé séparément. **Exporter cette page** télécharge les événements affichés et le point de contrôle global (`count`, `hash`) ; ce fichier n’est pas un export complet du journal. Conserver régulièrement un tel fichier sur un autre emplacement protégé permet de comparer une sauvegarde :

```powershell
# Vérifier la chaîne et l’historique, en lecture seule
node scripts/verify-journal.mjs data/teknika.sqlite

# Comparer aussi avec le point de contrôle d’un export conservé séparément
node scripts/verify-journal.mjs data/backups/teknika.sqlite chemin/vers/timeteknika-journal-123.json

# PostgreSQL configuré dans DATABASE_URL, sans initialisation ni réparation
pnpm db:verify
```

La commande renvoie un JSON et un code de sortie non nul si la vérification échoue. Elle accepte aussi comme point de contrôle le JSON produit par une vérification précédente. Le point de contrôle doit dater d’avant la sauvegarde comparée. Il n’y a aucune purge automatique ; surveiller l’espace disque et conserver les sauvegardes hors du serveur. Aucun stockage externe ni envoi automatique n’est configuré.

## Vérifications

```powershell
node --test tests/*.test.mjs
```

Les tests couvrent les droits, les créations multi-personnes, l’idempotence, la concurrence des chronos, les conflits d’édition, les chevauchements, la synchronisation SSE, les cumuls, les journées de 23/25 h, l’installation, la connexion, la persistance et la sauvegarde. Les exports sont vérifiés par calculs, réouverture des fichiers Excel, génération PDF, routes HTTP et interactions DOM isolées du constructeur. Ils utilisent des bases temporaires ; les fichiers de la recette de persistance restent dans `.qa/`.

Validation effectuée : **159 tests de la suite complète et 2 tests UI réussis**, ainsi que `pnpm typecheck`, `pnpm build` et `pnpm db:check`. Les contrôles ciblés ajoutés ensuite passent également : 5 tests CLI, 3 tests d'audit et 4 tests Linux de préparation des sauvegardes. `pnpm test:db` vérifie le schéma, le stockage, les routes PostgreSQL et l'import SQLite avec PGlite. Le déploiement Docker, l'import réel, la restauration et une sonde de concurrence sur deux pools `pg` sont validés sur le serveur. Les scénarios métier concurrents exhaustifs, les pannes du pool et les performances restent à tester sur PostgreSQL natif.

## Limites assumées de cette version

- Remplissage d’un Excel existant, tableaux croisés, génération de factures, budgets, import Toggl et intégrations : étapes suivantes. Le PDF actuel est un relevé de prestations à joindre à une facture.
- Exports : maximum 370 jours et 20 000 entrées par génération ; l’aperçu affiche les 200 premières lignes, les fichiers contiennent toutes les lignes. Modèles personnels uniquement (50 par personne), aucun envoi automatique. Les valeurs des chronos sont figées à l’instant de génération ; les colonnes Début/Fin retenus correspondent à la portion réellement exportée.
- Les responsables peuvent modifier les identifiants et retirer les accès dans Mon profil. Les heures et l’historique restent conservés ; un chrono actif bloque le retrait. Pas encore de responsable limité à certains projets. La récupération sans email passe par un autre responsable ou le script serveur de secours documenté dans la notice.
- Calendrier de consultation : pas de glisser-déposer ni de planning prévisionnel. Les chevauchements volontaires peuvent superposer des blocs.
- Les rapports chargent les entrées autorisées en mémoire serveur ; pagination et optimisation à prévoir avec le volume réel.
- Le rappel n’est visible que dans l’application ouverte ; aucune notification email ou système.
- Pas de mode hors ligne, de brouillons persistants ni de garantie de récupération d’un texte non envoyé.
- La planification des sauvegardes est fournie pour systemd ; son activation, la rétention, la copie hors serveur et la supervision restent à vérifier. La migration et la restauration d'essai ont été validées sur le serveur. Les logs Docker sont limités à trois fichiers de 10 Mo.

L’audit documentaire et le périmètre initial sont dans [l’étude Toggl](docs/ETUDE_TOGGL_STRATEGIE_V1.md) et [le registre des sources](docs/TOGGL_SOURCES.md).
