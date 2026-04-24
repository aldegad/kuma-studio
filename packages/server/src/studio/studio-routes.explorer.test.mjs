import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { createStudioRouteHandler } from "./studio-routes.mjs";
import { createStudioExplorerRouteHandler, watchStudioExplorerRoots } from "./studio-explorer-routes.mjs";
import { readProjectsRegistry } from "./project-defaults.mjs";
import { StudioUiStateStore } from "./studio-ui-state-store.mjs";

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

async function callExplorerHandler(handler, req, res) {
  return handler(req, res, new URL(req.url, `http://${req.headers.host}`));
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
    execFileSync("git", ["init", "-b", "main"], { cwd: repoRoot, stdio: "ignore" });
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
    assert.strictEqual(gitRes.json.branch, "main");
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

  it("serves studio UI state GET/PATCH through the composed handler", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const repoRoot = join(root, "workspace");
    await mkdir(staticDir, { recursive: true });
    await mkdir(repoRoot, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<html></html>", "utf8");

    const handler = createStudioRouteHandler({
      staticDir,
      statsStore: { getStats: () => ({}), getDailyReport: () => ({}) },
      sceneStore: {},
      workspaceRoot: repoRoot,
      studioUiStateStore: new StudioUiStateStore({ storagePath: join(root, "studio", "ui-state.json") }),
    });

    const getRes = createResponse();
    await handler(createRequest("GET", "/studio/ui-state"), getRes);
    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(getRes.json.version, 1);
    assert.deepStrictEqual(getRes.json.hud.pinnedProjectIds, []);

    const patchRes = createResponse();
    await handler(
      createRequest("PATCH", "/studio/ui-state", {
        hud: { pinnedProjectIds: ["alpha-project", "beta-project"] },
        explorer: { projects: { "alpha-project": { selectedPath: join(repoRoot, "README.md") } } },
      }),
      patchRes,
    );
    assert.strictEqual(patchRes.statusCode, 200);
    assert.deepStrictEqual(patchRes.json.hud.pinnedProjectIds, ["alpha-project", "beta-project"]);
    assert.strictEqual(patchRes.json.explorer.projects["alpha-project"].selectedPath, join(repoRoot, "README.md"));
  });

  it("deletes directories recursively through /studio/fs/delete", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-"));
    tempDirs.push(root);

    const staticDir = join(root, "static");
    const repoRoot = join(root, "workspace");
    await mkdir(staticDir, { recursive: true });
    const folder = join(repoRoot, "tree", "nested");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "leaf.md"), "leaf\n", "utf8");

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

    const deleteRes = createResponse();
    await handler(createRequest("DELETE", "/studio/fs/delete", { path: join(repoRoot, "tree") }), deleteRes);
    assert.strictEqual(deleteRes.statusCode, 200);
    assert.deepStrictEqual(deleteRes.json, { success: true });

    const { existsSync } = await import("node:fs");
    assert.strictEqual(existsSync(join(repoRoot, "tree")), false);
    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(broadcasts[0].changes[0].eventType, "delete");
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

  it("reads HWP/HWPX files as previewable binary and writes binary payloads explicitly", async () => {
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

    const target = join(repoRoot, "sample.hwp");
    const binaryPayload = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]).toString("base64");
    const writeRes = createResponse();
    await handler(createRequest("PUT", "/studio/fs/write-binary", { path: target, content: binaryPayload }), writeRes);
    assert.strictEqual(writeRes.statusCode, 200);
    assert.deepStrictEqual(await readFile(target), Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(broadcasts[0].changes[0].eventType, "change");

    const readRes = createResponse();
    await handler(createRequest("GET", `/studio/fs/read?path=${encodeURIComponent(target)}`), readRes);
    assert.strictEqual(readRes.statusCode, 200);
    assert.strictEqual(readRes.json.mimeType, "application/x-hwp");
    assert.strictEqual(readRes.json.content, binaryPayload);

    const invalidRes = createResponse();
    await handler(createRequest("PUT", "/studio/fs/write-binary", { path: target, content: "not-base64" }), invalidRes);
    assert.strictEqual(invalidRes.statusCode, 400);
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

  it("syncs watcher roots from the live registry and prefers the most specific project root id", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-watch-"));
    tempDirs.push(root);

    const workspaceRoot = join(root, "workspace");
    const projectRoot = join(workspaceRoot, "apps", "project-one");
    await mkdir(projectRoot, { recursive: true });

    let configuredProjectRoots = {};
    const broadcasts = [];
    const stopWatching = watchStudioExplorerRoots({
      workspaceRoot,
      debounceMs: 20,
      rescanRootsMs: 40,
      readProjectRoots() {
        return configuredProjectRoots;
      },
      studioWsEvents: {
        broadcastFilesystemChange(payload) {
          broadcasts.push(payload);
        },
      },
    });

    try {
      configuredProjectRoots = { "project-one": projectRoot };
      await new Promise((resolve) => setTimeout(resolve, 120));

      const target = join(projectRoot, "external.md");
      await writeFile(target, "# project-one\n", "utf8");

      await waitForCondition(() => {
        assert.ok(
          broadcasts.some((payload) =>
            payload.changes.some((change) => change.path === target && change.rootId === "project-one"),
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

  it("reads project roots from the live registry on each request instead of caching startup state", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-explorer-"));
    tempDirs.push(root);

    const workspaceRoot = join(root, "workspace");
    const projectOneRoot = join(root, "project-one");
    const projectTwoRoot = join(root, "project-two");
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(projectOneRoot, { recursive: true });
    await mkdir(projectTwoRoot, { recursive: true });
    await writeFile(join(projectOneRoot, "README.md"), "# project-one\n", "utf8");
    await writeFile(join(projectTwoRoot, "README.md"), "# project-two\n", "utf8");

    let configuredProjectRoots = { "project-one": projectOneRoot };
    const handler = createStudioExplorerRouteHandler({
      workspaceRoot,
      readProjectRoots() {
        return configuredProjectRoots;
      },
    });

    const firstRootsReq = createRequest("GET", "/studio/fs/roots");
    const firstRootsRes = createResponse();
    await callExplorerHandler(handler, firstRootsReq, firstRootsRes);
    assert.strictEqual(firstRootsRes.statusCode, 200);
    assert.deepStrictEqual(firstRootsRes.json.projectRoots, { "project-one": projectOneRoot });

    configuredProjectRoots = { "project-two": projectTwoRoot };
    const rootsRes = createResponse();
    const rootsReq = createRequest("GET", "/studio/fs/roots");
    await callExplorerHandler(handler, rootsReq, rootsRes);
    assert.strictEqual(rootsRes.statusCode, 200);
    assert.deepStrictEqual(rootsRes.json.projectRoots, { "project-two": projectTwoRoot });

    const staleTreeReq = createRequest("GET", `/studio/fs/tree?root=${encodeURIComponent(projectOneRoot)}&depth=2`);
    const staleTreeRes = createResponse();
    await callExplorerHandler(handler, staleTreeReq, staleTreeRes);
    assert.strictEqual(staleTreeRes.statusCode, 403);

    const currentTreeReq = createRequest("GET", `/studio/fs/tree?root=${encodeURIComponent(projectTwoRoot)}&depth=2`);
    const currentTreeRes = createResponse();
    await callExplorerHandler(handler, currentTreeReq, currentTreeRes);
    assert.strictEqual(currentTreeRes.statusCode, 200);
    assert.strictEqual(currentTreeRes.json.path, projectTwoRoot);
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
