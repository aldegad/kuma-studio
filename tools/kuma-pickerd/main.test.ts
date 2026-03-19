import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const CLI_PATH = path.resolve(process.cwd(), "packages/server/src/cli.mjs");

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9gnS0AAAAASUVORK5CYII=";

interface DevSelectionStoreModule {
  DevSelectionStore: new (root: string) => {
    write(record: unknown): unknown;
  };
}

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
}

function createSelectionRecord(sessionId: string, index: number) {
  const isoDay = String(index).padStart(2, "0");

  return {
    version: 1 as const,
    capturedAt: `2026-03-${isoDay}T00:00:00.000Z`,
    page: {
      url: `http://localhost:3000/session-${index}`,
      pathname: `/session-${index}`,
      title: `Session ${index}`,
    },
    session: {
      id: sessionId,
      label: `Session ${index}`,
      index,
      updatedAt: `2026-03-${isoDay}T00:00:00.000Z`,
    },
    element: {
      tagName: "div",
      id: `card-${index}`,
      classNames: ["hero-card"],
      role: null,
      label: `Label ${index}`,
      textPreview: `Hero card ${index}`,
      value: null,
      valuePreview: null,
      checked: null,
      selectedValue: null,
      selectedValues: [],
      placeholder: null,
      required: false,
      disabled: false,
      readOnly: false,
      multiple: false,
      inputType: null,
      selector: `#card-${index}`,
      selectorPath: `main > div:nth-of-type(${index})`,
      dataset: {},
      rect: { x: 10, y: 20, width: 120, height: 48 },
      boxModel: {
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        marginRect: { x: 10, y: 20, width: 120, height: 48 },
        paddingRect: { x: 11, y: 21, width: 118, height: 46 },
        contentRect: { x: 19, y: 29, width: 102, height: 30 },
      },
      typography: null,
      snapshot: {
        dataUrl: PNG_DATA_URL,
        mimeType: "image/png",
        width: 1,
        height: 1,
        capturedAt: `2026-03-${isoDay}T00:00:00.000Z`,
      },
      outerHTMLSnippet: `<div id="card-${index}">Hero card ${index}</div>`,
    },
    elements: [],
  };
}

describe("kuma-pickerd note fallback", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    delete process.env.KUMA_PICKER_STATE_HOME;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes a global picker note when no selection session exists", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kuma-pickerd-main-"));
    tempRoots.push(root);
    const stateHome = path.join(root, "state");

    const output = runCli(
      ["set-agent-note", "--root", root, "--author", "codex", "--status", "acknowledged", "--message", "hello"],
      root,
      { ...process.env, KUMA_PICKER_STATE_HOME: stateHome },
    );

    const note = JSON.parse(output) as {
      sessionId: string;
      message: string;
    };

    expect(note.sessionId).toBe("global-note");
    expect(note.message).toBe("hello");
    expect(existsSync(path.join(stateHome, "agent-notes", "global-note.json"))).toBe(true);

    const persisted = JSON.parse(
      readFileSync(path.join(stateHome, "agent-notes", "global-note.json"), "utf8"),
    ) as { sessionId: string };
    expect(persisted.sessionId).toBe("global-note");

    const getOutput = runCli(["get-agent-note", "--root", root], root, {
      ...process.env,
      KUMA_PICKER_STATE_HOME: stateHome,
    });
    const fetched = JSON.parse(getOutput) as { sessionId: string; message: string };
    expect(fetched.sessionId).toBe("global-note");
    expect(fetched.message).toBe("hello");
  });
});

describe("kuma-pickerd browser usage", () => {
  it("prints the console, debugger capture, sequence, refresh, download, and semantic DOM query commands in help output", () => {
    const output = runCli(["--help"], process.cwd());

    expect(output).toContain("browser-console");
    expect(output).toContain("browser-debugger-capture");
    expect(output).toContain("browser-sequence");
    expect(output).toContain("browser-refresh");
    expect(output).toContain("browser-wait-for-download");
    expect(output).toContain("browser-get-latest-download");
    expect(output).toContain("menu-state|selected-option|tab-state");
  });
});

describe("kuma-pickerd selection reads", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    delete process.env.KUMA_PICKER_STATE_HOME;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns only the latest selection by default", async () => {
    // @ts-expect-error runtime import of local .mjs helper
    const { DevSelectionStore } = (await import("./lib/dev-selection-store.mjs")) as DevSelectionStoreModule;
    const root = mkdtempSync(path.join(tmpdir(), "kuma-pickerd-selection-"));
    tempRoots.push(root);
    const stateHome = path.join(root, "state");
    process.env.KUMA_PICKER_STATE_HOME = stateHome;

    const store = new DevSelectionStore(root);
    store.write(createSelectionRecord("session_01", 1));
    store.write(createSelectionRecord("session_02", 2));

    const output = runCli(["get-selection", "--root", root], root, {
      ...process.env,
      KUMA_PICKER_STATE_HOME: stateHome,
    });

    const selection = JSON.parse(output) as {
      session: { id: string };
      page: { title: string };
      sessions?: unknown[];
    };

    expect(selection.session.id).toBe("session_02");
    expect(selection.page.title).toBe("Session 2");
    expect(selection.sessions).toBeUndefined();
  });

  it("returns a bounded collection when --recent is provided", async () => {
    // @ts-expect-error runtime import of local .mjs helper
    const { DevSelectionStore } = (await import("./lib/dev-selection-store.mjs")) as DevSelectionStoreModule;
    const root = mkdtempSync(path.join(tmpdir(), "kuma-pickerd-selection-"));
    tempRoots.push(root);
    const stateHome = path.join(root, "state");
    process.env.KUMA_PICKER_STATE_HOME = stateHome;

    const store = new DevSelectionStore(root);
    store.write(createSelectionRecord("session_01", 1));
    store.write(createSelectionRecord("session_02", 2));
    store.write(createSelectionRecord("session_03", 3));

    const output = runCli(["get-selection", "--root", root, "--recent", "2"], root, {
      ...process.env,
      KUMA_PICKER_STATE_HOME: stateHome,
    });

    const selection = JSON.parse(output) as {
      latestSessionId: string;
      sessions: Array<{ session: { id: string } }>;
    };

    expect(selection.latestSessionId).toBe("session_03");
    expect(selection.sessions.map((entry) => entry.session.id)).toEqual(["session_02", "session_03"]);
  });

  it("returns the full collection when --all is provided", async () => {
    // @ts-expect-error runtime import of local .mjs helper
    const { DevSelectionStore } = (await import("./lib/dev-selection-store.mjs")) as DevSelectionStoreModule;
    const root = mkdtempSync(path.join(tmpdir(), "kuma-pickerd-selection-"));
    tempRoots.push(root);
    const stateHome = path.join(root, "state");
    process.env.KUMA_PICKER_STATE_HOME = stateHome;

    const store = new DevSelectionStore(root);
    store.write(createSelectionRecord("session_01", 1));
    store.write(createSelectionRecord("session_02", 2));

    const output = runCli(["get-selection", "--root", root, "--all"], root, {
      ...process.env,
      KUMA_PICKER_STATE_HOME: stateHome,
    });

    const selection = JSON.parse(output) as {
      latestSessionId: string;
      sessions: Array<{ session: { id: string } }>;
    };

    expect(selection.latestSessionId).toBe("session_02");
    expect(selection.sessions.map((entry) => entry.session.id)).toEqual(["session_01", "session_02"]);
  });
});
