const roots = new Set(['Dockerfile','.dockerignore','package.json','pnpm-lock.yaml','tsconfig.json','vite.config.ts','index.html','components.json']);
export function releasePath(path) {
  if (roots.has(path)) return true;
  if (!/^(server|public|scripts|src|web-assets|dist\/web)\/[a-zA-Z0-9_.\/-]+$/.test(path)) return false;
  return path.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.'));
}
export function runtimePath(path) {
  return ['package.json','pnpm-lock.yaml'].includes(path) || /^(server|public|scripts|dist\/web)\//.test(path);
}
