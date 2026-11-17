import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
// Only build assets and the two public icons can be served. No source/config files.
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
};
export async function serveReact(frontendDir, path, method, res) {
  if (!["GET", "HEAD"].includes(method)) return false;
  const name =
    path === "/"
      ? "index.html"
      : /^\/(favicon(?:-active)?\.svg|assets\/[a-zA-Z0-9_.-]+)$/.test(path)
        ? path.slice(1)
        : null;
  if (!name) return false;
  const root = resolve(frontendDir),
    file = resolve(root, name);
  if (!file.startsWith(root + sep)) return false;
  let buffer;
  try {
    buffer = await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  res.writeHead(200, {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    "Content-Length": buffer.length,
    "X-TimeTeknika-UI": "react",
  });
  res.end(method === "HEAD" ? undefined : buffer);
  return true;
}
