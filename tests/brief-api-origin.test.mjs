import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("brief upload and export credentials stay on the current Pages, Worker, or local origin", async () => {
  const source = await readFile(new URL("../public/brief.js", import.meta.url), "utf8");
  const bootstrap = source.slice(0, source.indexOf("const splitList"))
    .replace(/^import .+;\r?\n/gm, "");
  const paths = [...source.matchAll(/fetch\(apiUrl\("([^"\r\n]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(paths.sort(), ["/api/brief/export", "/api/brief/import", "/api/keepamore/import"]);
  for (const origin of ["https://example-fork.pages.dev", "https://example-fork.workers.dev", "http://127.0.0.1:8787"]) {
    for (const path of paths) {
      const requestPath = runInNewContext(`${bootstrap}\napiUrl(requestPath)`, {
        location: new URL(origin), htm: { bind: () => null }, h: () => null, requestPath: path,
      });
      const target = new URL(requestPath, origin);
      assert.equal(target.origin, origin);
      assert.equal(target.pathname, path);
    }
  }
});
