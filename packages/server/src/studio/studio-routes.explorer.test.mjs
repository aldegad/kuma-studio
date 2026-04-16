import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { createStudioRouteHandler } from "./studio-routes.mjs";
import { watchStudioExplorerRoots } from "./studio-explorer-routes.mjs";
import { readProjectsRegistry } from "./project-defaults.mjs";

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
    get json() {
      return state.body.length > 0 ? JSON.parse(state.body.toString("utf8")) : null;
    },
  };
}

async function waitForCondition(assertion, { timeoutMs = 1500, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  assertion();
}

const tempDirs = [];

afterEach(async () => {
  delete process.env.KUMA_STUDIO_WORKSPACE;
  delete process.env.KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("studio-routes explorer endpoints", () => {
  it("serves git status and fs read/write/delete through the composed handler", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const workspaceRoot = join(root, "workspace");
    const repoRoot = join(workspaceRoot, "repo");
    await mkdir(staticDir, { recursive: true });
    await mkdir(repoRoot, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html></html>", "utf8");
    await writeFile(join(repoRoot, "tracked.ts"), "export const value = 1;\n", "utf8");

    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      workspaceRoot: repoRoot,
    });

    const gitRes = createResponse();
    await handler(createRequest("GET", `/studio/git/status?root=${encodeURIComponent(repoRoot)}`), gitRes);
    assert.strictEqual(gitRes.statusCode, 200);
    assert.strictEqual(gitRes.json.root, repoRoot);
    assert.ok(typeof gitRes.json.files === "object");

    const writeTarget = join(repoRoot, "scratch.md");
    const writeRes = createResponse();
    await handler(
      createRequest("PUT", "/studio/fs/write", { path: writeTarget, content: "# hello\n" }),
      writeRes,
    );
    assert.strictEqual(writeRes.statusCode, 200);
    assert.deepStrictEqual(writeRes.json, { success: true });

    const readRes = createResponse();
    await handler(
      createRequest("GET", `/studio/fs/read?path=${encodeURIComponent(writeTarget)}`),
      readRes,
    );
    assert.strictEqual(readRes.statusCode, 200);
    assert.strictEqual(readRes.json.language, "markdown");
    assert.strictEqual(readRes.json.content, "# hello\n");

    const deleteRes = createResponse();
    await handler(createRequest("DELETE", "/studio/fs/delete", { path: writeTarget }), deleteRes);
    assert.strictEqual(deleteRes.statusCode, 200);
    assert.deepStrictEqual(deleteRes.json, { success: true });
  });

  it("broadcasts filesystem-change events for explorer write/delete mutations", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const repoRoot = join(root, "workspace");
    await mkdir(staticDir, { recursive: true });
    await mkdir(repoRoot, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html></html>", "utf8");

    const broadcasts = [];
    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      workspaceRoot: repoRoot,
      studioWsEvents: {
        broadcastFilesystemChange(payload) {
          broadcasts.push(payload);
        },
      },
    });

    const target = join(repoRoot, "broadcast.md");
    const writeRes = createResponse();
    await handler(createRequest("PUT", "/studio/fs/write", { path: target, content: "# live\n" }), writeRes);
    assert.strictEqual(writeRes.statusCode, 200);
    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(broadcasts[0].changes[0].rootId, "workspace");
    assert.strictEqual(broadcasts[0].changes[0].eventType, "change");
    assert.strictEqual(broadcasts[0].changes[0].path, target);

    const deleteRes = createResponse();
    await handler(createRequest("DELETE", "/studio/fs/delete", { path: target }), deleteRes);
    assert.strictEqual(deleteRes.statusCode, 200);
    assert.strictEqual(broadcasts.length, 2);
    assert.strictEqual(broadcasts[1].changes[0].eventType, "delete");
    assert.strictEqual(broadcasts[1].changes[0].path, target);
  });

  it("watches explorer roots and emits filesystem-change events for external edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-watch-"));
    tempDirs.push(root);

    const repoRoot = join(root, "workspace");
    await mkdir(repoRoot, { recursive: true });

    const broadcasts = [];
    const stopWatching = watchStudioExplorerRoots({
      workspaceRoot: repoRoot,
      debounceMs: 20,
      studioWsEvents: {
        broadcastFilesystemChange(payload) {
          broadcasts.push(payload);
        },
      },
    });

    try {
      const target = join(repoRoot, "external.md");
      await writeFile(target, "# external\n", "utf8");

      await waitForCondition(() => {
        assert.ok(
          broadcasts.some((payload) =>
            payload.changes.some((change) => change.path === target && change.rootId === "workspace"),
          ),
        );
      });
    } finally {
      stopWatching();
    }
  });

  it("returns the default bootstrap explorer roots when the server env opts them in", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const repoRoot = join(root, "workspace");
    await mkdir(staticDir, { recursive: true });
    await mkdir(repoRoot, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html></html>", "utf8");
    process.env.KUMA_STUDIO_WORKSPACE = repoRoot;
    process.env.KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS = "vault,claude,codex";

    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
    });

    const rootsRes = createResponse();
    await handler(createRequest("GET", "/studio/fs/roots"), rootsRes);
    assert.strictEqual(rootsRes.statusCode, 200);
    assert.strictEqual(rootsRes.json.workspaceRoot, repoRoot);
    assert.strictEqual(rootsRes.json.systemRoot, resolve(process.cwd()));
    assert.deepStrictEqual(rootsRes.json.projectRoots, readProjectsRegistry());
    assert.deepStrictEqual(rootsRes.json.globalRoots, {
      vault: resolve(join(homedir(), ".kuma", "vault")),
      claude: resolve(join(homedir(), ".claude")),
      codex: resolve(join(homedir(), ".codex")),
    });
  });

  it("suppresses extra explorer roots only when the env is explicitly blank", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const repoRoot = join(root, "workspace");
    await mkdir(staticDir, { recursive: true });
    await mkdir(repoRoot, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html></html>", "utf8");
    process.env.KUMA_STUDIO_WORKSPACE = repoRoot;
    process.env.KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS = "";

    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
    });

    const rootsRes = createResponse();
    await handler(createRequest("GET", "/studio/fs/roots"), rootsRes);
    assert.strictEqual(rootsRes.statusCode, 200);
    assert.strictEqual(rootsRes.json.workspaceRoot, repoRoot);
    assert.strictEqual(rootsRes.json.systemRoot, resolve(process.cwd()));
    assert.deepStrictEqual(rootsRes.json.projectRoots, readProjectsRegistry());
    assert.deepStrictEqual(rootsRes.json.globalRoots, {});
  });

  it("accepts shell-escaped explorer root bindings from managed reload commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const repoRoot = join(root, "workspace");
    await mkdir(staticDir, { recursive: true });
    await mkdir(repoRoot, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html></html>", "utf8");
    process.env.KUMA_STUDIO_WORKSPACE = repoRoot;
    process.env.KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS = "vault\\\\\\,claude\\\\\\,codex";

    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
    });

    const rootsRes = createResponse();
    await handler(createRequest("GET", "/studio/fs/roots"), rootsRes);
    assert.strictEqual(rootsRes.statusCode, 200);
    assert.strictEqual(rootsRes.json.systemRoot, resolve(process.cwd()));
    assert.deepStrictEqual(rootsRes.json.projectRoots, readProjectsRegistry());
    assert.deepStrictEqual(rootsRes.json.globalRoots, {
      vault: resolve(join(homedir(), ".kuma", "vault")),
      claude: resolve(join(homedir(), ".claude")),
      codex: resolve(join(homedir(), ".codex")),
    });
  });

  it("allows explicitly configured global explorer roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const repoRoot = join(root, "workspace");
    const vaultRoot = join(root, "vault");
    await mkdir(staticDir, { recursive: true });
    await mkdir(repoRoot, { recursive: true });
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html></html>", "utf8");
    await writeFile(join(vaultRoot, "index.md"), "# Vault\n", "utf8");

    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      workspaceRoot: repoRoot,
      explorerGlobalRoots: { vault: vaultRoot },
    });

    const rootsRes = createResponse();
    await handler(createRequest("GET", "/studio/fs/roots"), rootsRes);
    assert.strictEqual(rootsRes.statusCode, 200);
    assert.strictEqual(rootsRes.json.systemRoot, resolve(process.cwd()));
    assert.deepStrictEqual(rootsRes.json.projectRoots, readProjectsRegistry());
    assert.deepStrictEqual(rootsRes.json.globalRoots, { vault: vaultRoot });

    const readRes = createResponse();
    await handler(
      createRequest("GET", `/studio/fs/read?path=${encodeURIComponent(join(vaultRoot, "index.md"))}`),
      readRes,
    );
    assert.strictEqual(readRes.statusCode, 200);
    assert.strictEqual(readRes.json.content, "# Vault\n");
  });

  it("rejects explorer access outside the allowed roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    await mkdir(staticDir, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html></html>", "utf8");

    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
    });

    const outsidePath = join(root, "..", "outside.txt");
    const readRes = createResponse();
    await handler(
      createRequest("GET", `/studio/fs/read?path=${encodeURIComponent(outsidePath)}`),
      readRes,
    );
    assert.strictEqual(readRes.statusCode, 403);
    assert.deepStrictEqual(readRes.json, { error: "Path outside allowed directories." });
  });
});
