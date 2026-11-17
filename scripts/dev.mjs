import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const demo = !process.argv.includes("--real");
const env = { ...process.env, HOST: "127.0.0.1", PORT: "4311" };
if (demo) env.DATA_DIR = resolve(".qa/react-demo");
const server = spawn(
  process.execPath,
  ["server/index.mjs", ...(demo ? ["--demo"] : [])],
  { stdio: "inherit", env },
);
let vite,
  closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  server.kill();
  vite?.kill();
  process.exitCode = code;
}
server.on("exit", (code) => close(code ?? 1));
server.on("error", (error) => {
  console.error(error.message);
  close(1);
});
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
let ready = false;
for (let attempt = 0; attempt < 150 && !closing; attempt++) {
  try {
    const response = await fetch("http://127.0.0.1:4311/health", {
      signal: AbortSignal.timeout(500),
    });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {}
  await delay(200);
}
if (!ready) {
  console.error(
    "Le serveur local ne répond pas. Consultez le message précédent.",
  );
  close(1);
} else if (!closing) {
  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
    env: process.env,
  });
  vite.on("exit", (code) => close(code ?? 1));
  vite.on("error", (error) => {
    console.error(error.message);
    close(1);
  });
  console.log(
    demo
      ? "Aperçu React : http://127.0.0.1:5173 — données fictives séparées dans .qa/react-demo"
      : "React : http://127.0.0.1:5173 — base configurée par DATA_DIR",
  );
}
