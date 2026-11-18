import { defineConfig } from 'drizzle-kit';

// Schema generation/checking is offline. No connection to the current SQLite store.
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './drizzle',
});
