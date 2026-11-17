# Nginx partagé pour le serveur Ubuntu

## Choix retenu : service Ubuntu natif

La configuration retenue est désormais **Nginx installé sur Ubuntu et géré par systemd**, commun à toutes les applications. Le conteneur décrit plus bas est une ancienne proposition et ne doit pas être lancé en parallèle.

Sur le serveur contrôlé, Nginx est absent et les ports 80, 443 et 8080 sont libres. Installer `nginx` avec apt, désactiver le site d'accueil Ubuntu nouvellement installé en retirant uniquement `/etc/nginx/sites-enabled/default`, puis installer `deploy/nginx-native/reverse-proxy.conf` dans `/etc/nginx/conf.d/reverse-proxy.conf`.

Valider et activer :

```bash
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
curl --fail -H 'Host: timeteknika.domteknika.ch' http://127.0.0.1:8080/health
```

Après validation, changer le service de la route Cloudflare vers `http://127.0.0.1:8080`. Garder `APP_URL` et le conteneur TimeTeknika inchangés. Si nécessaire, revenir au port 4310 dans la route Cloudflare. Ajouter les futures applications sous forme de fichiers distincts dans `/etc/nginx/conf.d/`, avec leur sous-domaine et leur port local. Après chaque changement, exécuter `sudo nginx -t` puis `sudo systemctl reload nginx` uniquement si le test réussit. Les journaux natifs sont dans `/var/log/nginx/` et consultables également via `journalctl -u nginx` pour le service.

Cette configuration native reste à valider sur le serveur avec les commandes ci-dessus. Les principes de routage et tests fonctionnels décrits ci-dessous restent applicables, mais pas les commandes Docker de gestion de Nginx.

## Ancienne proposition : conteneur séparé (non retenue)

Configuration préparée pour Ubuntu 26.04, Docker Compose et cloudflared installé sur l’hôte. À valider sur le serveur : Docker n’est pas disponible sur le poste Windows de préparation.

## Architecture

```text
HTTPS : timeteknika.domteknika.ch
  → Cloudflare Tunnel (cloudflared sur Ubuntu)
  → Nginx : 127.0.0.1:8080
  → TimeTeknika : 127.0.0.1:4310
```

Le tunnel existant ne nécessite déjà aucun port entrant sur le routeur. Nginx centralise les règles de distribution des applications. Chaque application conserve son propre port local ; toutes les routes publiques peuvent viser le même port Nginx 8080. Les services restent indépendants pour leurs mises à jour. Nginx devient un composant commun : son arrêt affecte les services qui passent par lui.

## Installer sans changer le service en cours

Créer `/opt/reverse-proxy`, appartenant au compte administrateur, et y copier le contenu de `deploy/nginx/` (compose.yaml et conf.d/). Ne pas remplacer le Compose de TimeTeknika.

Avant le démarrage, vérifier que le port 8080 est libre :

```bash
sudo ss -ltnp 'sport = :8080'
```

Une sortie sans ligne LISTEN signifie qu’il est libre. Sinon, identifier le service existant avant de choisir un autre port pour Nginx et Cloudflare.

```bash
cd /opt/reverse-proxy
sudo docker compose pull
sudo docker compose run --rm --no-deps nginx nginx -t
sudo docker compose up -d
sudo docker compose ps
curl --fail -H 'Host: timeteknika.domteknika.ch' http://127.0.0.1:8080/health
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: inconnu.invalid' http://127.0.0.1:8080/
```

Résultats attendus : configuration valide, conteneur démarré, `{"status":"ok"}` pour TimeTeknika et `404` pour le nom inconnu. Aucune modification de la base ni redémarrage de TimeTeknika n’est nécessaire.

## Basculer Cloudflare

Dans la route publiée de `timeteknika.domteknika.ch`, remplacer uniquement le service `http://127.0.0.1:4310` par `http://127.0.0.1:8080`. Garder le nom public, le DNS et le jeton existants. Si un réglage « HTTP Host Header » a été ajouté, le retirer ou lui donner la valeur `timeteknika.domteknika.ch` : Nginx distribue selon cet en-tête.

Conserver `APP_URL=https://timeteknika.domteknika.ch` dans le `.env` de TimeTeknika. HTTPS est terminé par Cloudflare ; les liaisons locales utilisent HTTP. Aucune ouverture de port sur le routeur et aucun certificat local supplémentaire ne sont nécessaires dans cette architecture.

Tester depuis le navigateur : connexion, pages, export PDF, démarrage et arrêt d’un chrono. Ouvrir une deuxième session du même utilisateur pour vérifier que les changements sont reçus immédiatement. Les directives `proxy_buffering off` et `proxy_read_timeout` préservent le flux SSE ; elles ne remplacent pas ce test réel.

En cas de problème, remettre immédiatement le service de la route Cloudflare sur `http://127.0.0.1:4310`. TimeTeknika et sa base n’ont pas changé. Consulter les logs avec `sudo docker compose logs --tail=100 nginx` dans `/opt/reverse-proxy`.

## Ajouter un autre service

Publier son port Docker sur la boucle locale, par exemple `127.0.0.1:4320:3000`. Ajouter un autre bloc `server` dans conf.d/, écoutant également `127.0.0.1:8080`, avec son propre `server_name` et un `proxy_pass http://127.0.0.1:4320`. Adapter les paramètres au service : un service utilisant WebSocket demande aussi les en-têtes Upgrade ; ne pas recopier aveuglément le bloc TimeTeknika.

Tester puis recharger sans arrêter Nginx :

```bash
cd /opt/reverse-proxy
sudo docker compose exec nginx nginx -t
sudo docker compose exec nginx nginx -s reload
```

Ajouter dans le même tunnel une route pour le nouveau sous-domaine, avec le même service `http://127.0.0.1:8080`. Garder des routes explicites par application plutôt qu’un domaine générique couvrant tous les noms.

## Entretien

Conserver les configurations Nginx dans les sauvegardes du serveur. Pour une mise à jour de l’image : `sudo docker compose pull`, tester avec la commande `run ... nginx -t` ci-dessus, puis `sudo docker compose up -d`. Le tag `stable-alpine` suit les mises à jour stables ; pour une version reproductible, enregistrer et épingler le digest validé lors de la recette serveur. Un remplacement du conteneur peut interrompre brièvement les connexions ; les sessions SSE de TimeTeknika se reconnectent.

Références : [routes Cloudflare](https://developers.cloudflare.com/tunnel/get-started/), [proxy Nginx et buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).
