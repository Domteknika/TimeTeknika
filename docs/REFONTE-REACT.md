# Refonte React de TimeTeknika

Travail local sur la branche `codex/react-shadcn`. Aucun déploiement automatique.

## Architecture

- React + TypeScript, Vite, Tailwind CSS et composants officiels shadcn/ui (Radix / Nova).
- Graphiques React Recharts ; calculs métier et exports conservés côté serveur.
- API HTTP Node.js et SQLite conservées, sessions par cookie HttpOnly, CSRF, idempotence, versions et SSE.
- Electron conserve le même contrat HTTP et ses contrôles d’origine.
- Aucun projet Supabase créé et aucune donnée déplacée. SQLite reste adapté au fonctionnement actuel sur un serveur unique. Le changement de base sera évalué si un besoin concret apparaît.

## Aperçu prêt à ouvrir

Double-cliquer sur **Apercu TimeTeknika React.cmd**, puis ouvrir http://127.0.0.1:4312. Le lanceur démarre le serveur en arrière-plan avec le build React et une base fictive dans `.qa/react-preview`. Fermer le navigateur ne coupe pas ce serveur ; un redémarrage de Windows l’arrête.

## Essayer la refonte sans toucher aux données

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Ouvrir http://127.0.0.1:5173. L’API de développement écoute sur 127.0.0.1:4311.
La démonstration utilise exclusivement `.qa/react-demo/demo.sqlite`.
Les données de l’application dans `data/` ou dans le dossier Downloads ne sont pas copiées ni modifiées.

Pour travailler explicitement sur une copie de données réelles, définir `DATA_DIR` vers cette copie et utiliser `pnpm dev:real`. Ne pas exposer le serveur Vite publiquement.

## Build et lancement

```powershell
pnpm build
pnpm start
```

Le serveur utilise `dist/web` quand le build est présent. Sans build, l’ancienne interface reste disponible.
`node server/index.mjs --legacy` force l’ancienne interface pour comparaison.
Le dossier `public/` est conservé pour ce retour et pour les fonctions métier partagées ; les nouveaux écrans sont dans `src/`.
Le Dockerfile construit l’interface dans une étape séparée puis copie le build dans l’image d’exécution.

La livraison React se prépare avec `pnpm release`. La sauvegarde et le retour à la version précédente sont détaillés dans [DEPLOIEMENT-REACT.md](DEPLOIEMENT-REACT.md).

## Vérifications

```powershell
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:ui
pnpm build
```

Les tests navigateur utilisent les données fictives dédiées. Ils couvrent chrono, édition, catalogues, calendrier, rapports, téléchargements, modèles, journal, accès membre et affichage mobile.
Les tests serveur conservent la couverture des autorisations, conflits, chevauchements, exports, changements d’heure et intégrité du journal.
