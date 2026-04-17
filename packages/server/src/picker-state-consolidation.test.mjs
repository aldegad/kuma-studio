import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DevSelectionStore } from "./dev-selection-store.mjs";
import { JobCardStore } from "./job-card-store.mjs";
import { resolveProjectStateDir } from "./state-home.mjs";
import { SceneStore } from "./scene-store.mjs";

function createSelectionRecord(sessionId, overrides = {}) {
  return {
    capturedAt: "2026-04-17T02:30:00.000Z",
    page: {
      url: "http://localhost:3000/example",
      pathname: "/example",
      title: "Example",
      tabId: 11,
    },
    session: {
      id: sessionId,
      label: "Example session",
      index: 1,
      updatedAt: "2026-04-17T02:30:00.000Z",
    },
    element: {
      tagName: "button",
      selector: "#submit",
      selectorPath: "main > button",
      rect: { x: 10, y: 20, width: 30, height: 40 },
      pickedPoint: { x: 25, y: 40 },
      snapshot: null,
    },
    ...overrides,
  };
}

describe("picker shared state consolidation", () => {
  const originalStateHome = process.env.KUMA_PICKER_STATE_HOME;
  let sandboxRoot = "";
  let stateHome = "";

  beforeEach(() => {
    sandboxRoot = mkdtempSync(join(tmpdir(), "kuma-picker-state-"));
    stateHome = resolve(sandboxRoot, ".kuma-picker");
    process.env.KUMA_PICKER_STATE_HOME = stateHome;
  });

  afterEach(() => {
    if (originalStateHome == null) {
      delete process.env.KUMA_PICKER_STATE_HOME;
    } else {
      process.env.KUMA_PICKER_STATE_HOME = originalStateHome;
    }
  });

  it("writes new selections into the shared picker state home", () => {
    const projectRoot = resolve(sandboxRoot, "workspace", "project-a");
    mkdirSync(projectRoot, { recursive: true });
    const store = new DevSelectionStore(projectRoot);

    const persisted = store.write(createSelectionRecord("browser123"));

    expect(store.selectionPath).toBe(resolve(stateHome, "dev-selection.json"));
    expect(store.collectionPath).toBe(resolve(stateHome, "dev-selections.json"));
    expect(store.selectionDir).toBe(resolve(stateHome, "dev-selections"));
    expect(persisted.projectRoot).toBe(projectRoot);
    expect(existsSync(resolve(stateHome, "dev-selection.json"))).toBe(true);
    expect(existsSync(resolve(stateHome, "projects"))).toBe(false);
  });

  it("does not read legacy project selections from projects hash directories", () => {
    const projectRoot = resolve(sandboxRoot, "workspace", "project-b");
    mkdirSync(projectRoot, { recursive: true });
    const legacyDir = resolveProjectStateDir(projectRoot);
    const legacySelectionDir = resolve(legacyDir, "dev-selections");
    mkdirSync(legacySelectionDir, { recursive: true });

    const legacyRecord = createSelectionRecord("browser456");
    writeFileSync(resolve(legacySelectionDir, "browser456.json"), `${JSON.stringify(legacyRecord, null, 2)}\n`, "utf8");
    writeFileSync(resolve(legacyDir, "dev-selection.json"), `${JSON.stringify(legacyRecord, null, 2)}\n`, "utf8");
    writeFileSync(
      resolve(legacyDir, "dev-selections.json"),
      `${JSON.stringify({ version: 1, updatedAt: legacyRecord.capturedAt, latestSessionId: "browser456" }, null, 2)}\n`,
      "utf8",
    );

    const store = new DevSelectionStore(projectRoot);
    const collection = store.readAll();

    expect(collection).toBe(null);
    expect(existsSync(store.selectionPath)).toBe(false);
    expect(store.selectionPath).toBe(resolve(stateHome, "dev-selection.json"));
  });

  it("does not read legacy job cards from projects hash directories", () => {
    const projectRoot = resolve(sandboxRoot, "workspace", "project-c");
    mkdirSync(projectRoot, { recursive: true });
    const legacyDir = resolveProjectStateDir(projectRoot);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      resolve(legacyDir, "job-cards.json"),
      `${JSON.stringify({
        version: 1,
        updatedAt: "2026-04-17T02:35:00.000Z",
        cards: [
          {
            id: "job-1",
            sessionId: "browser789",
            selectionId: "browser789",
            message: "Review this area",
            requestMessage: "Review this area",
            status: "noted",
            createdAt: "2026-04-17T02:35:00.000Z",
            updatedAt: "2026-04-17T02:35:00.000Z",
            author: "user",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const store = new JobCardStore(projectRoot);
    const feed = store.readAll();

    expect(store.feedPath).toBe(resolve(stateHome, "job-cards.json"));
    expect(feed.cards).toHaveLength(0);
    expect(existsSync(store.feedPath)).toBe(false);
  });

  it("writes scene state into the shared picker state home", () => {
    const projectRoot = resolve(sandboxRoot, "workspace", "project-d");
    mkdirSync(projectRoot, { recursive: true });
    const store = new SceneStore(projectRoot);

    const scene = store.read();

    expect(store.scenePath).toBe(resolve(stateHome, "scene.json"));
    expect(scene).toBeTruthy();
    expect(existsSync(resolve(stateHome, "scene.json"))).toBe(true);
  });
});
