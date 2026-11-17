import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveReact } from "../server/react-static.mjs";
test("React assets: MIME types, HEAD, missing paths and traversal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "timeteknika-react-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), '<div id="root"></div>');
  await writeFile(join(root, "assets", "main.js"), 'console.log("ok")');
  const server = http.createServer(async (req, res) => {
    if (!(await serveReact(root, req.url, req.method, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const url = "http://127.0.0.1:" + server.address().port;
  const home = await fetch(url);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /id="root"/);
  const asset = await fetch(url + "/assets/main.js");
  assert.match(asset.headers.get("content-type"), /javascript/);
  const head = await fetch(url + "/assets/main.js", { method: "HEAD" });
  assert.equal(await head.text(), "");
  assert.equal(head.status, 200);
  for (const path of [
    "/package.json",
    "/.env",
    "/src/App.tsx",
    "/assets/missing.js",
    "/assets/%2e%2e/.env",
  ])
    assert.equal((await fetch(url + path)).status, 404);
});
