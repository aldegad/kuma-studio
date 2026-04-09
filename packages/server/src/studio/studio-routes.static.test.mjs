import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { createStudioRouteHandler } from "./studio-routes.mjs";

function createRequest(method, url, body) {
  const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf8");
  const req = new Readable({
    read() {
      if (payload) {
        this.push(payload);
      }
      this.push(null);
    },
  });

  req.method = method;
  req.url = url;
  req.headers = { host: "localhost:4312" };
  return req;
}

function createResponse() {
  const state = {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
  };

  return {
    writeHead(statusCode, headers) {
      state.statusCode = statusCode;
      state.headers = headers;
    },
    end(body) {
      state.body = body ? Buffer.from(body) : Buffer.alloc(0);
    },
    get statusCode() {
      return state.statusCode;
    },
    get headers() {
      return state.headers;
    },
    get text() {
      return state.body.toString("utf8");
    },
    get json() {
      return state.body.length > 0 ? JSON.parse(state.body.toString("utf8")) : null;
    },
  };
}

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("studio-routes static + dev delegate", () => {
  it("serves dist assets when no dev delegate is present", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "kuma-studio-static-"));
    tempDirs.push(staticDir);
    await mkdir(join(staticDir, "assets"), { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html><body>dist-shell</body></html>", "utf8");
    await writeFile(join(staticDir, "assets", "app-123.js"), "console.log('dist asset');", "utf8");

    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({ ok: true }), getDailyReport: () => ({}) },
      sceneStore: {},
    });

    const htmlRes = createResponse();
    await handler(createRequest("GET", "/studio/"), htmlRes);
    assert.strictEqual(htmlRes.statusCode, 200);
    assert.match(htmlRes.text, /dist-shell/u);

    const assetRes = createResponse();
    await handler(createRequest("GET", "/studio/assets/app-123.js"), assetRes);
    assert.strictEqual(assetRes.statusCode, 200);
    assert.match(assetRes.text, /dist asset/u);
  });

  it("prefers the dev delegate for studio HTML but keeps studio APIs on the server handler", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "kuma-studio-static-"));
    tempDirs.push(staticDir);
    await writeFile(join(staticDir, "index.html"), "<html><body>dist-shell</body></html>", "utf8");

    const delegateCalls = [];
    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({ requests: 7 }), getDailyReport: () => ({}) },
      sceneStore: {},
      studioDevDelegate: async (_req, res, url) => {
        delegateCalls.push(url.pathname);
        if (url.pathname === "/studio/" || url.pathname === "/studio") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end('<script type="module" src="/studio/@vite/client"></script><script type="module" src="/studio/src/main.tsx"></script>');
          return true;
        }

        return false;
      },
    });

    const htmlRes = createResponse();
    await handler(createRequest("GET", "/studio/"), htmlRes);
    assert.strictEqual(htmlRes.statusCode, 200);
    assert.match(htmlRes.text, /@vite\/client/u);
    assert.match(htmlRes.text, /src\/main\.tsx/u);
    assert.deepStrictEqual(delegateCalls, ["/studio/"]);

    const statsRes = createResponse();
    await handler(createRequest("GET", "/studio/stats"), statsRes);
    assert.strictEqual(statsRes.statusCode, 200);
    assert.deepStrictEqual(statsRes.json, { requests: 7 });
    assert.deepStrictEqual(delegateCalls, ["/studio/"]);
  });
});
