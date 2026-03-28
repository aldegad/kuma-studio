import { readFile } from "node:fs/promises";
import path from "node:path";

import { REPO_ROOT } from "./run-scenarios-shared.mjs";

function parseArgs(argv) {
  const options = {
    kumaPath: null,
    playwrightPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--kuma") {
      options.kumaPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--playwright") {
      options.playwrightPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.kumaPath || !options.playwrightPath) {
    throw new Error("compare-parity-results requires --kuma <path> and --playwright <path>.");
  }

  return options;
}

async function readJson(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(REPO_ROOT, filePath);
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function compareScalar(label, left, right) {
  assert(left === right, `${label} mismatch: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`);
}

function normalizeBrowserVersion(value) {
  if (typeof value !== "string") {
    return null;
  }

  return value.replace(/^Chrome\//, "").trim() || null;
}

function compareScenarioSet(kuma, playwright) {
  const kumaIds = kuma.scenarios.map((entry) => entry.id).sort();
  const playwrightIds = playwright.scenarios.map((entry) => entry.id).sort();
  compareScalar("scenario ids", JSON.stringify(kumaIds), JSON.stringify(playwrightIds));
}

function buildScenarioIndex(payload) {
  return new Map(payload.scenarios.map((entry) => [entry.id, entry]));
}

function collectComparison(kuma, playwright) {
  const playwrightIndex = buildScenarioIndex(playwright);
  return kuma.scenarios.map((entry) => {
    const other = playwrightIndex.get(entry.id);
    return {
      id: entry.id,
      kuma: entry.summary,
      playwright: other.summary,
    };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const kuma = await readJson(options.kumaPath);
  const playwright = await readJson(options.playwrightPath);

  compareScalar("kuma kind", kuma.kind, "parity-run");
  compareScalar("playwright kind", playwright.kind, "parity-run");
  compareScalar("kuma tool", kuma.tool, "kuma");
  compareScalar("playwright tool", playwright.tool, "playwright");
  compareScalar("mode", kuma.mode, playwright.mode);
  compareScalar("baseUrl", kuma.baseUrl, playwright.baseUrl);
  compareScalar("timeoutMs", kuma.timeoutMs, playwright.timeoutMs);
  compareScalar("repeat", kuma.repeat, playwright.repeat);
  compareScalar("measurementBoundary", kuma.measurementBoundary, playwright.measurementBoundary);
  compareScalar("retryPolicy", kuma.retryPolicy, playwright.retryPolicy);
  compareScalar("repoCommit", kuma.repoCommit, playwright.repoCommit);
  compareScalar("target.url", kuma.target?.url ?? null, playwright.target?.url ?? null);
  compareScalar("target.urlContains", kuma.target?.urlContains ?? null, playwright.target?.urlContains ?? null);
  compareScalar("resolvedTarget.initialPageUrl", kuma.resolvedTarget?.initialPageUrl ?? null, playwright.resolvedTarget?.initialPageUrl ?? null);
  assert(
    typeof kuma.resolvedTarget?.lockKind === "string" && kuma.resolvedTarget.lockKind.length > 0,
    "Kuma parity result is missing resolvedTarget.lockKind.",
  );
  assert(
    typeof playwright.resolvedTarget?.lockKind === "string" && playwright.resolvedTarget.lockKind.length > 0,
    "Playwright parity result is missing resolvedTarget.lockKind.",
  );
  assert(
    typeof kuma.environment?.extensionVersion === "string" && kuma.environment.extensionVersion.length > 0,
    "Kuma parity result is missing extensionVersion metadata.",
  );
  const kumaBrowserVersion = normalizeBrowserVersion(kuma.environment?.browserVersion ?? null);
  const playwrightBrowserVersion = normalizeBrowserVersion(playwright.environment?.browserVersion ?? null);
  if (kumaBrowserVersion && playwrightBrowserVersion) {
    compareScalar("browserVersion", kumaBrowserVersion, playwrightBrowserVersion);
  } else {
    assert(
      typeof kumaBrowserVersion === "string" && kumaBrowserVersion.length > 0,
      "Parity comparison requires browserVersion metadata when browserUserAgent is unavailable.",
    );
    assert(
      typeof playwrightBrowserVersion === "string" && playwrightBrowserVersion.length > 0,
      "Parity comparison requires browserVersion metadata when browserUserAgent is unavailable.",
    );
  }
  const kumaUserAgent = kuma.environment?.browserUserAgent ?? null;
  const playwrightUserAgent = playwright.environment?.browserUserAgent ?? null;
  if (kumaUserAgent && playwrightUserAgent) {
    compareScalar("browserUserAgent", kumaUserAgent, playwrightUserAgent);
  } else {
    assert(
      typeof kuma.environment?.browserLabel === "string" && kuma.environment.browserLabel.length > 0,
      "Parity comparison requires either matching browserUserAgent values or explicit browserLabel metadata.",
    );
    assert(
      typeof playwright.environment?.browserLabel === "string" && playwright.environment.browserLabel.length > 0,
      "Parity comparison requires either matching browserUserAgent values or explicit browserLabel metadata.",
    );
    compareScalar("browserLabel", kuma.environment.browserLabel, playwright.environment.browserLabel);
  }
  compareScenarioSet(kuma, playwright);

  const comparison = {
    ok: true,
    comparedAt: new Date().toISOString(),
    mode: kuma.mode,
    baseUrl: kuma.baseUrl,
    timeoutMs: kuma.timeoutMs,
    repeat: kuma.repeat,
    browserUserAgent: kumaUserAgent,
    browserLabel: kuma.environment?.browserLabel ?? null,
    scenarios: collectComparison(kuma, playwright),
  };

  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
