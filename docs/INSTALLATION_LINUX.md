# TimeTeknika — installation complète sur Ubuntu Server

Notice préparée le 10 novembre 2026 pour 6–7 personnes. Parcours : serveur neuf Ubuntu Server 24.04 LTS, Docker Compose et Cloudflare Tunnel. Les commandes Linux s’exécutent dans le terminal du serveur, sauf les blocs marqués **Windows**. Remplacer les exemples avant exécution.

Cette notice prépare la mise en production : le conteneur, le tunnel et la restauration doivent encore être validés sur votre serveur. Ils n’ont pas été exécutés sur le poste Windows de développement.

## 1. Ce qu’il faut préparer

Prévoir, pour ce petit effectif, 2 cœurs, 4 Go de RAM et 40 Go de SSD comme point de départ à vérifier à l’usage. Utiliser une machine dédiée ou une VM qui reste allumée, reliée au réseau et idéalement protégée par un onduleur. Prévoir également un emplacement de sauvegarde **sur une autre machine**.

Noter vos valeurs :

| Élément | Exemple à remplacer |
|---|---|
| Nom du serveur | `timeteknika` |
| Compte administrateur Linux | `admintek` |
| Adresse locale réservée dans le routeur | `192.168.1.50` |
| Dossier de l’application | `/opt/timeteknika` |
| Adresse publique | `https://temps.votre-domaine.ch` |
| Compte responsable dans l’application | `prenom.nom` |

Le compte Linux, le compte Cloudflare et le compte TimeTeknika sont distincts. Aucun email n’est demandé aux collaborateurs dans TimeTeknika ; l’administration du domaine et de Cloudflare utilise son propre compte.

Le domaine doit être géré dans Cloudflare pour ce parcours. Si `domteknika.ch` sert déjà au site et aux emails, conserver les enregistrements existants : on ajoute uniquement un sous-domaine libre. Faire vérifier toute migration DNS avant de changer les serveurs de noms.

## 2. Installer Ubuntu Server

Télécharger l’image **Ubuntu Server 24.04 LTS amd64** pour un processeur Intel/AMD depuis [les images Ubuntu](https://releases.ubuntu.com/24.04/). Monter l’ISO dans la VM ou préparer une clé USB bootable. Suivre [l’installation officielle Ubuntu Server](https://ubuntu.com/server/docs/basic-installation/).

Dans l’installateur : choisir le clavier, le réseau filaire, le disque prévu, le nom `timeteknika` et un compte administrateur personnel. Le choix d’utiliser tout le disque efface ce disque : vérifier son identité avant confirmation. Activer **OpenSSH Server** pour l’administration à distance. Aucune interface graphique ni application additionnelle n’est nécessaire. Retirer l’ISO ou la clé après installation puis redémarrer.

Réserver l’adresse du serveur dans le DHCP du routeur pour qu’elle reste stable. Relever l’adresse avec :

```bash
hostname -I
```

Depuis **Windows PowerShell** :

```powershell
ssh admintek@192.168.1.50
```

Sur le serveur :

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl openssl ufw unattended-upgrades
sudo timedatectl set-timezone Europe/Zurich
sudo timedatectl set-ntp true
timedatectl
sudo dpkg-reconfigure -plow unattended-upgrades
```

Activer les mises à jour de sécurité. Planifier les redémarrages nécessaires hors des heures de travail.

## 3. Accès administrateur et réseau

Depuis **Windows**, générer une clé SSH si vous n’en avez pas, sans écraser une clé existante :

```powershell
ssh-keygen -t ed25519
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" | ssh admintek@192.168.1.50 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'
ssh admintek@192.168.1.50
```

Tester la connexion dans une deuxième fenêtre avant de fermer la première. Garder la clé privée sur votre poste, jamais dans le projet.

Sur le serveur, autoriser SSH **avant** d’activer le pare-feu :

```bash
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

Ne pas ouvrir ni rediriger le port 4310 sur le routeur. Le fichier Compose le publie uniquement sur `127.0.0.1`. Le tunnel tourne sur le même serveur et y accède localement. L’accès SSH extérieur reste réservé au VPN de l’entreprise ; le tunnel de cette notice publie uniquement l’application web.

## 4. Installer Docker et Compose

Sur une installation Ubuntu neuve, installer depuis [le dépôt officiel Docker](https://docs.docker.com/engine/install/ubuntu/) :

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Cette notice utilise `sudo docker` : aucun ajout au groupe Docker n’est nécessaire. Node.js et les bibliothèques de TimeTeknika seront installés dans l’image Docker.

## 5. Copier le projet depuis Windows

Sur le serveur :

```bash
sudo mkdir -p /opt/timeteknika
sudo chown "$USER:$(id -gn)" /opt/timeteknika
```

Dans **Windows PowerShell**, depuis le projet :

```powershell
cd C:\Users\Cholier\Documents\Git\Toggleteknika
tar -czf "$env:TEMP\timeteknika-code.tar.gz" Dockerfile compose.yaml package.json pnpm-lock.yaml .dockerignore .env.example server public scripts docs README.md
scp "$env:TEMP\timeteknika-code.tar.gz" admintek@192.168.1.50:/opt/timeteknika/
```

Sur le serveur :

```bash
cd /opt/timeteknika
tar -xzf timeteknika-code.tar.gz
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
nano .env
```

Reporter la valeur aléatoire dans `SETUP_TOKEN`. Ne pas utiliser un mot de passe de collaborateur pour ce jeton. Le fichier doit contenir :

```dotenv
SETUP_TOKEN=REMPLACER_PAR_LA_VALEUR_ALEATOIRE
APP_URL=https://temps.votre-domaine.ch
```

`APP_URL` est **l’adresse exacte utilisée par les employés**, sans chemin ni paramètres. HTTPS active automatiquement le cookie sécurisé. Ce champ ne crée ni DNS ni tunnel. En cas de changement d’adresse, modifier `.env`, mettre à jour le tunnel et recréer le conteneur.

L’archive exclut volontairement les données de démonstration, les dépendances Windows et les secrets. Le serveur démarre avec une base neuve `teknika.sqlite` dans son volume Docker. Ne pas transférer `demo.sqlite` en production : ses comptes fictifs et ses données servent aux essais. Une reprise des temps existants doit être préparée séparément avant adoption.

## 6. Démarrer TimeTeknika

```bash
cd /opt/timeteknika
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=80 teknika
curl --fail http://127.0.0.1:4310/health
```

Résultat attendu : `{"status":"ok"}`, puis conteneur `healthy`. Le premier téléchargement et la construction peuvent prendre plusieurs minutes. La politique de redémarrage relance l’application après le redémarrage du serveur. Ne pas exécuter `docker compose down -v` : cela efface le volume de données.

## 7. Configurer Cloudflare Tunnel

Suivre [la procédure officielle Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/). Dans le tableau de bord Cloudflare, ouvrir **Networking → Tunnels**, créer un tunnel nommé `timeteknika-bureau`, puis choisir le connecteur Linux correspondant au serveur.

Installer `cloudflared` sur **l’hôte Ubuntu**, avec les commandes d’installation proposées par Cloudflare. Installer ensuite le service avec le jeton du tunnel :

```bash
sudo cloudflared service install JETON_DU_TUNNEL
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

Le jeton Cloudflare est un secret différent de `SETUP_TOKEN` : ne pas le committer ni l’envoyer aux utilisateurs. Vérifier que le tunnel passe à l’état connecté.

Ajouter la route publique :

| Réglage Cloudflare | Valeur |
|---|---|
| Nom public | `temps.votre-domaine.ch` |
| Type du service local | `HTTP` |
| Adresse du service local | `127.0.0.1:4310` |
| URL complète équivalente | `http://127.0.0.1:4310` |

Le navigateur utilise HTTPS ; la liaison HTTP est locale entre le connecteur et l’application. Ne pas remplacer l’adresse locale par l’adresse publique. Le connecteur a besoin d’une sortie vers Cloudflare, notamment sur le port 7844 ; aucune ouverture entrante du routeur n’est nécessaire.

Si une règle Cloudflare impose la mise en cache de toutes les pages, exclure le sous-domaine de l’application. Les API et le flux `/api/events` doivent être transmis sans mise en cache. En cas de reverse proxy supplémentaire, désactiver la mise en tampon SSE. Les intitulés Cloudflare peuvent évoluer : se référer au lien officiel ci-dessus.

## 8. Créer les comptes

Ouvrir `https://temps.votre-domaine.ch`. La première page demande le nom, l’identifiant, le mot de passe et le jeton de configuration `SETUP_TOKEN`. Créer le premier responsable.

Dans **Mon profil → Ajouter une personne**, renseigner le nom, un identifiant unique (ex. `alex.martin`), le rôle et un mot de passe d’au moins 8 caractères. Le bouton de génération crée un mot de passe de 8 caractères et l’affiche pour transmission directe. Les mots de passe plus longs sont acceptés. Les identifiants ne distinguent pas les majuscules ; les mots de passe les distinguent.

Chaque personne peut changer son mot de passe dans son profil. Un responsable peut réinitialiser celui d’un autre compte ; cette opération déconnecte les sessions de ce compte. Il n’y a pas de récupération par email. Garder deux comptes responsables nominatifs évite de dépendre d’une seule personne.

Dans chaque profil, régler l’objectif hebdomadaire et la date de début du solde avant d’interpréter les compteurs. Le défaut historique du prototype est le 26 octobre 2026 : adapter cette date au démarrage réel de votre équipe.

Le panneau du responsable affiche l’adresse d’accès configurée et l’utilisation de HTTPS. Tous les collaborateurs doivent utiliser cette même adresse, au bureau comme à l’extérieur.

## 9. Sauvegarde quotidienne

Le script fourni réalise une sauvegarde SQLite cohérente pendant l’utilisation, puis la copie dans `/var/backups/timeteknika`. Il ne copie pas simplement le fichier actif et son journal WAL. Tester d’abord :

```bash
cd /opt/timeteknika
sudo bash scripts/backup-linux.sh
sudo ls -lh /var/backups/timeteknika
```

Créer `/etc/systemd/system/timeteknika-backup.service` :

```ini
[Unit]
Description=Sauvegarde TimeTeknika
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/timeteknika
ExecStart=/usr/bin/bash /opt/timeteknika/scripts/backup-linux.sh
UMask=0077
```

Créer `/etc/systemd/system/timeteknika-backup.timer` :

```ini
[Unit]
Description=Sauvegarde quotidienne TimeTeknika

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Puis :

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now timeteknika-backup.timer
sudo systemctl start timeteknika-backup.service
sudo systemctl list-timers timeteknika-backup.timer
sudo journalctl -u timeteknika-backup.service --no-pager -n 40
```

Programmer aussi une copie chiffrée vers votre NAS ou un autre serveur, avec votre outil de sauvegarde. Le script ci-dessus ne réalise **pas** cette copie distante et ne supprime aucune ancienne sauvegarde. Surveiller l’espace disque et définir une rétention, par exemple 30 quotidiennes et 12 mensuelles. Les sauvegardes contiennent les données de l’équipe : limiter leur accès. Conserver séparément `.env` et chaque version de code déployée pour pouvoir restaurer l’ensemble.

## 10. Tester une restauration sans toucher à la production

Choisir une sauvegarde et un nom de volume de test **nouveau**. Exemple à adapter :

```bash
cd /opt/timeteknika
sudo docker volume create timeteknika-restore-test-01
image=$(sudo docker compose images -q teknika)
sudo docker run --rm --user root --entrypoint sh \
  -v timeteknika-restore-test-01:/app/data \
  -v /var/backups/timeteknika:/backups:ro "$image" \
  -c 'test ! -e /app/data/teknika.sqlite && cp /backups/REMPLACER.sqlite /app/data/teknika.sqlite && chown -R node:node /app/data'
sudo docker run -d --name timeteknika-restore-test-01 \
  -p 127.0.0.1:4311:4310 \
  -e APP_URL=http://localhost:4311 \
  -v timeteknika-restore-test-01:/app/data "$image"
curl --fail http://127.0.0.1:4311/health
```

Depuis **Windows**, ouvrir un transfert SSH et laisser la fenêtre ouverte :

```powershell
ssh -L 4311:127.0.0.1:4311 admintek@192.168.1.50
```

Ouvrir `http://localhost:4311`, se connecter avec les identifiants présents dans la sauvegarde, vérifier les personnes, tâches, totaux, dernière journée et un export PDF. Une sauvegarde d’un chrono actif le restaure comme actif ; ne pas confondre sa durée au moment du test avec celle enregistrée au moment de la sauvegarde. Arrêter ensuite uniquement ce conteneur de test :

```bash
sudo docker stop timeteknika-restore-test-01
```

En cas de vraie restauration, arrêter l’application et le timer de sauvegarde, conserver le volume courant intact, restaurer dans un **nouveau volume** comme ci-dessus, puis faire pointer le montage `/app/data` de Compose vers ce volume déclaré `external: true`. Redémarrer avec le code compatible avec cette sauvegarde et contrôler les données avant de rouvrir l’accès. Ne jamais déposer une base restaurée parmi les anciens fichiers WAL/SHM.

## 11. Mettre à jour et dépanner

Avant une mise à jour : prévenir l’équipe, lancer une sauvegarde, conserver le code courant et `.env`, puis transférer le nouveau code sans remplacer `.env`. Exécuter :

```bash
cd /opt/timeteknika
sudo bash scripts/backup-linux.sh
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=80 teknika
```

Un simple retour à un ancien code peut être incompatible avec une migration de base : restaurer ensemble la version et sa sauvegarde si nécessaire. La mise à jour des identifiants renomme l’ancienne colonne email et conserve les anciens identifiants, mots de passe et temps.

| Symptôme | Vérification |
|---|---|
| Cloudflare affiche 502 | Tester `/health` localement, vérifier le service `127.0.0.1:4310` et les logs `cloudflared`. |
| Origine refusée | `APP_URL` doit correspondre exactement à l’adresse HTTPS du navigateur ; recréer le conteneur après modification. |
| Connexion perdue immédiatement | Utiliser l’adresse HTTPS publique avec les cookies sécurisés, pas l’adresse HTTP du serveur. |
| Données plus synchronisées | Vérifier que le proxy ne met pas `/api/events` en cache ou en tampon. |
| Trop de tentatives | Attendre 15 minutes ; la limitation actuelle est par adresse réseau, donc partagée derrière le tunnel. |
| Tous les responsables ont perdu leur mot de passe | Utiliser la procédure serveur ci-dessous. |
| Sauvegarde échouée | Vérifier le service systemd, le conteneur et l’espace libre avec `df -h`. |

Réinitialisation de secours, dans **Bash sur le serveur** (le mot de passe ne figure pas dans la ligne de commande) :

```bash
cd /opt/timeteknika
sudo -v
read -rsp 'Nouveau mot de passe : ' new_secret
printf '\n'
printf '%s' "$new_secret" | sudo docker compose exec -T teknika node scripts/reset-password.mjs prenom.nom
unset new_secret
```

## 12. Vérifications avant ouverture à l’équipe

- Tester l’adresse en 4G/5G et sur le réseau du bureau ; vérifier HTTPS.
- Vérifier qu’aucun compte de démonstration n’est proposé.
- Créer deux utilisateurs réels et tester dans deux navigateurs séparés.
- Vérifier qu’un membre ne voit que ses temps, et qu’un responsable voit ceux de l’équipe.
- Démarrer/arrêter un chrono, corriger une entrée, vérifier la synchronisation et télécharger un PDF.
- Vérifier la date initiale du solde et l’objectif de chaque personne.
- Redémarrer le serveur puis vérifier application, tunnel et données.
- Vérifier la sauvegarde automatique, sa copie hors du serveur et une restauration complète.

La suppression/désactivation des comptes, l’historique des objectifs hebdomadaires et les congés ne sont pas encore disponibles. La date du démarrage réel et la reprise éventuelle des données du prototype doivent être décidées avant la bascule définitive.
