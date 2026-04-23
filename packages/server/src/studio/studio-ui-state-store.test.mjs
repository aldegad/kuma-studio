import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, assert, describe, it } from "vitest";

import { StudioUiStateStore } from "./studio-ui-state-store.mjs";

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "kuma-studio-ui-state-"));
  tempDirs.push(root);
  return new StudioUiStateStore({ storagePath: join(root, "studio", "ui-state.json") });
}

describe("StudioUiStateStore", () => {
  it("returns default state when the file does not exist", async () => {
    const store = await createStore();

    const state = await store.read();

    assert.strictEqual(state.version, 1);
    assert.strictEqual(state.hud.pinnedProjectId, null);
    assert.strictEqual(state.explorer.open, false);
    assert.deepStrictEqual(state.explorer.projects, {});
  });

  it("returns default state instead of hiding corrupt JSON behind another source", async () => {
    const store = await createStore();
    await writeFile(store.storagePath, "{not-json", "utf8").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(store.storagePath), { recursive: true });
      await writeFile(store.storagePath, "{not-json", "utf8");
    });

    const state = await store.read();

    assert.strictEqual(state.version, 1);
    assert.strictEqual(state.hud.pinnedProjectId, null);
    assert.strictEqual(state.explorer.open, false);
    assert.deepStrictEqual(state.explorer.projects, {});
  });

  it("deep merges partial project updates", async () => {
    const store = await createStore();

    await store.patch({
      hud: { pinnedProjectId: "pqc-unified" },
      explorer: {
        open: true,
        projects: {
          "pqc-unified": {
            selectedPath: "/workspace/pqc/README.md",
            sidebarTab: "files",
            expandedPaths: ["/workspace/pqc/docs"],
            scrollTop: 180,
            viewerScrollByPath: {
              "/workspace/pqc/README.md": { top: 20, left: 0 },
            },
          },
        },
      },
    });
    const next = await store.patch({
      explorer: {
        projects: {
          "pqc-unified": {
            sidebarTab: "vault",
            globalExpanded: { vault: true },
            viewerScrollByPath: {
              "/workspace/pqc/ROADMAP.md": { top: 45, left: 0 },
            },
          },
        },
      },
    });

    const project = next.explorer.projects["pqc-unified"];
    assert.strictEqual(next.hud.pinnedProjectId, "pqc-unified");
    assert.strictEqual(next.explorer.open, true);
    assert.strictEqual(project.selectedPath, "/workspace/pqc/README.md");
    assert.strictEqual(project.sidebarTab, "vault");
    assert.deepStrictEqual(project.expandedPaths, ["/workspace/pqc/docs"]);
    assert.strictEqual(project.scrollTop, 180);
    assert.deepStrictEqual(project.globalExpanded, { vault: true });
    assert.deepStrictEqual(project.viewerScrollByPath["/workspace/pqc/README.md"], { top: 20, left: 0 });
    assert.deepStrictEqual(project.viewerScrollByPath["/workspace/pqc/ROADMAP.md"], { top: 45, left: 0 });
  });

  it("persists through an atomic temp file rename", async () => {
    const store = await createStore();

    const state = await store.patch({ hud: { pinnedProjectId: "workspace" } });
    const raw = await readFile(store.storagePath, "utf8");

    assert.strictEqual(JSON.parse(raw).hud.pinnedProjectId, "workspace");
    assert.strictEqual(state.hud.pinnedProjectId, "workspace");
  });
});
