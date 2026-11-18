import { migrateDatabase } from '../server/db/postgres.mjs';

const variable = process.argv.includes('--demo') ? 'DEMO_DATABASE_URL' : 'DATABASE_URL';
const databaseUrl = process.env[variable];
if (!databaseUrl) throw Error(`${variable} est requis pour appliquer les migrations PostgreSQL.`);
try {
  await migrateDatabase({ databaseUrl });
  console.log('Migrations PostgreSQL appliquées. Le serveur peut maintenant être démarré.');
} catch (error) {
  // Driver errors may contain connection parameters; do not print the URL or stack.
  const code = error?.code ?? error?.cause?.code;
  console.error(`Migration PostgreSQL échouée${code ? ` (${code})` : ''}. Vérifiez la connexion et les migrations.`);
  process.exitCode = 1;
}
