# Recette du premier prototype — 28 octobre 2026

## Automatisation

Commande : `node --test tests/app.test.mjs` avec Node.js 24.22.1.

**15 tests réussis, 0 échec.**

- Création de clients, projets et tâches à plusieurs participants par un membre ; aucun gain de privilège sur les temps.
- Lecture filtrée côté serveur, y compris dans les rapports ; impossibilité pour le responsable de modifier ou supprimer les heures d’un autre auteur.
- Historique des corrections, suppression logique et restauration par l’auteur.
- Rejet des modifications basées sur une version périmée.
- Un seul chrono actif par personne et bascule atomique entre activités ; protection contre les doubles requêtes.
- Cohérence tâche/projet/client, affectations, protection des rattachements historiques.
- Détection des chevauchements, confirmation explicite et validation des horaires.
- Addition exacte de contributions simultanées à une même tâche sans multiplier les heures par le nombre de participants.
- Notification SSE après écriture, sans contenu privé, puis relecture de l’état autorisé.
- Connexion, CSRF, origine, cookies techniques, absence de cache et désactivation du raccourci de démo derrière un proxy.
- Installation vierge et authentification avec mot de passe.
- Découpage des périodes à minuit et journées de 23/25 heures en Europe/Zurich.
- Conservation des entrées de durée nulle dans les rapports et possibilité de corriger leur description.
- Démarrage/arrêt simultané dans sept sessions, sans perte ni confusion d’auteur. Il s’agit d’un test fonctionnel de concurrence, pas d’une mesure de performance réseau.
- Données, préférences, chrono et sauvegarde cohérente conservés après réouverture de SQLite.
- Contrôle des sources de l’interface : aucune API de stockage navigateur ni dépendance distante.

## Vérifications dans le navigateur

Sur le serveur de démonstration local, avec les personnages et projets fictifs :

1. Connexion comme Alex, sélection de « Plans d’exécution », démarrage puis arrêt du chrono.
2. Correction de la description de l’entrée ; durée et rattachement conservés.
3. Connexion comme Emma : seuls ses temps apparaissent, y compris dans les rapports et cumuls des tâches.
4. Création par Emma de « Vérification croisée des plans », affectée à Emma et Lucas.
5. Modification de son statut dans un onglet ; lecture du nouveau statut dans un deuxième onglet sans rechargement.
6. Consultation du calendrier hebdomadaire avec les entrées existantes.
7. Rapport responsable filtré sur « Résidence Les Cèdres » et regroupé par tâche : contributions individuelles distinctes d’Emma et Alex sur « Plans d’exécution ».
8. Vérification du retour après redémarrage du serveur ; données de la démonstration conservées.
9. Aucune erreur JavaScript relevée sur les parcours consultés.

Une sauvegarde de la démonstration a aussi été produite avec `scripts/backup.mjs` pendant que le serveur était actif.

### Ajout : créneau de calendrier en direct

Le bloc du chrono actif utilise désormais le même instant que le compteur et se redimensionne chaque seconde. Vérification dans le navigateur sans rechargement : entre 00:00:10 et 00:01:11, la hauteur est passée de 0,135 à 0,979 px à l’échelle de la grille, avec une position de départ identique et une durée strictement égale au compteur. À l’arrêt, le bloc redevient une entrée fixe. La taille minimale des entrées terminées est conservée pour pouvoir les sélectionner ; elle ne retarde plus la croissance visuelle d’un chrono qui vient de démarrer. Aucun enregistrement serveur supplémentaire n’est nécessaire pour cette animation.

### Ajout : listes de classement dans « Saisir du temps »

La création et la modification d’une entrée proposent des listes recherchables pour les tâches, projets et clients : couleurs des projets, regroupement des tâches par projet, participants et sélection courante. Les clients portent une pastille d’initiales à couleur stable et les couleurs de leurs projets.

Parcours vérifiés dans le navigateur : recherche sans accents, sélection avec les flèches et Entrée, fermeture de la liste avec Échap sans fermeture du formulaire, absence de résultats, reprise du classement d’une entrée existante et retour à « À classer » en conservant le projet. Une tâche remplit son projet et son client ; changer de projet retire une tâche incompatible. Choisir un client ouvre ses projets et un client seul ne peut pas être enregistré sans projet. Les champs de description et d’horaires restent en place. Aucun temps n’a été créé ou modifié pendant cette recette et le chrono déjà actif a été conservé. Vérification de syntaxe JavaScript réussie, aucune erreur JavaScript relevée dans le navigateur.

### Ajout : créer une tâche depuis la saisie du temps

Un bouton « Créer une tâche » apparaît en bas de la liste des tâches, hors de la zone des résultats défilants, y compris en cas de recherche sans résultat. Le formulaire intégré reprend la recherche comme nom et propose le projet courant. La personne connectée est participante pour pouvoir saisir son temps ; elle peut affecter d’autres collègues. Après création, la tâche et son projet/client sont sélectionnés sans remplacer le formulaire d’entrée. La création de la tâche et l’enregistrement de l’entrée restent deux validations distinctes.

Recette dans une instance séparée avec une base en mémoire : Emma crée une tâche avec Lucas, puis enregistre une entrée de 08:15 à 09:00. Nom recherché, description et horaires sont conservés, sélection automatique et enregistrement réussis. Vérification du retour à la liste avec Échap sans perte du brouillon. Lecture via le compte Lucas : nouvelle tâche visible avec les deux affectations et le bon projet, entrée d’Emma non exposée. Aucune erreur JavaScript relevée. Les données de l’instance principale et son chrono actif sont préservés.

### Ajout : calendrier réglable, sélection de créneaux et objectif hebdomadaire

- Choix personnel de 5 jours ouvrés (lundi–vendredi) ou 7 jours et zoom de 50 à 200 %, conservés côté serveur. Les 24 heures restent accessibles par défilement ; changer de zoom conserve l’heure visible.
- Glisser à la souris ou au stylet dans une zone libre ouvre une saisie préremplie, par pas de 15 minutes. Sélection vers le haut ou le bas, défilement automatique au bord visible, annulation avec Échap. Les entrées existantes restent cliquables. Au clavier, Entrée sur une journée ouvre la saisie ; sur écran tactile, la grille conserve son défilement et le bouton de saisie reste disponible.
- Objectif en heures dans « Mon espace », sans valeur imposée. Le compteur « Reste cette semaine » porte sur la semaine actuelle du lundi au dimanche en Europe/Zurich, même en naviguant vers une autre semaine ou en masquant le week-end. Il inclut les entrées non classées et le chrono actif, avec progression et dépassement éventuel. Les jours de congé ne sont pas encore déduits.

Validation : 18 tests automatisés réussis, dont la validation et l’isolation des préférences, leur conservation au redémarrage, les bornes de sélection et les calculs de progression avec week-end et limite de semaine. Dans une instance de test séparée, objectif de 42 h 30 et 4 h 30 déjà saisies : 38 h restantes. Un glisser de 09:00 à 10:00 a prérempli puis enregistré une entrée d’une heure, faisant passer le reste à 37 h. Zoom 125 % : échelle passée de 50 à 62,5 pixels/heure, position conservée à environ 07:00. Rechargement et second onglet : préférences retrouvées ; changement de 5 à 7 jours répercuté dans le premier onglet sans rechargement. Chrono actif : progression passée de 12,9487 % à 12,9794 % entre 11 et 58 secondes, avec croissance simultanée du bloc. Le serveur principal a été relancé en conservant son chrono et ses données.

### Ajout : graphiques des rapports et nom TimeTeknika

Les rapports proposent quatre vues : bâtons et courbe pour l’évolution des heures, camembert et barres horizontales pour les comparaisons par projet, tâche, client ou personne. Les catégories cumulent les contributions par identifiant, sans fusionner des noms identiques et sans recompter les lignes du tableau individuel. Les couleurs des projets sont conservées ; les durées et pourcentages sont disponibles dans la légende et au survol ou au clavier. Les périodes de plus de 31 jours passent aux semaines, puis aux mois au-delà de 112 jours, en conservant les bornes exactes du filtre.

Le choix du graphique est une préférence personnelle validée et conservée en SQLite, synchronisée via le mécanisme existant. Aucun stockage ni service externe ajouté au navigateur. Le titre de page, le chargement, la connexion, la marque dans la navigation, le nom du paquet et la documentation utilisent TimeTeknika. Les identifiants techniques de stockage existants restent compatibles.

Validation : 21 tests réussis, incluant les cumuls des tâches partagées, les noms identiques avec identifiants distincts, les périodes jusqu’à 370 jours, les bornes partielles, les catégories vides ou uniques, l’échappement HTML, la confidentialité et les préférences au redémarrage. Dans une instance séparée en mémoire : quatre vues affichées, regroupement par tâche (Plans d’exécution : 4 h 30 pour deux personnes), filtre Interne (1 h, 100 %), absence de résultat, regroupement mensuel automatique, préférence retrouvée après rechargement et passage de Courbe à Barres répercuté dans un second onglet sans rechargement. Le compte Emma affiche uniquement ses 4 h 30 personnelles. Aucune erreur JavaScript observée. L’instance principale a été relancée et son chrono actif conservé ; aperçu enregistré dans `docs/screenshots/timeteknika-reports.png`.

### Ajout : listes déroulantes harmonisées

Les treize sélecteurs natifs restants partagent un composant visuel : six filtres de rapport, client et couleur du nouveau projet, projet et statut des tâches, rôle du nouveau membre, heure de rappel et projet de la création rapide de tâche. Les contrôles natifs restent présents mais masqués pour les valeurs de formulaire et les contraintes de validation. Les menus utilisent la couche d’affichage des popovers pour sortir de la zone défilante des fenêtres, s’ouvrent au-dessus si nécessaire et gardent leurs résultats défilables. Les listes longues proposent une recherche sans accents ; les couleurs, avatars, sous-titres et cases de sélection suivent la présentation de la saisie du temps.

Recette effectuée dans une instance distincte en mémoire :

- Nouveau projet : refus si le client manque, recherche « nova », sélection avec les flèches et Entrée, palette de six couleurs, enregistrement avec Nova Immobilier et Sauge.
- Nouvelle tâche : projet retrouvé par recherche, statut En cours et affectation à Alex et Emma conservés. Modification : valeurs reprises puis statut Terminée enregistré.
- Rapports : chacun des six menus ouvert et sélectionné ; recherche « cedres » retrouvant Résidence Les Cèdres ; client/projet/tâche liés correctement. Plans d’exécution filtré sur Emma donne 2 h 30 ; ajouter À classer uniquement donne un rapport vide. Absence de résultat explicite pour une recherche inconnue.
- Paramètres : rappel 17:00 retrouvé après rechargement. Les deux rôles du formulaire de compte sont lisibles et sélectionnables ; aucun compte créé pendant cette recette.
- Saisie du temps : sélecteurs existants de client, projet et tâche contrôlés. Création rapide d’une tâche avec Lucas : son menu Projet fonctionne ; Échap ferme seulement ce menu et conserve le formulaire imbriqué. La tâche est créée et une entrée d’une heure enregistrée avec sa description et ses horaires.
- Clavier : flèches, Entrée, Espace, Fin, Échap et Tab vérifiés. Tab quitte le menu vers le champ suivant ; Entrée sur la croix ferme la liste. Une synchronisation provoquée depuis un deuxième onglet conserve le menu ouvert et la recherche « cedres ».

Le sélecteur du chronomètre a également été contrôlé : recherche de la tâche rapide, sélection et rattachement projet/client visibles sans démarrer de chrono. Les choix vides des champs obligatoires ne sont plus présentés comme des options de liste ; la validation du champ reste active.

Les 21 tests existants ont réussi ; syntaxe JavaScript vérifiée après la finition clavier, aucune erreur JavaScript relevée sur les parcours testés. Aucun stockage navigateur supplémentaire ni dépendance distante ajouté. L’instance principale a été mise à jour sans modifier ses temps ; aperçu final : `docs/screenshots/timeteknika-rich-dropdowns.png`.

### Ajout : solde hebdomadaire et chrono oublié

Le solde suit désormais la semaine affichée dans « Mon temps », à côté de sa période, en liste comme en calendrier. Il additionne les 7 jours, même lorsque le calendrier masque le week-end, et reste indépendant des heures des collègues. Aucun objectif quotidien : « Reste à travailler » pendant la semaine, « À rattraper » après sa clôture, puis « Objectif atteint » ou « Objectif dépassé » selon le total. Le calcul des anciennes semaines utilise l’objectif personnel actuel, sans report de solde. Le bandeau des métriques « Cette semaine » conserve sa référence à la semaine actuelle. Les dates se renouvellent à minuit en Europe/Zurich.

Un chrono personnel actif pendant plus de 6 heures déclenche un message ponctuel et un bandeau persistant sur les différentes pages. La durée continue à avancer ; le cumul d’une tâche partagée ne déclenche rien. « Corriger l’heure de fin » ouvre la saisie avec une fin obligatoire, vide et focalisée : l’utilisateur renseigne l’heure réelle. « Arrêter maintenant » utilise l’arrêt habituel. Le chrono n’est jamais arrêté automatiquement. Le solde signale aussi qu’un chrono long mérite vérification. Les rappels fonctionnent dans l’application ouverte ou à sa réouverture, sans notification système hors application ni nouvelle préférence persistée dans le navigateur.

Validation : 24 tests automatisés réussis. Les nouveaux cas couvrent le seuil exact des 6 heures, le dépassement après une nuit, l’isolation des personnes, l’absence d’alerte pour les entrées terminées, les 7 jours, le déficit après dimanche, le rattrapage par le week-end, les objectifs nuls/désactivés et les changements d’heure. Un test HTTP avec base en mémoire corrige un chrono de 7 heures en une entrée terminée de 2 heures : l’autre session retrouve la correction et le reste à travailler passe de 1 à 6 heures pour un objectif de 8 heures. Une tentative d’arrêt avec l’ancienne version est rejetée. Syntaxe JavaScript vérifiée ; serveur principal disponible (santé HTTP 200), sans modification de ses entrées.

Le contrôle visuel de cet ajout reste à faire : l’accès de l’outil navigateur à l’instance locale a été refusé par sa politique de sécurité, sans contournement.

### Évolution : solde global depuis le 26 octobre 2026

Le compteur principal « À rattraper / À récupérer » additionne désormais toutes les semaines depuis le lundi 26 octobre 2026, indépendamment de la semaine parcourue dans la liste ou le calendrier. L’objectif entier est inclus dès le lundi, conformément au choix utilisateur. Formule : heures saisies depuis le départ jusqu’à maintenant, moins nombre de semaines commencées × objectif hebdomadaire actuel. Les semaines sans entrée comptent également. Les heures avant le départ sont exclues du solde mais restent disponibles dans les rapports. Les corrections et suppressions rétroactives recalculent les heures sans déplacer la date de départ. Le chrono actif fait progresser le solde ; l’avertissement après 6 h reste visible.

Le départ par défaut est conservé dans SQLite (`meta.balance_start`) ; chaque personne peut définir son lundi de départ dans « Mon espace », avec validation serveur et synchronisation entre sessions. La navigation du calendrier ne modifie pas le solde global. Le détail de chaque semaine reste disponible sous la navigation. L’objectif actuel s’applique à toute la période : cette version n’historise pas les changements de durée contractuelle et ne déduit pas les congés.

Validation : 27 tests automatisés réussis. Nouveaux scénarios : deux semaines à 40 h avec 75 h saisies → 5 h à rattraper ; 83 h saisies → 3 h à récupérer ; semaine vide ajoutée dès lundi ; saisie avant le 26 octobre ; chrono traversant la date de début ; correction d’une semaine passée ; objectif nul ou désactivé ; départ futur ; changement d’année et semaines de changement d’heure. Dates invalides et non-lundis rejetés sans enregistrer partiellement l’objectif ; préférence isolée entre personnes, synchronisée entre sessions et conservée au redémarrage. Une sauvegarde SQLite a précédé le redémarrage du serveur principal.

Le contrôle visuel reste à faire, pour la même restriction de l’outil navigateur signalée ci-dessus.

### Ajout : indicateur des semaines précédentes

Un indicateur compact dans le bloc « Solde global » affiche désormais les heures à récupérer, à rattraper ou l’équilibre des semaines terminées. Il reprend la date de départ personnelle et l’objectif actuel, avec une borne exclusive au lundi de la semaine courante en Europe/Zurich. Les semaines sans entrée comptent ; les temps de la nouvelle semaine et sa cible sont exclus. Les corrections anciennes restent synchronisées. Une entrée commencée le dimanche et encore active le lundi est limitée à minuit pour ce report. Le solde global conserve son calcul incluant l’objectif complet de la semaine courante.

Pour le départ au 26 octobre 2026, la première semaine affiche 0 h, « Aucune semaine terminée » et « Premier bilan le 2 novembre 2026 ». La navigation du calendrier ne déplace pas la période de cet indicateur. Aucune donnée ni préférence supplémentaire n’est enregistrée.

Validation : syntaxe JavaScript correcte, 29 tests automatisés réussis et santé du serveur HTTP 200. Les nouveaux cas vérifient le report de −5 h au lundi sur deux semaines à 40 h totalisant 75 h, son indépendance vis-à-vis de 3 h saisies dans la nouvelle semaine, une correction historique passant le report à +3 h, l’ajout de la semaine suivante, l’absence d’historique initial et la limite à minuit pour un chrono traversant le lundi. Le contrôle visuel demeure non effectué en raison de la restriction de l’outil navigateur déjà signalée.

### Évolution : alléger « Mon temps » et regrouper le profil

Les grandes cartes et les deux blocs de solde sont remplacés par un bandeau unique : aujourd’hui, progression de la semaine courante, solde global et report des semaines précédentes. Les valeurs se mettent à jour chaque seconde. Le détail des dates, heures et objectifs est accessible par la flèche du solde global. Le rappel « À classer » prend la forme d’un bouton près des commandes de la liste et du calendrier ; sa couleur évolue à l’heure choisie. Une semaine différente de la semaine actuelle affiche uniquement une ligne de total et d’objectif sous la navigation.

La rubrique « Mon espace » devient « Mon profil ». L’identité, l’objectif hebdomadaire et la date de début du suivi sont regroupés en tête, avec les rappels dans une section distincte. Les réglages d’objectif ne sont plus proposés dans « Mon temps ». Les règles de calcul, le stockage serveur et les alertes de chrono oublié sont conservés. Le bandeau passe de quatre à deux colonnes sur les écrans plus étroits.

Validation : syntaxe JavaScript correcte et 29 tests automatisés réussis, incluant les cumuls, les bornes des semaines, les corrections anciennes, la persistance et la synchronisation des préférences. La première exécution des tests HTTP a été bloquée par les restrictions réseau du bac à sable ; la relance avec l’accès local autorisé a réussi. Le contrôle visuel de cette refonte reste à faire : l’accès de l’outil navigateur à l’instance locale a été refusé par sa politique, sans contournement. Les données de démonstration et le chrono en cours n’ont pas été modifiés.

### Ajout : tâches regroupées dans des projets repliables et épinglés

Les sélecteurs de tâches du chrono et de création/modification d’entrée partagent la même organisation : projets regroupés par identifiant, tri par nom, projets épinglés en tête, puis tâches triées dans chaque groupe. Chaque en-tête présente le client, la couleur, le nombre de tâches, une commande de repli et une épingle indépendante de la sélection. Les favoris remontent également dans la liste des projets du formulaire. « À classer plus tard » et la création rapide de tâche restent accessibles.

Les préférences personnelles sont stockées dans SQLite (`preferences.taskProjects`). Les modifications portent sur un seul projet et un seul indicateur à la fois, avec fusion dans la transaction serveur pour conserver les changements des autres sessions. La recherche sans accents porte sur les tâches, projets et clients ; elle développe les résultats, y compris dans les groupes habituellement repliés. Les replis pendant une recherche sont temporaires. Vider la recherche rétablit l’organisation enregistrée. Le rafraîchissement des listes lors d’une synchronisation conserve la recherche et les champs du formulaire ; le focus est repris sur le même contrôle lorsqu’il existe encore. Les boutons repliés sont exclus de la navigation avec les flèches.

Validation : syntaxe JavaScript correcte et 33 tests réussis. Les nouveaux cas couvrent les projets homonymes, le tri naturel, les favoris, les recherches dans les groupes repliés, les affectations et archives, les préférences distinctes par personne, la fusion entre sessions, les valeurs invalides, le désépinglage, la notification SSE et la persistance après redémarrage. Le serveur et le nouveau module répondent HTTP 200 après relance. Une sauvegarde SQLite a été créée avant relance ; les 60 entrées sont identiques à la sauvegarde et le chrono actif est conservé.

Le contrôle visuel et la recette interactive des commandes clavier restent à faire : l’accès de l’outil navigateur à l’instance locale demeure indisponible à la suite du refus de sa politique, sans contournement.

### Évolution : thème Domteknika et total quotidien du calendrier

Le site de référence [domteknika.ch/en](https://domteknika.ch/en) a été consulté visuellement : fonds blancs et gris, textes noirs, accents rouges et boutons arrondis. L’application reprend cette direction en adoucissant les commandes : fond rouge pâle `#edbfc3`, texte contrasté `#6e3039` et surfaces très légèrement teintées. La typographie utilise Arial/Helvetica, les polices de repli du site, sans dépendance distante. Les états, menus, formulaires, connexion et graphiques chronologiques suivent le thème. Les couleurs enregistrées des projets, tâches, personnes et catégories des rapports restent inchangées.

Chaque en-tête de journée du calendrier présente un total « 8 h 24 » sous la date, avec un libellé accessible de temps travaillé. Le total inclut les entrées sans tâche et évolue avec le chrono actif. Les plages sont limitées aux deux minuits de la journée en Europe/Zurich, y compris les journées de 23 ou 25 heures. Les semaines consultées, le mode 5/7 jours et le zoom conservent leur comportement. Une journée vide affiche « 0 h 00 ».

Validation : syntaxe JavaScript correcte et 35 tests automatisés réussis. Les nouveaux scénarios vérifient l’addition des entrées classées et non classées, l’exclusion des entrées supprimées, la répartition à minuit, le chrono en direct et les changements d’heure. Le contrôle visuel du site de référence est réalisé ; celui de l’application locale reste à faire à cause du refus d’accès de l’outil navigateur déjà signalé. Aucun contournement, aucune modification de donnée métier ni ajout de stockage navigateur.

### Ajout : filtres et tris dans Tâches et Projets

Une barre compacte propose la recherche par nom de tâche, projet ou client, sans accents, et des menus colorés cohérents avec les autres sélecteurs. Les tâches se filtrent par client, projet, statut et présence de temps, en conservant « Mes tâches / Toute l’équipe ». Les projets se filtrent par client, actifs/archivés/tous et présence de temps. Choisir un autre client efface seulement un projet devenu incompatible. Le compteur de résultats et le bouton Réinitialiser restent visibles ; les résultats vides proposent de retirer les filtres.

Les tris proposés sont nom A–Z/Z–A, client, temps croissant/décroissant, ainsi que projet et statut pour les tâches, nombre de tâches pour les projets. Le tri des noms est naturel en français. Le total de projet inclut aussi les entrées sans tâche et les temps de tâches archivées ; les tâches archivées ne comptent pas dans la progression active. Les chronos mettent à jour les durées et le classement chaque seconde, sans reconstruire systématiquement les contrôles focalisés. Les durées sont calculées uniquement depuis le snapshot autorisé du serveur : ses heures pour un membre, celles de l’équipe pour un responsable. La portée « toutes dates · chronos inclus » est affichée.

Les filtres et tris restent en mémoire pendant la navigation et les synchronisations de l’onglet ; aucun stockage navigateur ni nouvelle préférence persistante. Ils sont réinitialisés après rechargement ou changement de personne. Aucun changement de base ni redémarrage du serveur principal.

Validation : syntaxe JavaScript correcte et 38 tests automatisés réussis. Les nouveaux cas vérifient filtres combinés, affectations, projets homonymes, recherche sans accents, tris naturels et numériques, entrées supprimées, temps sans tâche, archives, évolution du chrono, durée nulle, données visibles par un membre et listes vides. Le contrôle visuel et les interactions dans l’application locale restent à vérifier : l’accès de l’outil navigateur a été refusé par sa politique, sans contournement.

### Ajout : constructeur d’exports CSV, Excel et PDF

Entrée depuis **Rapports → Exporter les temps**. Trois zones : sélection des temps, composition des colonnes/regroupements, aperçu et téléchargement. Les sélections multiples distinguent explicitement Tous (`null`) et Aucun (`[]`), disposent d’une recherche, de couleurs et d’étiquettes retirables. Clients/projets/tâches dépendent des sélections parentes. Les entrées sans tâche ou sans projet et les archives restent disponibles. Les modèles personnels enregistrent la configuration dans `export_templates` avec version, propriétaire, idempotence, notification SSE et refus des modifications concurrentes. Une suppression distante libère la configuration locale sans perdre les réglages en cours.

Le moteur serveur commun découpe les durées aux bornes de la période en Europe/Zurich ; les regroupements journaliers/hebdomadaires/mensuels répartissent également les entrées traversant minuit. Les groupes utilisent les identifiants, même pour des noms identiques. Les compteurs d’entrées utilisent des identifiants distincts aux niveaux cumulés. Les rôles sont contrôlés côté serveur pour l’aperçu, les téléchargements et les modèles. Les chronos arrêtés sont sélectionnés par défaut ; les actifs sont facultatifs et figés à l’instant de génération. L’aperçu est mis à jour après modification, synchronisation et toutes les 15 secondes. Le téléchargement est calculé à partir d’un même snapshot pour l’intégralité du fichier.

Les fichiers reprennent les colonnes sélectionnées, leurs titres et leur ordre. CSV UTF-8 avec séparateur point-virgule et neutralisation des débuts de formule. Excel : valeurs numériques, durées `[h]:mm:ss`, colonnes filtrables, en-têtes figés, total par formule sans double comptage des sous-totaux. PDF A4 portrait/paysage automatique ou choisi, polices embarquées sous licence OFL, titre/émetteur/référence/note, en-têtes répétés, numéros de page et descriptions longues poursuivies sans troncature. Les tableaux trop larges sont répartis en volets avec numéros de ligne communs. PDFKit et ExcelJS sont installés localement, versions fixées dans `pnpm-lock.yaml` ; Docker installe uniquement les dépendances de production. Aucun appel externe lors de la génération.

Validation : contrôles unitaires et HTTP, réouverture Excel, vérification de la pagination PDF, test DOM isolé des filtres, colonnes, regroupements, exclusions, modèles et téléchargement. Les PDF de recette (une page de synthèse et dix pages de détail avec tous les champs et une longue description) ont été rendus et contrôlés visuellement. Les données principales ont été sauvegardées dans `data/backups/teknika-2026-10-29T10-14-35-161Z.sqlite` avant relance : 62 entrées identiques après redémarrage et un chrono actif conservé ; `/health` répond OK.

La recette interactive dans le navigateur local reste à faire : l’accès de cet outil a été refusé par sa politique, sans contournement. Les tests DOM exécutent le composant avec des données fictives et sans navigation ni accès à l’application locale. Limites explicites : 370 jours, 20 000 entrées, aperçu de 200 lignes, 50 modèles personnels ; pas de remplissage d’un Excel existant, de partage de modèles ni de facturation automatique.

## Non vérifié ici

- Construction et fonctionnement du conteneur : Docker absent de cette machine.
- Tunnel Cloudflare, VPN, HTTPS distant et performances sur le réseau du bureau.
- Recette réelle sur téléphone : les styles adaptatifs sont présents, mais le contrôle de viewport de l’outil d’aperçu n’a pas appliqué la largeur demandée ; le rendu étroit n’a donc pas été validé visuellement.
- Test de charge prolongé, sauvegardes planifiées, rétention, récupération des comptes et migration de données Toggl.

Ces points n’empêchent pas l’essai local avec des données fictives ; ils sont à traiter avant une mise en service pour l’équipe.
