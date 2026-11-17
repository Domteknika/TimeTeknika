# TimeTeknika — refonte React locale

Cette branche prépare la nouvelle interface React + TypeScript avec shadcn/ui. **SQLite et les données existantes sont conservés. Aucun déploiement ni push automatique.**

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

La démo écoute uniquement sur la boucle locale. Ses données restent dans `data/demo.sqlite`. Un redémarrage conserve les changements et le chrono actif. Ne pas utiliser la démo avec de vraies données ni l’exposer par un tunnel.

Les onglets d’un même navigateur partagent le cookie de connexion : changer de profil change le compte de ce navigateur. Pour tester deux personnes simultanément, utiliser deux navigateurs ou une fenêtre privée séparée. Deux onglets du même compte servent à tester la synchronisation de son chrono.

## Ce qui fonctionne

- Chrono, arrêt, reprise dans une nouvelle entrée, saisie manuelle, correction des horaires et du classement ; descriptions individuelles.
- Démarrage sans tâche ; rubrique **À classer** et rappel dans l’application à partir de l’heure choisie (16 h par défaut). Ces heures restent dans les totaux.
- Création de clients, projets, tâches et affectations multiples **par tous les membres**. Créer un projet n’accorde aucun droit supplémentaire sur les temps.
- Sélection d’une tâche → projet et client déduits. Entrée sans tâche : projet facultatif. Le client découle du projet ; un client interne peut regrouper le travail non facturable.
- Sélecteur de tâches organisé par projets repliables, avec client, couleur et nombre de tâches. Les projets épinglés sont placés en tête, dans la saisie d’une entrée comme dans le chrono ; ils remontent aussi dans la liste des projets du formulaire. Épingles et projets repliés sont personnels, conservés sur le serveur et synchronisés entre sessions. La recherche trouve les tâches des projets repliés sans changer cette organisation.
- Liste et calendrier hebdomadaires : le créneau actif grandit chaque seconde avec le compteur, sans rechargement. Gestion du statut des tâches et archivage des projets/tâches. Arrêter un chrono ne termine pas la tâche commune.
- Chaque date du calendrier affiche son temps travaillé, chrono actif et entrées sans tâche inclus. Les entrées traversant minuit sont réparties entre les journées dans le fuseau Europe/Zurich ; une journée vide affiche **0 h 00**.
- **Mon temps** présente un seul bandeau compact : aujourd’hui, cette semaine avec progression vers l’objectif, solde global et semaines précédentes. Le bouton **À classer** se trouve près des commandes du calendrier ; la flèche du solde global ouvre le détail du calcul. Lorsqu’on consulte une autre semaine, une ligne indique son total enregistré et son objectif.
- **Solde global**, depuis le **26 octobre 2026** : les écarts de toutes les semaines se compensent. Le total saisi est comparé au nombre de semaines × l’objectif hebdomadaire actuel ; l’objectif complet de la semaine en cours est inclus dès lundi, même si elle ne contient encore aucune saisie. Le compteur indique les heures **à rattraper** ou **à récupérer**, indépendamment de la semaine consultée. La date de départ (un lundi) et l’objectif personnel se règlent dans **Mon profil** et sont conservés côté serveur. Les congés ne sont pas encore déduits et un changement d’objectif s’applique à l’ensemble de la période.
- **Semaines précédentes** affiche le cumul à récupérer ou à rattraper jusqu’au dimanche précédent, sans inclure la semaine en cours. Le report se renouvelle chaque lundi et reflète les corrections des anciennes entrées. Pendant la première semaine de suivi, il indique la date du premier bilan.
- Alerte dans l’application lorsqu’un chrono personnel dépasse 6 heures sans interruption, avec durée en direct, arrêt immédiat ou correction de l’heure de fin réelle. Elle apparaît aussi à la réouverture de l’application et reste visible tant que le chrono concerné est actif. Pas d’arrêt automatique ni de notification système lorsque l’application est fermée.
- Rapports par période, client, projet, tâche, personne, description et classement ; regroupement croisé avec les contributions individuelles, totaux finalisés/en cours et découpage des périodes au fuseau Europe/Zurich.
- Quatre vues des rapports : bâtons, courbe, camembert et barres comparatives. Couleurs des projets, durées et parts du total ; les vues chronologiques se regroupent par semaine ou mois sur les périodes longues. Le choix du graphique est personnel, conservé sur le serveur et synchronisé entre sessions.
- **Rapports → Exporter les temps** : constructeur d’exports **CSV, Excel et PDF**. Sélections multiples de collaborateurs, clients, projets et tâches, périodes fixes ou relatives, descriptions, classement, chronos arrêtés/en cours et exclusions ponctuelles. Colonnes choisies, renommées et réordonnées ; détail ou synthèse imbriquée par client/projet/tâche/personne/jour/semaine/mois ; sous-totaux et total facultatifs. Aperçu des données actualisé après synchronisation et toutes les 15 secondes.
- Modèles d’export personnels conservés dans SQLite, synchronisés et protégés contre les écrasements concurrents. Les exclusions ponctuelles et la référence de facture ne sont pas mémorisées dans le modèle. Le PDF A4 reprend le thème rouge pâle, un titre, un émetteur, une référence facultative et une note ; il répète les en-têtes et numérote les pages. Les très larges tableaux passent sur plusieurs volets reliés par numéros de ligne, sans réduire le texte. Excel conserve des durées numériques cumulables au-delà de 24 h ; le CSV protège les textes contre l’interprétation comme formules.
- Listes déroulantes harmonisées dans les formulaires, rapports et paramètres : recherche sans accents, couleurs des projets, initiales des clients et personnes, palette de couleurs et statuts. Navigation au clavier et validation des champs obligatoires conservées.
- Pages **Tâches** et **Projets** : recherche sans accents, filtres combinables par client, projet (tâches), statut et présence de temps. Tri par nom, client, projet, statut, temps croissant/décroissant ou nombre de tâches selon la page. Le client limite les choix de projets ; les archives restent accessibles. Les durées portent sur toutes les dates autorisées et incluent les chronos en cours. Les filtres sont temporaires, conservés pendant la navigation et les mises à jour de l’onglet, sans stockage navigateur ; ils sont réinitialisés au rechargement ou au changement de compte.
- Corrections et suppressions réservées à l’auteur, même face au responsable. Historique des corrections et suppression logique avec rétablissement immédiat.
- Journal en ajout seul : changements, erreurs HTTP, connexions et démarrages/arrêts. Consultation, filtres, export et vérification d’intégrité dans **Mon profil → Journal de suivi**, pour les responsables.
- Notifications en direct entre sessions ; données rechargées du serveur après écriture et reconnexion. Les chronos affichés avancent chaque seconde ; les rapports des chronos actifs sont recalculés toutes les 15 secondes.
- Conflits de version signalés, un seul chrono actif par personne, bascule atomique entre activités, requêtes idempotentes et chevauchements signalés avant confirmation explicite.
- Connexion par identifiant sans email, mot de passe de 8 caractères minimum et générateur de 8 caractères. Premier responsable à l’installation, ajout de membres depuis **Mon profil**. Changement personnel et réinitialisation par un responsable avec révocation des autres sessions. Les anciens comptes conservent leur ancienne adresse comme identifiant.

## Données et architecture

Serveur HTTP Node.js et SQLite via `node:sqlite`. La nouvelle interface utilise React, TypeScript, Vite, Tailwind CSS et shadcn/ui ; les graphiques utilisent Recharts. Les calculs métier et les exports restent sur le serveur. L’ancienne interface est conservée pour comparaison avec `--legacy`.

La base est le fichier local de l’application, jamais un fichier lu/écrit directement par plusieurs navigateurs. Le même serveur est utilisé sur le poste de démonstration et dans le futur conteneur. SQLite utilise WAL, des transactions et des contraintes. Le processus serveur reste unique : ce prototype ne prévoit pas plusieurs réplicas.

Les données métier et préférences sont conservées **uniquement côté serveur**. Aucune utilisation de localStorage, sessionStorage, IndexedDB, service worker, cache métier ou service externe. Le navigateur reçoit les données nécessaires en mémoire pour les afficher, et un cookie de session HttpOnly/SameSite. Les réponses comportent `Cache-Control: no-store`. Les formulaires non envoyés n’ont pas de brouillon durable et seront perdus au rechargement.

Les notifications passent par **Server-Sent Events (SSE)** ; les écritures passent par HTTP. Les événements ne contiennent que la révision globale, pas les entrées privées. Chaque session recharge ensuite son état autorisé. Un formulaire déjà ouvert conserve ses valeurs et sa version ; un conflit est signalé au lieu d’écraser la dernière écriture.

Une coupure réseau n’arrête pas un chrono déjà enregistré : sa durée est calculée depuis l’heure de départ serveur. Les modifications hors connexion ne sont pas mises en file locale. Après une réponse incertaine, le client retente avec la même clé ; en cas d’échec persistant, il invite à vérifier l’état synchronisé avant de recréer l’opération. L’arrêt après reconnexion est horodaté à sa réception : corriger l’horaire si nécessaire.

Les responsables ont ici un périmètre **global sur l’équipe** ; les projets et leurs affectations sont visibles par tous. Les membres ne voient ni les entrées ni les cumuls d’équipe qui permettraient de déduire les heures des collègues.

## Ouvrir un espace vierge

Arrêter la démo avec Ctrl+C, puis :

```powershell
node server/index.mjs
```

La base séparée `data/teknika.sqlite` est créée. Ouvrir http://127.0.0.1:4310 et créer le premier responsable. Ajouter ensuite les personnes dans **Mon profil**. Les comptes n’ont aucune relation avec les identifiants Toggl.

Variables disponibles : `HOST` (127.0.0.1), `PORT` (4310), `DATA_DIR`, `APP_URL` (adresse d’accès complète), `PUBLIC_ORIGIN` (ancien nom), `COOKIE_SECURE` (0/1 sans adresse configurée), `SETUP_TOKEN`. Configurer `APP_URL` avec l’adresse publique exacte ; une adresse HTTPS active automatiquement les cookies sécurisés. L’origine des requêtes, la session et le jeton CSRF sont vérifiés côté serveur.

## Docker — configuration préparée

La [notice complète Ubuntu Server + Cloudflare Tunnel](docs/INSTALLATION_LINUX.md) couvre l’installation depuis un serveur neuf, les comptes, les sauvegardes quotidiennes, la restauration et les mises à jour.

Docker n’est pas installé sur la machine de réalisation : **le conteneur n’a pas été construit ni testé ici**. La configuration fournie doit être validée sur le serveur avant utilisation en équipe.

1. Copier `.env.example` en `.env` et générer un `SETUP_TOKEN` aléatoire avec la commande indiquée dans ce fichier.
2. Exécuter `docker compose up --build -d`.
3. Ouvrir http://localhost:4310 et entrer le jeton lors de la création du premier responsable. Le jeton est requis à travers la couche réseau Docker.
4. Vérifier la santé, créer deux comptes, tester les notifications et la restauration d’une sauvegarde sur une copie.

Le port publié est limité à 127.0.0.1 et le mode démo est désactivé. Pour le tunnel Cloudflare ou le VPN, adapter volontairement le réseau, l’origine et HTTPS ; cette publication n’est pas effectuée par ce prototype. Un proxy doit transmettre le flux `/api/events` sans mise en tampon et tolérer les connexions longues. Le volume `teknika-data` conserve les données. Ne pas employer `docker compose down -v` pour une simple mise à jour : cela supprimerait ce volume.

## Sauvegarde et restauration

Le script utilise l’API de sauvegarde SQLite pour produire un fichier cohérent, y compris pendant que l’application tourne ; ne pas copier uniquement la base active en ignorant ses fichiers WAL.

```powershell
node scripts/backup.mjs data/demo.sqlite data/backups/demo-verifie.sqlite
```

Pour l’espace réel, remplacer `demo.sqlite` par `teknika.sqlite`. La destination doit être nouvelle. Copier ensuite cette sauvegarde vers un emplacement distinct du disque serveur selon votre politique interne. Le script ne programme aucune sauvegarde automatique.

Pour restaurer : arrêter l’application, conserver le dossier de données actuel en secours, créer un **nouveau dossier de données vide**, y placer la sauvegarde sous le nom `teknika.sqlite`, puis démarrer avec `DATA_DIR` pointant sur ce dossier. Ne pas mélanger un ancien fichier WAL avec une base restaurée. Vérifier comptes, entrées, affectations et totaux sur la copie avant de la mettre en service.

## Journal de suivi

Après mise à jour et redémarrage du serveur, les responsables disposent de **Mon profil → Journal de suivi**. Le journal présente 100 événements par page, avec filtres par niveau, catégorie et référence de requête. **Plus anciens** parcourt l’historique ; **Filtrer / Actualiser** revient aux événements récents. Les messages d’erreur affichent une référence également disponible dans l’en-tête HTTP `X-Request-ID` : la rechercher dans le journal relie l’erreur aux changements de la même requête.

Le journal est conservé dans la même base SQLite (`event_log`), donc inclus dans les sauvegardes existantes. Il couvre :

- L’historique métier existant : créations et corrections des temps, suppressions et rétablissements, clients/projets/tâches, comptes et changements de mot de passe (sans le mot de passe).
- Chaque mutation validée, dans la même transaction que ses données. Si son écriture au journal échoue, la mutation est annulée. Une requête rejouée avec sa clé d’idempotence ne duplique pas le changement métier.
- Les réponses HTTP en erreur, les interruptions de connexion, et les requêtes d’écriture terminées, dont connexion/déconnexion et téléchargement d’export. Les traces indiquent méthode, route normalisée, statut, durée, personne authentifiée et référence. Les erreurs internes incluent des emplacements de code, sans leur message brut. Les lectures réussies, aperçus et calculs de rapports ne sont pas journalisés systématiquement.
- Les démarrages et arrêts normaux du serveur, avec sa version au démarrage. Un arrêt brutal peut laisser un démarrage sans arrêt correspondant.

Les traces techniques n’enregistrent ni corps de requête, ni paramètres d’URL, ni en-têtes, cookies, jetons ou mots de passe. L’historique métier contient les valeurs avant/après, notamment les descriptions de travail : les exports du journal restent des données internes. Les échecs HTTP sont enregistrés après l’annulation éventuelle de la transaction ; si la base ne permet plus de les écrire, un signal `journal-write-failed` avec la référence apparaît sur la sortie d’erreur du serveur. Les problèmes survenus uniquement dans le navigateur ou avant d’atteindre le serveur ne sont pas capturés.

**Protection et limites.** Des triggers SQLite refusent UPDATE, DELETE et le remplacement des lignes du journal et de l’historique métier. Chaque événement est lié au précédent par une empreinte SHA-256. La chaîne et sa correspondance avec l’historique sont vérifiées au démarrage et via **Vérifier l’intégrité**. Une altération détectée empêche le démarrage ; conserver la base concernée et restaurer une sauvegarde vérifiée, sans réinitialiser le journal. À la première activation, l’ancien historique est intégré avec l’indication `legacy` : son contenu antérieur n’est pas certifié rétroactivement. Les modifications directes des tables métier par un outil SQL ne sont pas automatiquement journalisées.

Cette protection est locale à l’application, pas un stockage WORM : une personne qui contrôle le fichier SQLite peut supprimer les protections et recalculer une chaîne. La suppression d’une fin valide ou le remplacement de la base ne sont détectables qu’en comparant avec un point de contrôle conservé séparément. **Exporter cette page** télécharge les événements affichés et le point de contrôle global (`count`, `hash`) ; ce fichier n’est pas un export complet du journal. Conserver régulièrement un tel fichier sur un autre emplacement protégé permet de comparer une sauvegarde :

```powershell
# Vérifier la chaîne et l’historique, en lecture seule
node scripts/verify-journal.mjs data/teknika.sqlite

# Comparer aussi avec le point de contrôle d’un export conservé séparément
node scripts/verify-journal.mjs data/backups/teknika.sqlite chemin/vers/timeteknika-journal-123.json
```

La commande renvoie un JSON et un code de sortie non nul si la vérification échoue. Elle accepte aussi comme point de contrôle le JSON produit par une vérification précédente. Le point de contrôle doit dater d’avant la sauvegarde comparée. Il n’y a aucune purge automatique ; surveiller l’espace disque et conserver les sauvegardes hors du serveur. Aucun stockage externe ni envoi automatique n’est configuré.

## Vérifications

```powershell
node --test tests/*.test.mjs
```

Les tests couvrent les droits, les créations multi-personnes, l’idempotence, la concurrence des chronos, les conflits d’édition, les chevauchements, la synchronisation SSE, les cumuls, les journées de 23/25 h, l’installation, la connexion, la persistance et la sauvegarde. Les exports sont vérifiés par calculs, réouverture des fichiers Excel, génération PDF, routes HTTP et interactions DOM isolées du constructeur. Ils utilisent des bases temporaires ; les fichiers de la recette de persistance restent dans `.qa/`.

## Limites assumées de cette version

- Remplissage d’un Excel existant, tableaux croisés, congés, génération de factures, budgets, import Toggl et intégrations : étapes suivantes. Le PDF actuel est un relevé de prestations à joindre à une facture.
- Exports : maximum 370 jours et 20 000 entrées par génération ; l’aperçu affiche les 200 premières lignes, les fichiers contiennent toutes les lignes. Modèles personnels uniquement (50 par personne), aucun envoi automatique. Les valeurs des chronos sont figées à l’instant de génération ; les colonnes Début/Fin retenus correspondent à la portion réellement exportée.
- Les responsables peuvent modifier les identifiants et retirer les accès dans Mon profil. Les heures et l’historique restent conservés ; un chrono actif bloque le retrait. Pas encore de responsable limité à certains projets. La récupération sans email passe par un autre responsable ou le script serveur de secours documenté dans la notice.
- Calendrier de consultation : pas de glisser-déposer ni de planning prévisionnel. Les chevauchements volontaires peuvent superposer des blocs.
- Les rapports chargent les entrées autorisées en mémoire serveur ; pagination et optimisation à prévoir avec le volume réel.
- Le rappel n’est visible que dans l’application ouverte ; aucune notification email ou système.
- Pas de mode hors ligne, de brouillons persistants ni de garantie de récupération d’un texte non envoyé.
- La planification des sauvegardes est fournie pour systemd ; son activation, la copie hors serveur, la supervision et la recette distante restent à effectuer sur le serveur avant adoption. Les logs Docker sont limités à trois fichiers de 10 Mo.

L’audit documentaire et le périmètre initial sont dans [l’étude Toggl](docs/ETUDE_TOGGL_STRATEGIE_V1.md) et [le registre des sources](docs/TOGGL_SOURCES.md).
