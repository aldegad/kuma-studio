import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9gnS0AAAAASUVORK5CYII=";

interface DevSelectionStoreModule {
  DevSelectionStore: new (root: string) => {
    readAsset(sessionId: string, fileName: string): { body: Uint8Array; mimeType: string } | null;
    deleteSession(sessionId: string): unknown;
    write(record: unknown): {
      element: {
        label?: string | null;
        value?: string | null;
        valuePreview?: string | null;
        required?: boolean;
      };
      elements: Array<{
        label?: string | null;
        value?: string | null;
        valuePreview?: string | null;
        required?: boolean;
        snapshot?: {
          assetUrl: string;
        } | null;
      }>;
    };
  };
}

function createSelectionRecord(sessionId: string) {
  return {
    version: 1 as const,
    capturedAt: "2026-03-11T00:00:00.000Z",
    page: {
      url: "http://localhost:3000/dashboard",
      pathname: "/dashboard",
      title: "Dashboard",
    },
    session: {
      id: sessionId,
      label: "Session 1",
      index: 1,
      updatedAt: "2026-03-11T00:00:00.000Z",
    },
    element: {
      tagName: "div",
      id: "card",
      classNames: ["hero-card"],
      role: null,
      label: "Site URL",
      textPreview: "Hero card",
      value: "https://example.com/privacy",
      valuePreview: "https://example.com/privacy",
      checked: null,
      selectedValue: null,
      selectedValues: [],
      placeholder: "https://example.com/privacy",
      required: true,
      disabled: false,
      readOnly: false,
      multiple: false,
      inputType: "url",
      selector: "#card",
      selectorPath: "main > div:nth-of-type(1)",
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
        capturedAt: "2026-03-11T00:00:00.000Z",
      },
      outerHTMLSnippet: "<div id=\"card\">Hero card</div>",
    },
    elements: [],
  };
}

describe("DevSelectionStore snapshots", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    delete process.env.KUMA_PICKER_STATE_HOME;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes snapshot assets and returns a local asset url", async () => {
    // @ts-expect-error local .mjs helper is runtime-tested here and has no native TS declaration.
    const { DevSelectionStore } = (await import("./dev-selection-store.mjs")) as DevSelectionStoreModule;
    const root = mkdtempSync(path.join(tmpdir(), "dev-selection-store-"));
    tempRoots.push(root);
    const stateHome = path.join(root, "state");
    process.env.KUMA_PICKER_STATE_HOME = stateHome;

    const store = new DevSelectionStore(root);
    const saved = store.write(createSelectionRecord("session_01"));

    expect(saved.elements[0].snapshot?.assetUrl).toBe(
      "/dev-selection/assets/session_01/selection-01.png",
    );
    expect(saved.element.label).toBe("Site URL");
    expect(saved.element.valuePreview).toBe("https://example.com/privacy");
    expect(saved.element.required).toBe(true);
    expect(
      existsSync(
        path.join(stateHome, "dev-selection-assets", "session_01", "selection-01.png"),
      ),
    ).toBe(true);

    const asset = store.readAsset("session_01", "selection-01.png");
    expect(asset?.mimeType).toBe("image/png");
    expect(asset?.body.byteLength).toBeGreaterThan(0);
  });

  it("removes session assets when a session is deleted", async () => {
    // @ts-expect-error local .mjs helper is runtime-tested here and has no native TS declaration.
    const { DevSelectionStore } = (await import("./dev-selection-store.mjs")) as DevSelectionStoreModule;
    const root = mkdtempSync(path.join(tmpdir(), "dev-selection-store-"));
    tempRoots.push(root);
    const stateHome = path.join(root, "state");
    process.env.KUMA_PICKER_STATE_HOME = stateHome;

    const store = new DevSelectionStore(root);
    store.write(createSelectionRecord("session_02"));
    store.deleteSession("session_02");

    expect(
      existsSync(
        path.join(stateHome, "dev-selection-assets", "session_02", "selection-01.png"),
      ),
    ).toBe(false);
  });
});
