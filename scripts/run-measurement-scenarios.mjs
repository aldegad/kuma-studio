import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseScenarioArgs, readTargetOptions, runKumaScenario, selectScenarios, REPO_ROOT } from "./run-scenarios-shared.mjs";

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function buildDefaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(REPO_ROOT, "artifacts", "measurements", `measurement-${stamp}.json`);
}

async function writeMeasurementOutput(outputPath, payload) {
  const absolutePath = path.isAbsolute(outputPath) ? outputPath : path.resolve(REPO_ROOT, outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolutePath;
}

async function main() {
  const options = parseScenarioArgs(process.argv.slice(2), {
    repeat: 3,
    outputPath: null,
  });
  const selectedIds = options.scenarios.length > 0 ? new Set(options.scenarios) : null;
  const scenarios = selectScenarios(selectedIds);

  if (scenarios.length === 0) {
    throw new Error("No matching scenarios were selected.");
  }

  const target = readTargetOptions(options.target);
  const runCount = options.repeat;
  const scenarioResults = [];

  for (const [id, filePath] of scenarios) {
    const runs = [];
    for (let index = 0; index < runCount; index += 1) {
      const result = await runKumaScenario(id, filePath, {
        target,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
      });
      runs.push(result);
      process.stdout.write(`[${id}] run ${index + 1}/${runCount} ${result.durationMs}ms\n`);
    }

    const durations = runs.map((entry) => entry.durationMs);
    scenarioResults.push({
      id,
      runs,
      summary: {
        count: runs.length,
        medianMs: median(durations),
        p95Ms: percentile(durations, 0.95),
        minMs: Math.min(...durations),
        maxMs: Math.max(...durations),
      },
    });
  }

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    repeat: runCount,
    target,
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
    scenarios: scenarioResults,
  };

  const outputPath = await writeMeasurementOutput(options.outputPath || buildDefaultOutputPath(), payload);
  process.stdout.write(`${JSON.stringify({ ...payload, outputPath }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
