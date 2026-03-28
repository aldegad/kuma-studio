import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const REPO_ROOT = resolve(new URL("../", import.meta.url).pathname);
export const CLI_PATH = resolve(REPO_ROOT, "packages/server/src/cli.mjs");
export const SCENARIO_DIR = resolve(REPO_ROOT, "scripts/run");
export const DEFAULT_TARGET = ["--url-contains", "localhost:3000"];

export const SCENARIOS = [
  ["agent-chat", resolve(SCENARIO_DIR, "agent-chat.smoke.js")],
  ["contenteditable-lab", resolve(SCENARIO_DIR, "contenteditable-lab.smoke.js")],
  ["sudoku", resolve(SCENARIO_DIR, "sudoku.smoke.js")],
  ["cafe-control-room", resolve(SCENARIO_DIR, "cafe-control-room.smoke.js")],
  ["shooting", resolve(SCENARIO_DIR, "shooting.smoke.js")],
];

export function parseScenarioArgs(argv, extraOptions = {}) {
  const options = {
    scenarios: [],
    targetArgs: [],
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

    if (token === "--tab-id" || token === "--url" || token === "--url-contains" || token === "--daemon-url") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }
      options.targetArgs.push(token, value);
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

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

export function selectScenarios(selectedIds) {
  return SCENARIOS.filter(([id]) => !selectedIds || selectedIds.has(id));
}

export async function runScenario(id, filePath, targetArgs) {
  const startedAt = performance.now();
  const { stdout } = await execFileAsync("node", [CLI_PATH, "run", filePath, ...targetArgs], {
    cwd: REPO_ROOT,
    maxBuffer: 1024 * 1024 * 8,
  });

  return {
    id,
    durationMs: Math.round(performance.now() - startedAt),
    stdout: stdout.trim(),
  };
}

export function readTargetArgs(targetArgs) {
  return targetArgs.length > 0 ? targetArgs : DEFAULT_TARGET;
}
