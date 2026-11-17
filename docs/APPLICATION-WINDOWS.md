# TimeTeknika pour Windows

## Installer

Lancer `TimeTeknika-Setup-1.1.0.exe`, choisir le dossier d’installation, puis ouvrir **TimeTeknika** depuis le Bureau ou le menu Démarrer. L’installation se fait pour l’utilisateur Windows courant, sans installation d’un serveur local.

Se connecter avec son identifiant et son mot de passe habituels. L’application utilise directement **https://timeteknika.domteknika.ch**. Il n’y a rien à installer sur Linux et aucune base à copier. Le même installateur peut être distribué aux collègues sous Windows 10/11 x64.

L’installateur est une première livraison interne **non signée par un certificat éditeur**. Windows peut donc afficher un avertissement de réputation ; suivre les règles de votre entreprise pour autoriser cet installateur. Ne pas désactiver les protections Windows. L’empreinte SHA-256 accompagne le fichier dans `SHA256SUMS.txt`.

La version 1.0.1 définit explicitement le logo de la barre des tâches et fournit une icône Windows en neuf tailles. Après mise à jour, si une ancienne icône épinglée reste affichée, détacher cet ancien raccourci puis épingler la fenêtre TimeTeknika relancée depuis le menu Démarrer.

## Les raccourcis

| Raccourci par défaut | Action |
|---|---|
| **Ctrl + Maj + F1 à F5** | Démarrer l’une des cinq tâches affectées |
| **Ctrl + Maj + F9** | Démarrer ou arrêter son chrono |
| **Ctrl + Maj + F10** | Ouvrir / remettre au premier plan TimeTeknika |

Ils fonctionnent lorsque l’application est en arrière-plan et que l’on travaille dans un autre logiciel. Le menu **Raccourcis** permet de remplacer Maj par Alt si la combinaison est déjà utilisée. Un conflit est signalé ; le menu près de l’horloge reste utilisable.

Le démarrage avec **F9** crée une entrée **À classer**, sans tâche ni description. Pour démarrer directement sur une tâche, utiliser F1 à F5 après configuration, ou le sélecteur habituel dans la fenêtre. L’arrêt cible uniquement son chrono en cours, après vérification de son état sur le serveur, y compris s’il a été démarré depuis le navigateur.

Une notification confirme le démarrage ou l’arrêt après réponse du serveur. Les notifications peuvent être masquées par le mode Ne pas déranger de Windows ; l’icône et la fenêtre permettent aussi de contrôler le résultat.

## Configurer les cinq tâches

Ouvrir **Raccourcis → Configurer les 5 tâches…**, dans la fenêtre ou le menu près de l’horloge. Pour chaque touche **F1 à F5**, choisir une tâche dans la liste avec recherche par tâche, projet ou client, puis cliquer sur **Enregistrer les raccourcis**. La croix à droite libère un emplacement. Les changements sont utilisables immédiatement.

Seules les tâches non archivées qui vous sont affectées, dans un projet actif, sont proposées. Une tâche supprimée, archivée ou retirée de vos affectations ne démarre plus : l’application vous invite à modifier le raccourci. **Actualiser les tâches** recharge le catalogue ; une confirmation évite de perdre des modifications non enregistrées.

Un raccourci de tâche arrête l’activité précédente et démarre la tâche choisie en une seule opération sur le serveur. Si cette tâche tourne déjà, il laisse le chrono continuer sans découper l’entrée. Pour arrêter, utiliser **Ctrl + Maj + F9**. Le projet et le client sont ceux de la tâche ; la description démarre vide.

Les cinq affectations sont enregistrées dans le fichier local `task-shortcuts.json`, séparément pour chaque compte TimeTeknika sur ce PC. Elles sont conservées au prochain lancement, mais ne sont pas partagées entre PC. Aucun temps n’est enregistré dans ce fichier. Chacun peut refaire ses choix à tout moment.

Le profil alternatif **Ctrl + Alt** s’applique aux sept touches : F1 à F5, F9 et F10. Un conflit de touches est signalé ; choisir l’autre profil si nécessaire.

## Près de l’horloge Windows

- **Rouge** : chrono en cours.
- **Gris** : chrono arrêté.
- **Ocre** : connexion requise ou état non vérifié.

La croix de la fenêtre masque l’application et conserve les raccourcis. Un clic sur l’icône la réaffiche ; un clic droit propose les actions et réglages. Le menu **Lancer avec Windows** est facultatif et désactivé par défaut ; il démarre ensuite l’application près de l’horloge.

**Quitter TimeTeknika** ferme réellement l’application et désactive ses raccourcis. Cela n’arrête pas le chrono sur le serveur : arrêter le chrono avant de quitter si la journée est terminée.

Les raccourcis ne sont pas disponibles si l’application est quittée, si le PC est éteint / en veille ou si la session Windows est verrouillée. Une action nécessite un accès au serveur. En cas de coupure réseau, aucune commande hors ligne n’est mise en attente pour une exécution ultérieure automatique.

Si une réponse de démarrage / arrêt a été perdue, le prochain appui vérifie la même opération avec la même clé, pour éviter un doublon. Un conflit avec une modification faite sur un autre appareil est signalé et ne force pas cette modification.

## Données et connexion

Les heures, clients, projets, tâches et préférences métier restent dans la base du serveur. La fenêtre utilise une session Chromium en mémoire sans cache disque. Le logiciel enregistre uniquement un cookie technique de connexion chiffré par Windows et les choix locaux des raccourcis (touches et identifiants des tâches, par compte). Aucun mot de passe n’est enregistré par l’application.

Ces fichiers techniques sont dans le dossier utilisateur TimeTeknika (`%APPDATA%\TimeTeknika` pour l’application installée). La déconnexion supprime le cookie mémorisé ; son expiration ou sa révocation par le serveur impose une reconnexion. Les fichiers PDF/Excel/CSV que l’on choisit d’exporter sont enregistrés à l’emplacement choisi.

## Mises à jour

Les écrans et fonctions web viennent du serveur : les mises à jour habituelles Linux sont visibles après **TimeTeknika → Recharger la connexion** (Ctrl + R), ou au prochain lancement.

Les changements du logiciel Windows lui-même (raccourcis, intégration Windows, moteur Electron) demandent une nouvelle version de l’installateur. Il n’y a pas de téléchargement ni d’installation automatique dans cette première version. Fermer l’application via **Quitter**, puis lancer le nouvel installateur. Les données de travail du serveur ne sont pas affectées.

## Construire et vérifier (développement)

Depuis la racine du dépôt avec Node 24 et pnpm :

```powershell
pnpm --dir desktop install --frozen-lockfile
node desktop/node_modules/electron/install.js
pnpm --dir desktop run dist
```

Le livrable se trouve dans `.qa/desktop-release/`. Les dépendances bureau ont leur propre fichier de verrouillage et sont exclues du contexte Docker Linux.

Tests : `node --test tests/desktop.test.mjs` pour l’authentification, le chrono, les conflits et l’idempotence. Le script `desktop/scripts/runtime-smoke.cjs` se lance avec Electron : il utilise un profil isolé et intercepte intégralement les requêtes HTTPS avec des fixtures synthétiques. Il vérifie l’enregistrement des raccourcis natifs, le fonctionnement en arrière-plan, les commandes de chrono, l’isolation et le cookie chiffré, sans envoyer de requête en production.

Références : [raccourcis globaux Electron](https://www.electronjs.org/docs/latest/api/global-shortcut), [sessions en mémoire](https://www.electronjs.org/docs/latest/api/session), [chiffrement Windows](https://www.electronjs.org/docs/latest/api/safe-storage).
