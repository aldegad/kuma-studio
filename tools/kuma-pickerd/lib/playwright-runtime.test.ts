import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const RUNTIME_PATH = path.resolve(process.cwd(), "packages/browser-extension/content/playwright-runtime.js");

class FakeElement {
  constructor({ id, role = null, accessibleText = "", visible = true } = {}) {
    this.id = id ?? null;
    this.role = role;
    this.accessibleText = accessibleText;
    this.visible = visible;
  }
}

function loadRuntime({
  candidates = [],
  fillable = [],
  querySelectorAll = () => [],
  querySelector = () => null,
} = {}) {
  const runtimeSource = readFileSync(RUNTIME_PATH, "utf8");
  const clickTargets = [];
  const pointClicks = [];

  const context = {
    globalThis: null,
    document: {
      body: { kind: "body" },
      documentElement: { kind: "documentElement" },
      title: "Test Page",
      visibilityState: "visible",
      querySelector,
      querySelectorAll,
    },
    window: {},
    Element: FakeElement,
    HTMLInputElement: class HTMLInputElement extends FakeElement {},
    HTMLTextAreaElement: class HTMLTextAreaElement extends FakeElement {},
    HTMLSelectElement: class HTMLSelectElement extends FakeElement {},
    HTMLElement: class HTMLElement extends FakeElement {},
    Error,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Map,
    Set,
    WeakSet,
    Promise,
    console,
    buildPageRecord: () => ({
      url: "https://example.com",
      pathname: "/",
      title: "Test Page",
    }),
    setTimeout,
    clearTimeout,
  };

  context.globalThis = context;
  context.KumaPickerExtensionAgentActionCore = {
    normalizeText(value) {
      return String(value ?? "").replace(/\s+/g, " ").trim();
    },
    isVisibleElement(element) {
      return element instanceof FakeElement && element.visible !== false;
    },
    describeElementForCommand(element) {
      return { id: element?.id ?? null };
    },
    getAccessibleText(element) {
      return element?.accessibleText ?? "";
    },
    getFillableElements() {
      return fillable;
    },
    getCommandCandidatesWithinRoot() {
      return candidates;
    },
    matchesRequestedRole(element, role) {
      return !role || element?.role === role;
    },
  };
  context.KumaPickerExtensionAgentActionInteraction = {
    waitForDelay: async () => {},
    executeClickCommand({ targetElement }) {
      clickTargets.push(targetElement?.id ?? null);
      return { clickedId: targetElement?.id ?? null };
    },
    executeClickPointCommand(command) {
      pointClicks.push({ x: command?.x ?? null, y: command?.y ?? null });
      return { clickPoint: { x: command?.x ?? null, y: command?.y ?? null } };
    },
    executeFillCommand() {
      throw new Error("Unexpected fill command in test.");
    },
    executeKeyCommand() {
      throw new Error("Unexpected key command in test.");
    },
    executeKeyDownCommand() {
      throw new Error("Unexpected keydown command in test.");
    },
    executeKeyUpCommand() {
      throw new Error("Unexpected keyup command in test.");
    },
    executeMouseMoveCommand() {
      throw new Error("Unexpected mousemove command in test.");
    },
    executeMouseDownCommand() {
      throw new Error("Unexpected mousedown command in test.");
    },
    executeMouseUpCommand() {
      throw new Error("Unexpected mouseup command in test.");
    },
    executePointerDragCommand() {
      throw new Error("Unexpected drag command in test.");
    },
  };

  vm.runInNewContext(runtimeSource, context, { filename: RUNTIME_PATH });

  return {
    runtime: context.KumaPickerExtensionPlaywrightRuntime,
    clickTargets,
    pointClicks,
  };
}

describe("playwright runtime locator resolution", () => {
  it("uses role name matching instead of picking the first visible role candidate", async () => {
    const hiddenStart = new FakeElement({
      id: "accessibility-start",
      role: "button",
      accessibleText: "시작하기",
      visible: false,
    });
    const visibleStart = new FakeElement({
      id: "main-start",
      role: "button",
      accessibleText: "시작하기",
    });
    const download = new FakeElement({
      id: "download",
      role: "button",
      accessibleText: "다운로드",
    });
    const { runtime, clickTargets } = loadRuntime({
      candidates: [hiddenStart, visibleStart, download],
    });

    const result = await runtime.executeAutomationCommand({
      type: "playwright",
      action: "locator.click",
      locator: {
        kind: "role",
        role: "button",
        name: "다운로드",
      },
    });

    expect(result.clickedId).toBe("download");
    expect(clickTargets).toEqual(["download"]);
  });

  it("supports zero-based nth matching for repeated locator candidates", async () => {
    const first = new FakeElement({
      id: "uri-1",
      role: "button",
      accessibleText: "+ URI 추가",
    });
    const second = new FakeElement({
      id: "uri-2",
      role: "button",
      accessibleText: "+ URI 추가",
    });
    const { runtime, clickTargets } = loadRuntime({
      candidates: [first, second],
    });

    const result = await runtime.executeAutomationCommand({
      type: "playwright",
      action: "locator.click",
      locator: {
        kind: "role",
        role: "button",
        name: "+ URI 추가",
        nth: 1,
      },
    });

    expect(result.clickedId).toBe("uri-2");
    expect(clickTargets).toEqual(["uri-2"]);
  });

  it("supports page.mouse.click as a coordinate click path", async () => {
    const { runtime, pointClicks } = loadRuntime();

    const result = await runtime.executeAutomationCommand({
      type: "playwright",
      action: "mouse.click",
      x: 320,
      y: 240,
    });

    expect(result.clickPoint).toEqual({ x: 320, y: 240 });
    expect(pointClicks).toEqual([{ x: 320, y: 240 }]);
  });
});
