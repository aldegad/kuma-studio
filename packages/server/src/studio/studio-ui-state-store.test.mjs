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
    assert.deepStrictEqual(state.hud.pinnedProjectIds, []);
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
    assert.deepStrictEqual(state.hud.pinnedProjectIds, []);
    assert.strictEqual(state.explorer.open, false);
    assert.deepStrictEqual(state.explorer.projects, {});
  });

  it("promotes a legacy single pinned project into the canonical array", async () => {
    const store = await createStore();
    await writeFile(store.storagePath, JSON.stringify({
      version: 1,
      updatedAt: "2026-04-23T00:00:00.000Z",
      hud: { pinnedProjectId: "alpha-project" },
      explorer: { open: false, projects: {} },
    }), "utf8").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(store.storagePath), { recursive: true });
      await writeFile(store.storagePath, JSON.stringify({
        version: 1,
        updatedAt: "2026-04-23T00:00:00.000Z",
        hud: { pinnedProjectId: "alpha-project" },
        explorer: { open: false, projects: {} },
      }), "utf8");
    });

    const state = await store.read();

    assert.deepStrictEqual(state.hud.pinnedProjectIds, ["alpha-project"]);
  });

  it("deep merges partial project updates", async () => {
    const store = await createStore();

    await store.patch({
      hud: { pinnedProjectIds: ["alpha-project", "beta-project"] },
      explorer: {
        open: true,
        projects: {
          "alpha-project": {
            selectedPath: "/workspace/alpha/README.md",
            sidebarTab: "files",
            expandedPaths: ["/workspace/alpha/docs"],
            scrollTop: 180,
            viewerScrollByPath: {
              "/workspace/alpha/README.md": { top: 20, left: 0 },
            },
          },
        },
      },
    });
    const next = await store.patch({
      explorer: {
        projects: {
          "alpha-project": {
            sidebarTab: "vault",
            globalExpanded: { vault: true },
            viewerScrollByPath: {
              "/workspace/alpha/ROADMAP.md": { top: 45, left: 0 },
            },
          },
        },
      },
    });

    const project = next.explorer.projects["alpha-project"];
    assert.deepStrictEqual(next.hud.pinnedProjectIds, ["alpha-project", "beta-project"]);
    assert.strictEqual(next.explorer.open, true);
    assert.strictEqual(project.selectedPath, "/workspace/alpha/README.md");
    assert.strictEqual(project.sidebarTab, "vault");
    assert.deepStrictEqual(project.expandedPaths, ["/workspace/alpha/docs"]);
    assert.strictEqual(project.scrollTop, 180);
    assert.deepStrictEqual(project.globalExpanded, { vault: true });
    assert.deepStrictEqual(project.viewerScrollByPath["/workspace/alpha/README.md"], { top: 20, left: 0 });
    assert.deepStrictEqual(project.viewerScrollByPath["/workspace/alpha/ROADMAP.md"], { top: 45, left: 0 });
  });

  it("persists through an atomic temp file rename", async () => {
    const store = await createStore();

    const state = await store.patch({ hud: { pinnedProjectIds: ["workspace"] } });
    const raw = await readFile(store.storagePath, "utf8");

    assert.deepStrictEqual(JSON.parse(raw).hud.pinnedProjectIds, ["workspace"]);
    assert.deepStrictEqual(state.hud.pinnedProjectIds, ["workspace"]);
  });
});
