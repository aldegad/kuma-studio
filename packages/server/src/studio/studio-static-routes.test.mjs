import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { createStudioStaticRouteHandler } from "./studio-static-routes.mjs";

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

describe("studio static routes", () => {
  it("serves dist assets and SPA fallback", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "kuma-studio-static-routes-"));
    tempDirs.push(staticDir);
    await mkdir(join(staticDir, "assets"), { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html><body>dist-shell</body></html>", "utf8");
    await writeFile(join(staticDir, "assets", "app-123.js"), "console.log('dist asset');", "utf8");

    const handler = createStudioStaticRouteHandler({ staticDir });

    const htmlRes = createResponse();
    await handler(createRequest("GET", "/studio/"), htmlRes, new URL("http://localhost:4312/studio/"));
    assert.strictEqual(htmlRes.statusCode, 200);
    assert.match(htmlRes.text, /dist-shell/u);

    const assetRes = createResponse();
    await handler(
      createRequest("GET", "/studio/assets/app-123.js"),
      assetRes,
      new URL("http://localhost:4312/studio/assets/app-123.js"),
    );
    assert.strictEqual(assetRes.statusCode, 200);
    assert.match(assetRes.text, /dist asset/u);
    assert.strictEqual(assetRes.headers["Content-Type"], "application/javascript; charset=utf-8");
  });

  it("prefers the dev delegate and returns 404 when the delegate declines", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "kuma-studio-static-routes-"));
    tempDirs.push(staticDir);
    await writeFile(join(staticDir, "index.html"), "<html><body>dist-shell</body></html>", "utf8");

    const delegateCalls = [];
    const handler = createStudioStaticRouteHandler({
      staticDir,
      studioDevDelegate: async (_req, res, url) => {
        delegateCalls.push(url.pathname);
        if (url.pathname === "/studio/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<html><body>dev-shell</body></html>");
          return true;
        }
        return false;
      },
    });

    const htmlRes = createResponse();
    await handler(createRequest("GET", "/studio/"), htmlRes, new URL("http://localhost:4312/studio/"));
    assert.strictEqual(htmlRes.statusCode, 200);
    assert.match(htmlRes.text, /dev-shell/u);

    const missRes = createResponse();
    await handler(
      createRequest("GET", "/studio/assets/missing.js"),
      missRes,
      new URL("http://localhost:4312/studio/assets/missing.js"),
    );
    assert.strictEqual(missRes.statusCode, 404);
    assert.strictEqual(missRes.text, "Not Found");
    assert.deepStrictEqual(delegateCalls, ["/studio/", "/studio/assets/missing.js"]);
  });
});
