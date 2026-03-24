import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(new URL("../../", import.meta.url).pathname);
const CLI_PATH = resolve(REPO_ROOT, "packages/server/src/cli.mjs");
const GENERATOR_PATH = resolve(REPO_ROOT, "tools/piano/generate-canon-variation.mjs");
const DEFAULT_SEQUENCE_PATH = "/tmp/kuma-canon-variation-1min.json";
const DEFAULT_TAIL_PATH = "/tmp/kuma-canon-tail-api.json";
const DEFAULT_TAIL_DURATION_MS = 10_000;
const KNOB_TRAVEL_PX = 120;
const KNOB_MIN_RESET_PX = 140;
const KNOB_SELECTORS_BY_FIELD = {
  modRate: "piano-modulation-rate",
  modDepth: "piano-modulation-depth",
  tremRate: "piano-tremolo-rate",
  tremDepth: "piano-tremolo-depth",
};

const INITIAL_EFFECTS = {
  modRate: 0.08,
  modDepth: 0.06,
  tremRate: 0.18,
  tremDepth: 0.14,
};

const EFFECT_RELEASES = [
  { field: "modDepth", from: 0.06, to: 0, atMs: 900, durationMs: 520, steps: 10, label: "modulation depth release" },
  { field: "modRate", from: 0.08, to: 0, atMs: 980, durationMs: 520, steps: 10, label: "modulation rate release" },
  { field: "tremDepth", from: 0.14, to: 0, atMs: 1200, durationMs: 700, steps: 14, label: "tremolo depth release" },
  { field: "tremRate", from: 0.18, to: 0, atMs: 1320, durationMs: 700, steps: 14, label: "tremolo rate release" },
];

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

async function runCli(args, { allowFailure = false, parseJson = true } = {}) {
  try {
    const { stdout } = await execFileAsync("node", [CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      maxBuffer: 1024 * 1024 * 8,
    });
    return parseJson ? JSON.parse(stdout) : stdout;
  } catch (error) {
    if (allowFailure) {
      return null;
    }
    throw error;
  }
}

async function runGenerator(outputPath) {
  await execFileAsync("node", [GENERATOR_PATH, outputPath], {
    cwd: REPO_ROOT,
    maxBuffer: 1024 * 1024 * 8,
  });
}

function deriveTail(sequenceDefinition, tailDurationMs) {
  const steps = Array.isArray(sequenceDefinition?.steps) ? sequenceDefinition.steps : [];
  const totalMs =
    Number(sequenceDefinition?.meta?.durationMs) ||
    steps.reduce((sum, step) => sum + (Number(step?.postActionDelayMs) || 0), 0);
  const startMs = Math.max(0, totalMs - tailDurationMs);
  const activeSelectors = new Set();
  const keptSteps = [];
  let cursorMs = 0;
  let firstKeptOffsetMs = null;

  for (const step of steps) {
    const eventAtMs = cursorMs;
    const selector = typeof step?.selector === "string" ? step.selector : "";

    if (eventAtMs < startMs) {
      if (step?.type === "mousedown" && selector) {
        activeSelectors.add(selector);
      }
      if (step?.type === "mouseup" && selector) {
        activeSelectors.delete(selector);
      }
    } else {
      if (firstKeptOffsetMs == null) {
        firstKeptOffsetMs = eventAtMs - startMs;
      }
      keptSteps.push({ ...step });
    }

    cursorMs += Number(step?.postActionDelayMs) || 0;
  }

  const restoredSteps = [...activeSelectors]
    .sort((left, right) => {
      const leftPriority = left.includes("sustain-pedal") ? -1 : 0;
      const rightPriority = right.includes("sustain-pedal") ? -1 : 0;
      return leftPriority - rightPriority || left.localeCompare(right);
    })
    .map((selector) => ({
      type: "mousedown",
      selector,
    }));

  if (restoredSteps.length > 0 && firstKeptOffsetMs && firstKeptOffsetMs > 0) {
    restoredSteps[restoredSteps.length - 1].postActionDelayMs = firstKeptOffsetMs;
  }

  const tailSteps = [...restoredSteps, ...keptSteps];
  const durationMs = tailSteps.reduce((sum, step) => sum + (Number(step?.postActionDelayMs) || 0), 0);

  return {
    meta: {
      title: "Kuma Canon Variation Tail Concert",
      sourceTitle: sequenceDefinition?.meta?.title || null,
      sourceDurationMs: totalMs,
      trimmedFromMs: startMs,
      durationMs,
      restoredHeldSelectors: restoredSteps.length,
    },
    steps: tailSteps,
  };
}

async function readKnobCenter(tabId, testId) {
  const result = await runCli([
    "browser-query-dom",
    "--kind",
    "selector-state",
    "--selector",
    `[data-testid="${testId}"][role="slider"]`,
    "--tab-id",
    String(tabId),
  ]);

  const knob = result?.results?.[0];
  const rect = knob?.rect;
  if (!rect) {
    return null;
  }

  return {
    x: Math.round((rect.x + rect.width / 2) * 100) / 100,
    y: Math.round((rect.y + rect.height / 2) * 100) / 100,
  };
}

async function resetKnobToMin(tabId, center) {
  await runCli([
    "browser-pointer-drag",
    "--from-x",
    String(center.x),
    "--from-y",
    String(center.y),
    "--to-x",
    String(center.x),
    "--to-y",
    String(Math.round((center.y + KNOB_MIN_RESET_PX) * 100) / 100),
    "--steps",
    "12",
    "--duration-ms",
    "260",
    "--tab-id",
    String(tabId),
    "--post-action-delay-ms",
    "40",
  ]);
}

async function prepareKnobs(tabId) {
  const knobIds = Object.values(KNOB_SELECTORS_BY_FIELD);
  const knobState = new Map();

  for (const knobId of knobIds) {
    const center = await readKnobCenter(tabId, knobId);
    if (!center) {
      throw new Error(`Could not resolve knob "${knobId}".`);
    }
    await resetKnobToMin(tabId, center);
    knobState.set(knobId, { ...center, value: 0 });
  }

  return knobState;
}

async function dragKnobTo(tabId, knobState, testId, target, durationMs, steps, label) {
  const state = knobState.get(testId) ?? null;
  if (!state) {
    throw new Error(`Could not resolve knob "${testId}" for ${label}.`);
  }

  const current = Math.max(0, Math.min(1, Number(state.value)));
  const next = Math.max(0, Math.min(1, target));
  const deltaPx = (next - current) * KNOB_TRAVEL_PX;
  if (Math.abs(deltaPx) < 0.5) {
    return {
      skipped: true,
      label,
      current,
      target: next,
    };
  }

  const fromX = Math.round(state.x * 100) / 100;
  const fromY = Math.round(state.y * 100) / 100;
  const toY = Math.round((state.y - deltaPx) * 100) / 100;

  await runCli([
    "browser-pointer-drag",
    "--from-x", String(fromX),
    "--from-y", String(fromY),
    "--to-x", String(fromX),
    "--to-y", String(toY),
    "--steps", String(steps),
    "--duration-ms", String(durationMs),
    "--tab-id", String(tabId),
    "--post-action-delay-ms", "80",
  ]);

  knobState.set(testId, {
    ...state,
    value: next,
  });

  return {
    skipped: false,
    label,
    from: current,
    to: next,
  };
}

async function setInitialKnobs(tabId, knobState) {
  const setup = [];
  for (const [field, value] of Object.entries(INITIAL_EFFECTS)) {
    const knobId = KNOB_SELECTORS_BY_FIELD[field];
    setup.push(
      await dragKnobTo(
        tabId,
        knobState,
        knobId,
        value,
        220,
        12,
        `${field} pre-roll`,
      ),
    );
  }
  return setup;
}

async function main() {
  const tabId = Number(readFlag("--tab-id"));
  if (!Number.isFinite(tabId)) {
    throw new Error("Usage: node tools/piano/play-canon-tail-api.mjs --tab-id 123");
  }

  const sequencePath = resolve(readFlag("--sequence-path") || DEFAULT_SEQUENCE_PATH);
  const tailPath = resolve(readFlag("--tail-path") || DEFAULT_TAIL_PATH);
  const durationMs = Math.max(1_000, Number(readFlag("--duration-ms") || DEFAULT_TAIL_DURATION_MS));

  await runGenerator(sequencePath);
  const fullDefinition = JSON.parse(readFileSync(sequencePath, "utf8"));
  const tailDefinition = deriveTail(fullDefinition, durationMs);
  writeFileSync(tailPath, JSON.stringify(tailDefinition, null, 2));

  await runCli(["browser-sequence-stop", "--tab-id", String(tabId)], { allowFailure: true });
  const knobState = await prepareKnobs(tabId);
  const setupResults = await setInitialKnobs(tabId, knobState);

  const playback = await runCli([
    "browser-sequence-start",
    "--steps-file",
    tailPath,
    "--tab-id",
    String(tabId),
    "--timeout-ms",
    "15000",
  ]);

  const startedAt = Date.now();
  const cueResults = await Promise.all(
    EFFECT_RELEASES.map(async (cue) => {
      const knobId = KNOB_SELECTORS_BY_FIELD[cue.field];
      const waitMs = Math.max(0, startedAt + cue.atMs - Date.now());
      await sleep(waitMs);
      return dragKnobTo(tabId, knobState, knobId, cue.to, cue.durationMs, cue.steps, cue.label);
    }),
  );

  await sleep(tailDefinition.meta.durationMs + 900);

  const verification = await runCli([
    "browser-eval",
    "--tab-id",
    String(tabId),
    "--expression",
    `(() => ({
      activeKeys: Array.from(document.querySelectorAll("[data-piano-active='true']")).map((node) => node.getAttribute("data-piano-key-id")),
      overlayChildren: document.getElementById("kuma-picker-gesture-overlay-root")?.childElementCount ?? 0,
      knobValues: {
        modRate: document.querySelector('[data-testid="piano-modulation-rate"]')?.getAttribute("aria-valuenow") ?? null,
        modDepth: document.querySelector('[data-testid="piano-modulation-depth"]')?.getAttribute("aria-valuenow") ?? null,
        tremRate: document.querySelector('[data-testid="piano-tremolo-rate"]')?.getAttribute("aria-valuenow") ?? null,
        tremDepth: document.querySelector('[data-testid="piano-tremolo-depth"]')?.getAttribute("aria-valuenow") ?? null,
      },
    }))()`,
  ]);

  process.stdout.write(
    `${JSON.stringify(
      {
        playback: playback.sequence ?? playback,
        tailPath,
        setupResults,
        cueResults,
        verification: verification.value ?? verification,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
