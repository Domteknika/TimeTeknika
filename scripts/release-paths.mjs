const roots = new Set(['Dockerfile','.dockerignore','package.json','pnpm-lock.yaml','tsconfig.json','tsconfig.db.json','drizzle.config.ts','vite.config.ts','index.html','components.json']);
export function releasePath(path) {
  if (roots.has(path) || path === 'deploy/compose.postgres.yaml') return true;
  if (!/^(server|public|scripts|src|web-assets|drizzle|dist\/web)\/[a-zA-Z0-9_.\/-]+$/.test(path)) return false;
  return path.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.'));
}
export function runtimePath(path) {
  return ['package.json','pnpm-lock.yaml'].includes(path) || /^(server|public|scripts|drizzle|dist\/web)\//.test(path);
}
