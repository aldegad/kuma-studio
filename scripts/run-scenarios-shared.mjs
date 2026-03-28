import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import path, { resolve } from "node:path";
import { promisify } from "node:util";

import { commandRun } from "../tools/kuma-pickerd/lib/playwright-runner.mjs";

const execFileAsync = promisify(execFile);
const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

export const REPO_ROOT = resolve(new URL("../", import.meta.url).pathname);
export const SCENARIO_DIR = resolve(REPO_ROOT, "scripts/run");
export const DEFAULT_BASE_URL = "http://localhost:3000";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_TARGET = {
  tabId: null,
  url: null,
  urlContains: "localhost:3000",
  daemonUrl: null,
};
export const DEFAULT_CDP_URL = "http://127.0.0.1:9222";

export const SCENARIOS = [
  ["agent-chat", resolve(SCENARIO_DIR, "agent-chat.smoke.js")],
  ["contenteditable-lab", resolve(SCENARIO_DIR, "contenteditable-lab.smoke.js")],
  ["sudoku", resolve(SCENARIO_DIR, "sudoku.smoke.js")],
  ["cafe-control-room", resolve(SCENARIO_DIR, "cafe-control-room.smoke.js")],
  ["shooting", resolve(SCENARIO_DIR, "shooting.smoke.js")],
];

function hasExplicitTarget(target) {
  return (
    Number.isInteger(target?.tabId) ||
    (typeof target?.url === "string" && target.url.length > 0) ||
    (typeof target?.urlContains === "string" && target.urlContains.length > 0)
  );
}

function normalizeTarget(target) {
  const normalized = {
    tabId: Number.isInteger(target?.tabId) ? target.tabId : null,
    url: typeof target?.url === "string" && target.url.trim() ? target.url.trim() : null,
    urlContains: typeof target?.urlContains === "string" && target.urlContains.trim() ? target.urlContains.trim() : null,
    daemonUrl: typeof target?.daemonUrl === "string" && target.daemonUrl.trim() ? target.daemonUrl.trim() : null,
  };

  return hasExplicitTarget(normalized) ? normalized : { ...DEFAULT_TARGET };
}

function doesTargetMatchPage(target, pageUrl) {
  if (typeof pageUrl !== "string" || !pageUrl) {
    return false;
  }

  if (target.url) {
    return pageUrl === target.url;
  }

  if (target.urlContains) {
    return pageUrl.includes(target.urlContains);
  }

  return false;
}

function targetToCommandOptions(target, timeoutMs) {
  const options = {
    "timeout-ms": timeoutMs,
  };

  if (Number.isInteger(target.tabId)) {
    options["tab-id"] = String(target.tabId);
  }
  if (target.url) {
    options.url = target.url;
  }
  if (target.urlContains) {
    options["url-contains"] = target.urlContains;
  }
  if (target.daemonUrl) {
    options["daemon-url"] = target.daemonUrl;
  }

  return options;
}

function trimCapturedText(buffer) {
  return buffer.join("\n").trim();
}

async function withCapturedOutput(run) {
  const stdout = [];
  const stderr = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk, encoding, callback) => {
    stdout.push(Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === "string" ? encoding : undefined) : String(chunk));
    if (typeof encoding === "function") {
      encoding();
    } else if (typeof callback === "function") {
      callback();
    }
    return true;
  });

  process.stderr.write = ((chunk, encoding, callback) => {
    stderr.push(Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === "string" ? encoding : undefined) : String(chunk));
    if (typeof encoding === "function") {
      encoding();
    } else if (typeof callback === "function") {
      callback();
    }
    return true;
  });

  try {
    const value = await run();
    return {
      value,
      stdout: trimCapturedText(stdout),
      stderr: trimCapturedText(stderr),
    };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

async function withTempScenarioFile(source, run) {
  const directory = await mkdtemp(path.join(tmpdir(), "kuma-parity-scenario-"));
  const scriptPath = path.join(directory, "scenario.js");
  await writeFile(scriptPath, source, "utf8");

  try {
    return await run(scriptPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createScriptConsole(captured) {
  return {
    log: (...args) => {
      captured.stdout.push(args.map(formatConsoleValue).join(" "));
    },
    info: (...args) => {
      captured.stdout.push(args.map(formatConsoleValue).join(" "));
    },
    warn: (...args) => {
      captured.stderr.push(args.map(formatConsoleValue).join(" "));
    },
    error: (...args) => {
      captured.stderr.push(args.map(formatConsoleValue).join(" "));
    },
  };
}

function formatConsoleValue(value) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function buildScenarioPrelude(baseUrl) {
  return `const baseUrl = ${JSON.stringify(baseUrl)};\n`;
}

function requirePlaywrightTarget(target) {
  if (Number.isInteger(target.tabId)) {
    throw new Error("Playwright parity attach mode does not support --tab-id. Use --url or --url-contains.");
  }

  if (!target.url && !target.urlContains) {
    throw new Error("Playwright parity attach mode requires --url or --url-contains.");
  }
}

async function resolvePlaywrightPage(browser, target) {
  if (target?.pageTargetId) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const page of pages) {
      try {
        const session = await page.context().newCDPSession(page);
        const info = await session.send("Target.getTargetInfo");
        if (info?.targetInfo?.targetId === target.pageTargetId) {
          return page;
        }
      } catch {
        // Ignore pages that cannot answer target info.
      }
    }

    throw new Error("Could not re-attach the exact Playwright target page.");
  }

  const pages = browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => {
      return doesTargetMatchPage(target, page.url());
    });

  if (pages.length === 0) {
    throw new Error("No attached Playwright page matched the requested target. Open the benchmark tab first and try again.");
  }

  if (pages.length > 1) {
    throw new Error("Multiple attached Playwright pages matched the requested target. Narrow the target to a single tab.");
  }

  return pages[0];
}

async function collectPlaywrightMetadata(page, browser, target, browserLabel = null) {
  let browserVersion = typeof browser.version === "function" ? browser.version() : null;
  let browserUserAgent = null;

  try {
    const session = await page.context().newCDPSession(page);
    const version = await session.send("Browser.getVersion");
    browserVersion = typeof version?.product === "string" ? version.product : browserVersion;
    browserUserAgent = typeof version?.userAgent === "string" ? version.userAgent : null;
  } catch {
    // Best effort only.
  }

  return {
    browserName: "chromium",
    browserVersion,
    browserUserAgent,
    browserLabel,
    targetUrl: target.url ?? null,
    targetUrlContains: target.urlContains ?? null,
    attachedPageUrl: page.url(),
  };
}

function createPlaywrightParityPage(page) {
  const mouse = {
    ...page.mouse,
    async drag(from, to, options = {}) {
      const steps = Number.isInteger(options.steps) && options.steps > 0 ? options.steps : 12;
      const durationMs = Number.isFinite(options.durationMs) && options.durationMs > 0 ? options.durationMs : 0;

      await page.mouse.move(from.x, from.y);
      await page.mouse.down();

      for (let index = 1; index <= steps; index += 1) {
        const ratio = index / steps;
        const x = from.x + (to.x - from.x) * ratio;
        const y = from.y + (to.y - from.y) * ratio;
        await page.mouse.move(x, y);
        if (durationMs > 0) {
          await page.waitForTimeout(Math.round(durationMs / steps));
        }
      }

      await page.mouse.up();
    },
  };

  return new Proxy(page, {
    get(target, property, receiver) {
      if (property === "mouse") {
        return mouse;
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

export function parseScenarioArgs(argv, extraOptions = {}) {
  const options = {
    scenarios: [],
    target: { ...DEFAULT_TARGET },
    repeat: 1,
    baseUrl: DEFAULT_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outputPath: null,
    tool: null,
    mode: "attach",
    cdpUrl: DEFAULT_CDP_URL,
    browserLabel: null,
    browserVersion: null,
    playwrightModulePath: null,
    ...extraOptions,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--scenario") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--scenario requires a value.");
      }
      options.scenarios.push(value);
      index += 1;
      continue;
    }

    if (token === "--tab-id") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value)) {
        throw new Error("--tab-id requires an integer value.");
      }
      options.target.tabId = value;
      index += 1;
      continue;
    }

    if (token === "--url" || token === "--url-contains" || token === "--daemon-url") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }

      if (token === "--url") options.target.url = value;
      if (token === "--url-contains") options.target.urlContains = value;
      if (token === "--daemon-url") options.target.daemonUrl = value;
      index += 1;
      continue;
    }

    if (token === "--repeat") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--repeat requires a positive integer.");
      }
      options.repeat = value;
      index += 1;
      continue;
    }

    if (token === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--output requires a path.");
      }
      options.outputPath = value;
      index += 1;
      continue;
    }

    if (token === "--base-url") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--base-url requires a value.");
      }
      options.baseUrl = value;
      index += 1;
      continue;
    }

    if (token === "--timeout-ms") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--timeout-ms requires a positive integer.");
      }
      options.timeoutMs = value;
      index += 1;
      continue;
    }

    if (token === "--tool") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--tool requires a value.");
      }
      options.tool = value;
      index += 1;
      continue;
    }

    if (token === "--mode") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--mode requires a value.");
      }
      options.mode = value;
      index += 1;
      continue;
    }

    if (token === "--cdp-url") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--cdp-url requires a value.");
      }
      options.cdpUrl = value;
      index += 1;
      continue;
    }

    if (token === "--browser-label") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--browser-label requires a value.");
      }
      options.browserLabel = value;
      index += 1;
      continue;
    }

    if (token === "--browser-version") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--browser-version requires a value.");
      }
      options.browserVersion = value;
      index += 1;
      continue;
    }

    if (token === "--playwright-module-path") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--playwright-module-path requires a value.");
      }
      options.playwrightModulePath = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  options.target = normalizeTarget(options.target);
  return options;
}

export function selectScenarios(selectedIds) {
  return SCENARIOS.filter(([id]) => !selectedIds || selectedIds.has(id));
}

export function readTargetOptions(target) {
  return normalizeTarget(target);
}

export async function readScenarioSource(filePath, baseUrl = DEFAULT_BASE_URL) {
  const scenarioSource = await readFile(filePath, "utf8");
  return `${buildScenarioPrelude(baseUrl)}${scenarioSource}\n`;
}

export async function runKumaScenario(id, filePath, options = {}) {
  const target = normalizeTarget(options.target);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scriptSource = await readScenarioSource(filePath, options.baseUrl ?? DEFAULT_BASE_URL);
  const startedAt = performance.now();
  const { stdout, stderr } = await withCapturedOutput(() =>
    withTempScenarioFile(scriptSource, (scriptPath) => commandRun(targetToCommandOptions(target, timeoutMs), scriptPath)),
  );

  return {
    id,
    durationMs: Math.round(performance.now() - startedAt),
    stdout,
    stderr,
  };
}

export async function runPlaywrightScenario(id, filePath, options = {}) {
  const target = normalizeTarget(options.target);
  requirePlaywrightTarget(target);

  let playwrightModule = null;
  try {
    if (typeof options.playwrightModulePath === "string" && options.playwrightModulePath.trim()) {
      playwrightModule = await import(path.resolve(REPO_ROOT, options.playwrightModulePath.trim()));
    } else {
      playwrightModule = await import("playwright");
    }
  } catch {
    throw new Error(
      "Playwright parity runs require the `playwright` package. Provide --playwright-module-path or install Playwright in a resolvable location.",
    );
  }

  const { chromium } = playwrightModule;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scriptSource = await readScenarioSource(filePath, options.baseUrl ?? DEFAULT_BASE_URL);
  const startedAt = performance.now();
  const browser = await chromium.connectOverCDP(options.cdpUrl ?? DEFAULT_CDP_URL);

  try {
    const page = await resolvePlaywrightPage(browser, options.resolvedTarget ?? target);
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    const parityPage = createPlaywrightParityPage(page);
    const captured = { stdout: [], stderr: [] };
    const scriptConsole = createScriptConsole(captured);
    const executor = new AsyncFunction(
      "page",
      "console",
      `"use strict"; return (async () => {\n${scriptSource}\n})();`,
    );
    await executor(parityPage, scriptConsole);

    return {
      id,
      durationMs: Math.round(performance.now() - startedAt),
      stdout: trimCapturedText(captured.stdout),
      stderr: trimCapturedText(captured.stderr),
      metadata: await collectPlaywrightMetadata(page, browser, target, options.browserLabel ?? null),
    };
  } finally {
    await browser.close();
  }
}

export async function readRepoCommit() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function readKumaSessionMetadata(target) {
  const daemonUrl = target?.daemonUrl ?? "http://127.0.0.1:4312";
  const response = await fetch(`${daemonUrl}/browser-session`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to read Kuma browser session metadata from ${daemonUrl}.`);
  }

  const payload = await response.json();
  let browserUserAgent = payload?.browserUserAgent ?? null;

  if (!browserUserAgent) {
    try {
      const metadataScript = 'console.log(await page.evaluate(() => navigator.userAgent));';
      const captured = await withCapturedOutput(() =>
        withTempScenarioFile(metadataScript, (scriptPath) =>
          commandRun(targetToCommandOptions(normalizeTarget(target), DEFAULT_TIMEOUT_MS), scriptPath),
        ),
      );
      browserUserAgent = captured.stdout || null;
    } catch {
      browserUserAgent = null;
    }
  }

  return {
    browserName: payload?.browserName ?? null,
    browserVersion: payload?.browserVersion ?? null,
    browserUserAgent,
    browserLabel: null,
    extensionVersion: payload?.extensionVersion ?? null,
    targetUrl: target?.url ?? null,
    targetUrlContains: target?.urlContains ?? null,
    activeTabId: payload?.activeTabId ?? null,
    attachedPageUrl: payload?.page?.url ?? null,
  };
}

export async function resolveKumaTarget(target) {
  const normalizedTarget = normalizeTarget(target);
  const daemonUrl = normalizedTarget.daemonUrl ?? "http://127.0.0.1:4312";
  const response = await fetch(`${daemonUrl}/browser-session`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to resolve the Kuma parity target from ${daemonUrl}.`);
  }

  const payload = await response.json();
  const tabCandidates = Array.isArray(payload?.tabs) ? payload.tabs : [];
  const matches = tabCandidates.filter((entry) => doesTargetMatchPage(normalizedTarget, entry?.page?.url ?? null));

  if (matches.length === 0) {
    throw new Error("No Kuma browser tab matched the requested parity target.");
  }

  if (matches.length > 1) {
    throw new Error("Multiple Kuma browser tabs matched the requested parity target. Use a narrower target before recording parity results.");
  }

  const match = matches[0];
  return {
    lockKind: "tab-id",
    tabId: match.tabId,
    initialPageUrl: match?.page?.url ?? null,
    initialPageTitle: match?.page?.title ?? null,
  };
}

export async function resolvePlaywrightTarget(target, cdpUrl) {
  const normalizedTarget = normalizeTarget(target);
  requirePlaywrightTarget(normalizedTarget);
  const response = await fetch(new URL("/json/list", cdpUrl).toString(), {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to resolve the Playwright parity target from ${cdpUrl}.`);
  }

  const payload = await response.json();
  const pageTargets = Array.isArray(payload) ? payload.filter((entry) => entry?.type === "page") : [];
  const matches = pageTargets.filter((entry) => doesTargetMatchPage(normalizedTarget, entry?.url ?? null));

  if (matches.length === 0) {
    throw new Error("No Playwright page matched the requested parity target.");
  }

  if (matches.length > 1) {
    throw new Error("Multiple Playwright pages matched the requested parity target. Use a narrower target before recording parity results.");
  }

  const match = matches[0];
  return {
    lockKind: "cdp-target-id",
    pageTargetId: typeof match.id === "string" ? match.id : null,
    initialPageUrl: typeof match.url === "string" ? match.url : null,
    initialPageTitle: typeof match.title === "string" ? match.title : null,
  };
}
