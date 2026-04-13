#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${KUMA_REPO_ROOT:-/Users/soohongkim/Documents/workspace/personal/kuma-studio}"

# Kuma 모드가 아니면 아무 일도 하지 않는다.
if [ ! -f /tmp/kuma-mode.lock ]; then
  exit 0
fi

# 워커 세션은 캡처 대상이 아니다.
if [ "${KUMA_ROLE:-}" = "worker" ]; then
  exit 0
fi

HOOK_INPUT="$(cat)"

KUMA_REPO_ROOT="$REPO_ROOT" \
KUMA_VAULT_DIR="${KUMA_VAULT_DIR:-$HOME/.kuma/vault}" \
KUMA_HOOK_INPUT="$HOOK_INPUT" \
node --input-type=module <<'NODE'
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

try {
  function readHookInput() {
    try {
      return JSON.parse(process.env.KUMA_HOOK_INPUT || "{}");
    } catch {
      return null;
    }
  }

  const input = readHookInput();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    process.exit(0);
  }

  const prompt = typeof input.user_prompt === "string" ? input.user_prompt.trim() : "";
  if (!prompt) {
    process.exit(0);
  }

  const repoRoot = resolve(process.env.KUMA_REPO_ROOT || "/Users/soohongkim/Documents/workspace/personal/kuma-studio");
  const projectDirSource = typeof input.cwd === "string" && input.cwd
    ? input.cwd
    : typeof process.env.CLAUDE_PROJECT_DIR === "string" && process.env.CLAUDE_PROJECT_DIR
      ? process.env.CLAUDE_PROJECT_DIR
      : "";
  if (!projectDirSource) {
    process.exit(0);
  }

  const projectDir = resolve(projectDirSource);
  const relativeToRepo = relative(repoRoot, projectDir);
  const insideRepo =
    relativeToRepo === "" ||
    (!relativeToRepo.startsWith("..") && !relativeToRepo.startsWith("/"));

  if (!insideRepo) {
    process.exit(0);
  }

  const vaultDir = process.env.KUMA_VAULT_DIR || join(homedir(), ".kuma", "vault");
  const storeModule = await import(pathToFileURL(join(repoRoot, "packages/server/src/studio/decisions-store.mjs")).href);
  const detectorModule = await import(pathToFileURL(join(repoRoot, "packages/server/src/studio/decision-detector.mjs")).href);
  const scopeModule = await import(pathToFileURL(join(repoRoot, "packages/server/src/studio/decision-scope.mjs")).href);

  if (
    typeof storeModule?.appendDecision !== "function" ||
    typeof detectorModule?.detectDecision !== "function" ||
    typeof scopeModule?.resolveDecisionCaptureScope !== "function"
  ) {
    process.exit(0);
  }

  const detected = detectorModule.detectDecision({ text: prompt });
  if (!detected) {
    process.exit(0);
  }

  const scope = scopeModule.resolveDecisionCaptureScope({
    text: detected.original_text,
    projectName: basename(repoRoot),
  });
  const contextRef = typeof input.session_id === "string" && input.session_id.trim()
    ? `session:${input.session_id.trim()}`
    : "";

  await storeModule.appendDecision({
    vaultDir,
    layer: "inbox",
    entry: {
      action: detected.action,
      scope,
      writer: "kuma-detect",
      originalText: detected.original_text,
      ...(contextRef ? { contextRef } : {}),
      createdAt: new Date().toISOString(),
    },
  });
} catch (error) {
  if (error instanceof Error && error.message) {
    console.error(`[kuma-user-prompt-capture] ${error.message}`);
  }
  process.exit(0);
}
NODE
