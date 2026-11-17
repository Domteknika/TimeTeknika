# Journal de suivi — installation

Version : **2026.11.16-journal-1**. Cette mise à jour doit être envoyée au serveur ; les modifications sur le PC ne changent pas automatiquement l’application hébergée.

## 1. PowerShell sur le PC

```powershell
scp "C:\Users\Cholier\Documents\Git\Toggleteknika\.qa\releases\timeteknika-2026.11.16-journal-1.tar.gz" dtkserver@10.69.1.146:/opt/timeteknika/
ssh dtkserver@10.69.1.146
```

## 2. Session SSH sur le serveur

```bash
cd /opt/timeteknika &&
mkdir -p .qa &&
tar -xOf timeteknika-2026.11.16-journal-1.tar.gz scripts/install-update.sh > .qa/install-update.sh &&
bash .qa/install-update.sh timeteknika-2026.11.16-journal-1.tar.gz
```

L’installateur vérifie les fichiers, sauvegarde la base et le code actuels, reconstruit l’image puis recrée le conteneur `teknika`. Il conserve `.env`, Compose et le volume de données. Au premier démarrage, l’ancien historique est intégré au journal sans effacer les temps. L’installateur vérifie ensuite la version, les fichiers servis et l’intégrité du journal.

Attendre le message **INSTALLATION TERMINÉE : 2026.11.16-journal-1**. En cas d’échec, l’installation n’est pas validée ; le script indique la sauvegarde du code et ne restaure pas automatiquement l’ancien conteneur.

## 3. Vérification

```bash
sudo docker compose exec -T teknika node scripts/verify-release.mjs https://timeteknika.domteknika.ch
```

Recharger le navigateur avec **Ctrl + F5**. Dans **Mon profil**, vérifier la version **2026.11.16-journal-1**, puis ouvrir **Journal de suivi** avec un compte responsable. Les protections et leurs limites, ainsi que la conservation de points de contrôle séparés, sont décrites dans le [README](../README.md#journal-de-suivi).

Validation locale de l’application : **88 tests réussis**. La création de l’archive ne déploie pas la mise à jour sur le serveur et ne constitue pas une validation Docker distante.
