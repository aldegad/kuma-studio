import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
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
    read(): unknown;
  };
}

interface JobCardStoreModule {
  JobCardStore: new (root: string) => {
    write(record: unknown, fallback?: unknown): unknown;
    readAll(): { cards: unknown[] };
  };
  buildJobCardFromSelection: (selection: unknown, overrides?: unknown) => unknown;
}

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
}

function createSelectionRecord(sessionId: string, index: number, jobMessage?: string) {
  const isoDay = String(index).padStart(2, "0");

  return {
    version: 1 as const,
    capturedAt: `2026-03-${isoDay}T00:00:00.000Z`,
    page: {
      url: `http://localhost:3000/session-${index}`,
      pathname: `/session-${index}`,
      title: `Session ${index}`,
      tabId: 1000 + index,
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
      pickedPoint: { x: 44, y: 66 },
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
    job: jobMessage
      ? {
          id: `job-${index}`,
          message: jobMessage,
          createdAt: `2026-03-${isoDay}T00:00:00.000Z`,
          author: "user",
          status: "noted" as const,
        }
      : null,
  };
}

describe("kuma-pickerd browser usage", () => {
  it("prints the console, debugger capture, sequence, refresh, download, and semantic DOM query commands in help output", () => {
    const output = runCli(["--help"], process.cwd());

    expect(output).toContain("browser-console");
    expect(output).toContain("browser-debugger-capture");
    expect(output).toContain("browser-sequence");
    expect(output).toContain("browser-refresh");
    expect(output).toContain("browser-wait-for-download");
    expect(output).toContain("browser-get-latest-download");
    expect(output).toContain("--hold-ms 250");
    expect(output).toContain("browser-keydown");
    expect(output).toContain("browser-keyup");
    expect(output).toContain("browser-mousemove");
    expect(output).toContain("browser-mousedown");
    expect(output).toContain("browser-mouseup");
    expect(output).toContain("get-job-card");
    expect(output).toContain("set-job-status");
    expect(output).not.toContain("get-agent-note");
    expect(output).not.toContain("set-agent-note");
    expect(output).not.toContain("clear-agent-note");
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

  it("preserves selection jobs and tab ids when selections are persisted", async () => {
    // @ts-expect-error runtime import of local .mjs helper
    const { DevSelectionStore } = (await import("./lib/dev-selection-store.mjs")) as DevSelectionStoreModule;
    const root = mkdtempSync(path.join(tmpdir(), "kuma-pickerd-selection-"));
    tempRoots.push(root);
    const stateHome = path.join(root, "state");
    process.env.KUMA_PICKER_STATE_HOME = stateHome;

    const store = new DevSelectionStore(root);
    store.write(createSelectionRecord("session_10", 10, "Fix this card"));

    const selection = store.read() as {
      page: { tabId: number | null };
      job: { message: string; status: string } | null;
    };

    expect(selection.page.tabId).toBe(1010);
    expect(selection.job?.message).toBe("Fix this card");
    expect(selection.job?.status).toBe("noted");
  });
});

describe("kuma-pickerd job cards", () => {
  it("preserves the original picked job message and anchors to the picked point", async () => {
    // @ts-expect-error runtime import of local .mjs helper
    const { buildJobCardFromSelection } = (await import("./lib/job-card-store.mjs")) as JobCardStoreModule;

    const card = buildJobCardFromSelection(createSelectionRecord("session_04", 4, "여기 버튼 문구를 다듬어줘")) as {
      status: string;
      requestMessage: string;
      resultMessage: string;
      anchor: { point: { x: number; y: number } };
    };

    expect(card.status).toBe("noted");
    expect(card.requestMessage).toBe("여기 버튼 문구를 다듬어줘");
    expect(card.resultMessage).toBe("");
    expect(card.anchor.point).toEqual({ x: 44, y: 66 });
  });
});

describe("kuma-pickerd job cards", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    delete process.env.KUMA_PICKER_STATE_HOME;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates and updates the same job card from a picked selection", async () => {
    // @ts-expect-error runtime import of local .mjs helper
    const { JobCardStore, buildJobCardFromSelection } = (await import("./lib/job-card-store.mjs")) as JobCardStoreModule;
    const root = mkdtempSync(path.join(tmpdir(), "kuma-pickerd-job-card-"));
    tempRoots.push(root);
    const stateHome = path.join(root, "state");
    process.env.KUMA_PICKER_STATE_HOME = stateHome;

    const store = new JobCardStore(root);
    const selection = createSelectionRecord("session_20", 20, "Adjust this layout");
    const initialCard = buildJobCardFromSelection(selection) as {
      id: string;
      sessionId: string;
      status: string;
      target: { tabId: number | null };
      message: string;
    };

    const persistedInitial = store.write(initialCard, {
      id: initialCard.id,
      sessionId: initialCard.sessionId,
    }) as { id: string; status: string; updatedAt: string };
    const persistedUpdated = store.write(
      {
        sessionId: "session_20",
        status: "completed",
        message: "Updated the layout and spacing.",
        author: "codex",
      },
      {
        id: initialCard.id,
        sessionId: initialCard.sessionId,
        target: initialCard.target,
      },
    ) as { id: string; status: string; message: string; author: string };
    const persistedMoved = store.write(
      {
        sessionId: "session_20",
        position: {
          left: 320,
          top: 240,
        },
      },
      {
        id: initialCard.id,
        sessionId: initialCard.sessionId,
      },
    ) as {
      id: string;
      position: { left: number; top: number };
      updatedAt: string;
      status: string;
    };

    const feed = store.readAll() as { cards: Array<{ id: string; status: string }> };

    expect(initialCard.target.tabId).toBe(1020);
    expect(persistedInitial.status).toBe("noted");
    expect(persistedUpdated.id).toBe(initialCard.id);
    expect(persistedUpdated.status).toBe("completed");
    expect(persistedUpdated.message).toBe("Updated the layout and spacing.");
    expect(persistedUpdated.author).toBe("codex");
    expect(persistedMoved.id).toBe(initialCard.id);
    expect(persistedMoved.position).toEqual({ left: 320, top: 240 });
    expect(persistedMoved.updatedAt).toBe(persistedUpdated.updatedAt);
    expect(persistedMoved.status).toBe("completed");
    expect(feed.cards).toHaveLength(1);
    expect(feed.cards[0].id).toBe(initialCard.id);
  });
});
