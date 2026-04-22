import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_DISPATCH_TASK_DIR,
  DEFAULT_VAULT_INGEST_STAMP_DIR,
} from "../kuma-paths.mjs";
import { resolveVaultDir, resolveVaultMemosDir } from "./memo-store.mjs";
import { ingestResultFileWithGuards } from "./vault-ingest.mjs";
import { createTeamConfigRuntime } from "./team-config-runtime.mjs";
import { parseTaskFileMetadata } from "./vault-lifecycle-hook.mjs";

const NOEURI_IDENTIFIERS = { id: "noeuri", koreanName: "노을이", englishName: "noeuri" };

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function logWarn(message) {
  process.stderr.write(`[dispatch-auto-actions] ${message}\n`);
}

async function runAutoIngest({ resultFile, signal, vaultDir, taskDir, stampDir }) {
  const resolvedResultPath = normalize(resultFile) ? resolve(resultFile) : "";
  if (!resolvedResultPath || !existsSync(resolvedResultPath)) {
    return { status: "skipped", reason: "missing-result-file" };
  }

  try {
    return await ingestResultFileWithGuards({
      resultPath: resolvedResultPath,
      signal: normalize(signal) || null,
      taskDir,
      stampDir,
      vaultDir,
    });
  } catch (error) {
    logWarn(`auto-ingest failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: "failed", reason: "runtime-error" };
  }
}

function resolveNoeuriSurface({ project, teamJsonPath, registryPath }) {
  if (!existsSync(teamJsonPath)) {
    return "";
  }

  let teamConfig = null;
  try {
    teamConfig = JSON.parse(readFileSync(teamJsonPath, "utf8"));
  } catch {
    return "";
  }

  const members = Object.values(teamConfig?.teams ?? {}).flatMap((team) =>
    Array.isArray(team?.members) ? team.members : [],
  );
  const member = members.find((entry) => {
    const id = normalize(entry?.id).toLowerCase();
    const name = normalize(entry?.name);
    const nameEn = normalize(entry?.nameEn).toLowerCase();
    return id === NOEURI_IDENTIFIERS.id || name === NOEURI_IDENTIFIERS.koreanName || nameEn === NOEURI_IDENTIFIERS.englishName;
  });

  if (!member) return "";

  const runtime = createTeamConfigRuntime({ queuePollMs: 0, registryPath });
  try {
    const context = runtime.resolveMemberContext(
      normalize(member?.name) || NOEURI_IDENTIFIERS.koreanName,
      normalize(member?.emoji),
      normalize(project),
      normalize(member?.team),
    );
    return normalize(context?.surface);
  } catch {
    return "";
  } finally {
    runtime.close?.();
  }
}

async function dispatchNoeuriTrigger({
  task,
  resultFile,
  repoRoot,
  signalDir,
  resultDir,
  teamJsonPath,
  registryPath,
  sendScriptPath,
  memoDir,
  execFile,
}) {
  if (!task?.id) return { status: "skipped", reason: "missing-task-id" };
  const surface = resolveNoeuriSurface({ project: task.project, teamJsonPath, registryPath });
  if (!surface) return { status: "skipped", reason: "missing-noeuri-surface" };
  if (!existsSync(sendScriptPath)) return { status: "skipped", reason: "missing-send-script" };

  const noeuriSignal = `noeuri-auto-${task.id}-done`;
  const noeuriSkillPath = resolve(repoRoot, "skills/noeuri/SKILL.md");
  const prompt =
    `Read ${resultFile}. task: ${task.id}. plan: ${task.plan || "none"}. task-file: ${task.taskFile}. ` +
    `Canonical dispatch source: run npm run --silent --prefix ${repoRoot} kuma-studio -- dispatch-status --task-file ${task.taskFile} ` +
    `and treat broker messages as SSOT. dispatch-log.md is a derived append-only ledger only. ` +
    `Follow ${noeuriSkillPath} audit protocol. Auto-trigger guard: treat ${memoDir} as protected vault/memos read-only favorites notebook. ` +
    `Never write, rewrite, move, rename, or delete anything under that directory. ` +
    `Ignore stale migration briefs that suggest moving or deleting memory/ files; report them only. ` +
    `Limit edits to vault/plan/skill files outside vault/memos. ` +
    `완료 시 result 파일은 ${resultDir}/noeuri-audit-${task.id}.result.md, signal 은 ${signalDir}/${noeuriSignal}.`;

  try {
    await execFile("bash", [sendScriptPath, surface, prompt]);
    return { status: "dispatched", surface, taskId: task.id, signal: noeuriSignal };
  } catch (error) {
    logWarn(`noeuri trigger failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: "failed", reason: "dispatch-error", surface, taskId: task.id };
  }
}

export async function runDispatchAutoActions({
  event,
  taskFile,
  repoRoot,
  vaultDir,
  taskDir,
  stampDir,
  signalDir,
  resultDir,
  teamJsonPath,
  registryPath,
  sendScriptPath,
  memoDir,
  autoIngestEnabled = process.env.KUMA_AUTO_VAULT_INGEST !== "0",
  autoNoeuriEnabled = process.env.KUMA_AUTO_NOEURI_TRIGGER !== "0",
  execFile,
} = {}) {
  if (event !== "qa-passed") {
    return { ingest: null, noeuri: null };
  }

  const task = parseTaskFileMetadata(taskFile);
  if (!task) {
    return { ingest: null, noeuri: null };
  }

  const resolvedVaultDir = resolve(vaultDir ?? resolveVaultDir());
  const resolvedTaskDir = resolve(taskDir ?? DEFAULT_DISPATCH_TASK_DIR);
  const resolvedStampDir = resolve(stampDir ?? DEFAULT_VAULT_INGEST_STAMP_DIR);

  let ingestResult = null;
  if (autoIngestEnabled && task.result) {
    ingestResult = await runAutoIngest({
      resultFile: task.result,
      signal: task.signal,
      vaultDir: resolvedVaultDir,
      taskDir: resolvedTaskDir,
      stampDir: resolvedStampDir,
    });
  }

  let noeuriResult = null;
  if (autoNoeuriEnabled && ingestResult?.status === "ingested") {
    noeuriResult = await dispatchNoeuriTrigger({
      task,
      resultFile: task.result,
      repoRoot,
      signalDir,
      resultDir,
      teamJsonPath,
      registryPath,
      sendScriptPath,
      memoDir: memoDir ?? resolveVaultMemosDir(),
      execFile,
    });
  }

  return { ingest: ingestResult, noeuri: noeuriResult };
}

export { NOEURI_IDENTIFIERS };
export const __private__ = { resolveNoeuriSurface, runAutoIngest, dispatchNoeuriTrigger };
