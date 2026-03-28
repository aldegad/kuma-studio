import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseScenarioArgs,
  readKumaSessionMetadata,
  readRepoCommit,
  readTargetOptions,
  REPO_ROOT,
  resolveKumaTarget,
  resolvePlaywrightTarget,
  runKumaScenario,
  runPlaywrightScenario,
  selectScenarios,
} from "./run-scenarios-shared.mjs";

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

function buildDefaultOutputPath(tool) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(REPO_ROOT, "artifacts", "parity", `${tool}-attach-${stamp}.json`);
}

async function writeParityOutput(outputPath, payload) {
  const absolutePath = path.isAbsolute(outputPath) ? outputPath : path.resolve(REPO_ROOT, outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolutePath;
}

function summarizeRuns(runs) {
  const durations = runs.map((entry) => entry.durationMs);
  const successCount = runs.filter((entry) => entry.ok).length;
  return {
    count: runs.length,
    successCount,
    successRate: runs.length > 0 ? Number((successCount / runs.length).toFixed(4)) : 0,
    medianMs: median(durations),
    p95Ms: percentile(durations, 0.95),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
  };
}

async function runScenarioForTool(tool, id, filePath, options) {
  if (tool === "kuma") {
    return runKumaScenario(id, filePath, options);
  }

  if (tool === "playwright") {
    return runPlaywrightScenario(id, filePath, options);
  }

  throw new Error(`Unsupported parity tool: ${tool}`);
}

async function readToolMetadata(tool, options) {
  if (tool === "kuma") {
    return {
      ...(await readKumaSessionMetadata(options.target)),
      browserLabel: options.browserLabel ?? null,
      browserVersion: options.browserVersion ?? null,
    };
  }

  if (tool === "playwright") {
    return {
      browserName: "chromium",
      browserVersion: options.browserVersion ?? null,
      browserUserAgent: null,
      browserLabel: options.browserLabel ?? null,
      extensionVersion: null,
      targetUrl: options.target.url ?? null,
      targetUrlContains: options.target.urlContains ?? null,
      activeTabId: null,
      attachedPageUrl: null,
    };
  }

  throw new Error(`Unsupported parity tool: ${tool}`);
}

async function main() {
  const options = parseScenarioArgs(process.argv.slice(2), {
    tool: "kuma",
    repeat: 3,
  });

  if (options.mode !== "attach") {
    throw new Error("Parity runner only supports --mode attach. Cross-mode comparisons are intentionally out of scope.");
  }

  const selectedIds = options.scenarios.length > 0 ? new Set(options.scenarios) : null;
  const scenarios = selectScenarios(selectedIds);
  if (scenarios.length === 0) {
    throw new Error("No matching scenarios were selected.");
  }

  const target = readTargetOptions(options.target);
  const resolvedTarget =
    options.tool === "kuma"
      ? await resolveKumaTarget(target)
      : await resolvePlaywrightTarget(target, options.cdpUrl);
  const scenarioTarget =
    options.tool === "kuma"
      ? {
          tabId: resolvedTarget.tabId,
          url: null,
          urlContains: null,
          daemonUrl: target.daemonUrl ?? null,
        }
      : target;
  const repoCommit = await readRepoCommit();
  const environment = await readToolMetadata(options.tool, {
    ...options,
    target,
  });
  const environmentSnapshots = [];
  const scenarioResults = [];

  for (const [id, filePath] of scenarios) {
    const runs = [];
    for (let index = 0; index < options.repeat; index += 1) {
      const runStartedAt = Date.now();
      try {
        const result = await runScenarioForTool(options.tool, id, filePath, {
          target: scenarioTarget,
          baseUrl: options.baseUrl,
          timeoutMs: options.timeoutMs,
          cdpUrl: options.cdpUrl,
          browserLabel: options.browserLabel,
          browserVersion: options.browserVersion,
          playwrightModulePath: options.playwrightModulePath,
          resolvedTarget,
        });
        if (result.metadata) {
          Object.assign(environment, result.metadata);
        }
        environmentSnapshots.push({
          scenarioId: id,
          runIndex: index + 1,
          browserName: environment.browserName,
          browserVersion: environment.browserVersion,
          browserUserAgent: environment.browserUserAgent,
          browserLabel: environment.browserLabel,
          extensionVersion: environment.extensionVersion,
        });
        runs.push({
          ...result,
          ok: true,
          error: null,
        });
        process.stdout.write(`[${options.tool}:${id}] run ${index + 1}/${options.repeat} ${result.durationMs}ms ok\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runs.push({
          id,
          durationMs: Math.max(0, Date.now() - runStartedAt),
          stdout: "",
          stderr: "",
          ok: false,
          error: message,
        });
        process.stdout.write(`[${options.tool}:${id}] run ${index + 1}/${options.repeat} failed: ${message}\n`);
      }
    }

    scenarioResults.push({
      id,
      runs,
      summary: summarizeRuns(runs),
    });
  }

  const payload = {
    schemaVersion: 1,
    kind: "parity-run",
    generatedAt: new Date().toISOString(),
    tool: options.tool,
    mode: options.mode,
    repeat: options.repeat,
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
    target,
    resolvedTarget,
    measurementBoundary: "tool-attach-start to scenario-complete; node process startup excluded",
    retryPolicy: "no retries; every failed run remains in the aggregate",
    repoCommit,
    environment,
    environmentSnapshots,
    scenarios: scenarioResults,
  };

  const outputPath = await writeParityOutput(options.outputPath || buildDefaultOutputPath(options.tool), payload);
  process.stdout.write(`${JSON.stringify({ ...payload, outputPath }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
