import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
    get json() {
      return state.body.length > 0 ? JSON.parse(state.body.toString("utf8")) : null;
    },
    get statusCode() {
      return state.statusCode;
    },
    get headers() {
      return state.headers;
    },
  };
}

const tempDirs = [];

afterEach(async () => {
  delete process.env.KUMA_NIGHTMODE_FLAG;
  delete process.env.KUMA_PLANS_DIR;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("studio-routes nightmode", () => {
  it("toggles /studio/nightmode and broadcasts the state", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-nightmode-route-"));
    tempDirs.push(tempRoot);
    const flagPath = join(tempRoot, "kuma-nightmode.flag");
    process.env.KUMA_NIGHTMODE_FLAG = flagPath;

    const broadcasts = [];
    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      studioWsEvents: {
        broadcastNightMode(enabled) {
          broadcasts.push(enabled);
        },
      },
    });

    const initialRes = createResponse();
    await handler(createRequest("GET", "/studio/nightmode"), initialRes);
    assert.strictEqual(initialRes.statusCode, 200);
    assert.deepStrictEqual(initialRes.json, { enabled: false });

    const enableRes = createResponse();
    await handler(createRequest("POST", "/studio/nightmode", { enabled: true }), enableRes);
    assert.strictEqual(enableRes.statusCode, 200);
    assert.deepStrictEqual(enableRes.json, { enabled: true });
    assert.strictEqual(existsSync(flagPath), true);

    const flagContent = await readFile(flagPath, "utf8");
    assert.match(flagContent, /^\d{4}-\d{2}-\d{2}T/u);

    const enabledRes = createResponse();
    await handler(createRequest("GET", "/studio/nightmode"), enabledRes);
    assert.deepStrictEqual(enabledRes.json, { enabled: true });

    const disableRes = createResponse();
    await handler(createRequest("POST", "/studio/nightmode", { enabled: false }), disableRes);
    assert.strictEqual(disableRes.statusCode, 200);
    assert.deepStrictEqual(disableRes.json, { enabled: false });
    assert.strictEqual(existsSync(flagPath), false);
    assert.deepStrictEqual(broadcasts, [true, false]);
  });

  it("returns plan statusColor via /studio/plans", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-plans-route-"));
    tempDirs.push(tempRoot);
    process.env.KUMA_PLANS_DIR = tempRoot;

    await mkdir(join(tempRoot, "kuma-studio", "approval-flow"), { recursive: true });
    await writeFile(
      join(tempRoot, "kuma-studio", "approval-flow", "index.md"),
      `---
title: Approval Flow
status: blocked
---

## Wait
- [ ] need user confirmation
`,
      "utf8",
    );

    const handler = createStudioRouteHandler({
      staticDir: process.cwd(),
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
    });

    const res = createResponse();
    await handler(createRequest("GET", "/studio/plans"), res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json.source, {
      mode: "explicit-plans-dir",
      status: "ready",
      configured: true,
      plansDir: tempRoot,
      exists: true,
      message: null,
    });
    assert.deepStrictEqual(res.json.plans[0], {
      id: "kuma-studio/approval-flow",
      filePath: "kuma-studio/approval-flow/index.md",
      project: "kuma-studio",
      title: "Approval Flow",
      status: "blocked",
      statusColor: "orange",
      created: null,
      body: "## Wait\n- [ ] need user confirmation",
      sections: [
        {
          title: "Wait",
          items: [{ text: "need user confirmation", checked: false, commitHash: null }],
        },
      ],
      totalItems: 1,
      checkedItems: 0,
      completionRate: 0,
      warnings: [],
    });
  });
});
