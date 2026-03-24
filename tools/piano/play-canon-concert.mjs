import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(new URL("../../", import.meta.url).pathname);
const CLI_PATH = resolve(REPO_ROOT, "packages/server/src/cli.mjs");
const GENERATOR_PATH = resolve(REPO_ROOT, "tools/piano/generate-canon-variation.mjs");
const DEFAULT_SEQUENCE_PATH = "/tmp/kuma-canon-variation-1min.json";
const KNOB_TRAVEL_PX = 120;
const KNOB_MIN_RESET_PX = 140;

const CONCERT_CUES = [
  { at: 0.58, knob: "piano-tremolo-rate", target: 0.18, durationMs: 2200, steps: 28, label: "tremolo rate rise" },
  { at: 0.68, knob: "piano-tremolo-depth", target: 0.14, durationMs: 2400, steps: 30, label: "tremolo depth rise" },
  { at: 0.82, knob: "piano-modulation-rate", target: 0.08, durationMs: 1800, steps: 22, label: "modulation rate lift" },
  { at: 0.86, knob: "piano-modulation-depth", target: 0.06, durationMs: 1800, steps: 22, label: "modulation depth lift" },
  { at: 1.01, knob: "piano-modulation-depth", target: 0, durationMs: 1600, steps: 22, label: "modulation depth release" },
  { at: 1.02, knob: "piano-modulation-rate", target: 0, durationMs: 1600, steps: 22, label: "modulation rate release" },
  { at: 1.03, knob: "piano-tremolo-depth", target: 0, durationMs: 2000, steps: 28, label: "tremolo depth release" },
  { at: 1.04, knob: "piano-tremolo-rate", target: 0, durationMs: 2000, steps: 28, label: "tremolo rate release" },
];

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function runCli(args, { allowFailure = false, parseJson = true } = {}) {
  try {
    const { stdout } = await execFileAsync("node", [CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      maxBuffer: 1024 * 1024 * 4,
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
  const { stdout } = await execFileAsync("node", [GENERATOR_PATH, outputPath], {
    cwd: REPO_ROOT,
    maxBuffer: 1024 * 1024 * 4,
  });
  return JSON.parse(stdout);
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
  const knobIds = Array.from(new Set(CONCERT_CUES.map((cue) => cue.knob)));
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

async function main() {
  const tabId = Number(readFlag("--tab-id"));
  if (!Number.isFinite(tabId)) {
    throw new Error("Usage: node tools/piano/play-canon-concert.mjs --tab-id 123");
  }

  const sequencePath = resolve(readFlag("--sequence-path") || DEFAULT_SEQUENCE_PATH);
  const cueScale = Math.max(0.01, Number(readFlag("--cue-scale") || "1"));
  await runGenerator(sequencePath);

  const sequenceDefinition = JSON.parse(readFileSync(sequencePath, "utf8"));
  const durationMs = Number(sequenceDefinition?.meta?.durationMs) || 143_270;

  await runCli(["browser-sequence-stop", "--tab-id", String(tabId)], { allowFailure: true });
  const knobState = await prepareKnobs(tabId);

  const playback = await runCli([
    "browser-sequence-start",
    "--steps-file",
    sequencePath,
    "--tab-id",
    String(tabId),
    "--timeout-ms",
    "15000",
  ]);

  const startedAt = Date.now();
  const scheduled = CONCERT_CUES.map(async (cue) => {
    const offsetMs = Math.round(durationMs * cue.at * cueScale);
    const waitMs = Math.max(0, startedAt + offsetMs - Date.now());
    await sleep(waitMs);
    return dragKnobTo(tabId, knobState, cue.knob, cue.target, Math.max(240, Math.round(cue.durationMs * cueScale)), cue.steps, cue.label);
  });

  const cueResults = await Promise.all(scheduled);

  process.stdout.write(
    `${JSON.stringify(
      {
        playback: playback.sequence ?? playback,
        durationMs,
        cueScale,
        cueResults,
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
