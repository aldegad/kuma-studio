import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DEFAULT_AUTO_INGEST_STAMP_DIR, DEFAULT_DISPATCH_TASK_DIR } from "../kuma-paths.mjs";
import { findMatchingTaskMetadata, ingestResultFile } from "./vault-ingest.mjs";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildStampKey(resultPath, mtimeMs) {
  return createHash("sha1")
    .update(`${resolve(resultPath)}:${Math.trunc(mtimeMs)}`)
    .digest("hex");
}

export async function maybeAutoIngestResult({
  resultPath,
  signal = null,
  taskDir = DEFAULT_TASK_DIR,
  stampDir = DEFAULT_STAMP_DIR,
  vaultDir,
  wikiDir,
  dryRun = false,
} = {}) {
  const requestedResultPath = normalizeString(resultPath);
  if (!requestedResultPath) {
    return { status: "skipped", reason: "missing-result-path" };
  }

  const absoluteResultPath = resolve(requestedResultPath);
  if (!existsSync(absoluteResultPath)) {
    return { status: "skipped", reason: "missing-result-file", resultPath: absoluteResultPath };
  }

  const taskMetadata = await findMatchingTaskMetadata(absoluteResultPath, taskDir);
  if (!taskMetadata) {
    return { status: "skipped", reason: "missing-task-metadata", resultPath: absoluteResultPath };
  }

  const qaSurface = normalizeString(taskMetadata.qa);
  if (!qaSurface) {
    return {
      status: "skipped",
      reason: "task-has-no-qa",
      resultPath: absoluteResultPath,
      taskId: normalizeString(taskMetadata.id),
    };
  }

  const expectedSignal = normalizeString(taskMetadata.signal);
  const receivedSignal = normalizeString(signal);
  if (receivedSignal && expectedSignal && receivedSignal !== expectedSignal) {
    return {
      status: "skipped",
      reason: "signal-mismatch",
      resultPath: absoluteResultPath,
      taskId: normalizeString(taskMetadata.id),
      expectedSignal,
      receivedSignal,
    };
  }

  const resultStat = await stat(absoluteResultPath);
  const resolvedStampDir = resolve(stampDir);
  const stampPath = join(
    resolvedStampDir,
    `${buildStampKey(absoluteResultPath, resultStat.mtimeMs)}.json`,
  );

  if (existsSync(stampPath)) {
    return {
      status: "skipped",
      reason: "already-ingested",
      resultPath: absoluteResultPath,
      taskId: normalizeString(taskMetadata.id),
      stampPath,
    };
  }

  const ingest = await ingestResultFile({
    resultPath: absoluteResultPath,
    vaultDir,
    wikiDir,
    taskDir,
    qaStatus: "passed",
    dryRun,
  });

  if (!dryRun) {
    await mkdir(resolvedStampDir, { recursive: true });
    await writeFile(
      stampPath,
      `${JSON.stringify(
        {
          status: "ingested",
          signal: receivedSignal || expectedSignal || null,
          resultPath: absoluteResultPath,
          taskId: normalizeString(taskMetadata.id) || ingest.taskId || null,
          ingestedAt: new Date().toISOString(),
          ingest,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  return {
    status: "ingested",
    reason: null,
    resultPath: absoluteResultPath,
    taskId: normalizeString(taskMetadata.id) || ingest.taskId || null,
    stampPath,
    ingest,
  };
}
