import { parseScenarioArgs, readTargetArgs, runScenario, selectScenarios } from "./run-scenarios-shared.mjs";

async function main() {
  const options = parseScenarioArgs(process.argv.slice(2));
  const selectedIds = options.scenarios.length > 0 ? new Set(options.scenarios) : null;
  const scenarios = selectScenarios(selectedIds);

  if (scenarios.length === 0) {
    throw new Error("No matching scenarios were selected.");
  }

  const targetArgs = readTargetArgs(options.targetArgs);
  const results = [];

  for (const [id, filePath] of scenarios) {
    const result = await runScenario(id, filePath, targetArgs);
    results.push(result);
    process.stdout.write(`[${id}] ${result.durationMs}ms\n`);
    if (result.stdout) {
      process.stdout.write(`${result.stdout}\n`);
    }
  }

  process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
