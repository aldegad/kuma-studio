import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TEAM_NORMALIZER_CLI_PATH = fileURLToPath(
  new URL("../../../shared/team-normalizer-cli.mjs", import.meta.url),
);
const DEFAULT_TEAM_CONFIG_SCRIPT_PATH = fileURLToPath(
  new URL("../../../../scripts/cmux/kuma-cmux-team-config.sh", import.meta.url),
);

function normalizeProjectName(requestedProject, workspaceRoot) {
  const normalizedRequestedProject = typeof requestedProject === "string" ? requestedProject.trim() : "";
  if (normalizedRequestedProject && normalizedRequestedProject !== "system") {
    return normalizedRequestedProject;
  }

  const normalizedWorkspaceRoot = typeof workspaceRoot === "string" && workspaceRoot.trim()
    ? resolve(workspaceRoot)
    : process.cwd();
  return basename(normalizedWorkspaceRoot);
}

function resolveLaunchRecord({
  memberName,
  teamConfigPath,
  teamNormalizerCliPath = DEFAULT_TEAM_NORMALIZER_CLI_PATH,
}) {
  const result = spawnSync(
    "node",
    [teamNormalizerCliPath, "resolve-launch-record", teamConfigPath, memberName, ""],
    {
      encoding: "utf8",
      env: {
        ...process.env,
      },
    },
  );

  if ((result.status ?? 0) !== 0) {
    const details = String(result.stderr ?? result.stdout ?? "").trim() || "failed to resolve launch record";
    throw new Error(details);
  }

  const rawRecord = String(result.stdout ?? "").trimEnd();
  const [
    displayName = "",
    type = "",
    model = "",
    options = "",
    emoji = "",
    _skill = "",
    roleLabelEn = "",
    nodeType = "worker",
  ] = rawRecord.split("\x1f");

  return {
    displayName,
    type,
    model,
    options,
    emoji,
    roleLabelEn,
    nodeType,
  };
}

function selectPromptBuilder(type, nodeType) {
  if (nodeType === "session") {
    return "build_session_system_prompt";
  }

  return type === "codex"
    ? "build_codex_developer_instructions"
    : "build_claude_startup_system_prompt";
}

export function renderTeamMemberPrompt({
  memberName,
  requestedProject = "",
  workspaceRoot,
  teamConfigPath,
  repoRoot,
  vaultDir,
  systemPromptPath,
  teamNormalizerCliPath = DEFAULT_TEAM_NORMALIZER_CLI_PATH,
  teamConfigScriptPath = DEFAULT_TEAM_CONFIG_SCRIPT_PATH,
}) {
  const launchRecord = resolveLaunchRecord({
    memberName,
    teamConfigPath,
    teamNormalizerCliPath,
  });
  const projectName = normalizeProjectName(requestedProject, workspaceRoot);
  const builder = selectPromptBuilder(launchRecord.type, launchRecord.nodeType);
  const result = spawnSync(
    "bash",
    [
      "-lc",
      'source "$KUMA_TEAM_CONFIG_SCRIPT_PATH" && "$KUMA_PROMPT_BUILDER" "$KUMA_PROMPT_MEMBER_NAME" "$KUMA_PROMPT_ROLE_LABEL_EN" "$KUMA_PROMPT_NODE_TYPE" "$KUMA_PROMPT_PROJECT_NAME"',
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        KUMA_PROMPT_BUILDER: builder,
        KUMA_PROMPT_MEMBER_NAME: memberName,
        KUMA_PROMPT_ROLE_LABEL_EN: launchRecord.roleLabelEn,
        KUMA_PROMPT_NODE_TYPE: launchRecord.nodeType,
        KUMA_PROMPT_PROJECT_NAME: projectName,
        KUMA_TEAM_CONFIG_SCRIPT_PATH: teamConfigScriptPath,
        ...(teamConfigPath ? { KUMA_TEAM_JSON_PATH: teamConfigPath } : {}),
        ...(repoRoot ? { KUMA_REPO_ROOT: repoRoot } : {}),
        ...(vaultDir ? { KUMA_VAULT_DIR: vaultDir } : {}),
        ...(systemPromptPath ? { KUMA_SYSTEM_PROMPT_PATH: systemPromptPath } : {}),
      },
    },
  );

  if ((result.status ?? 0) !== 0) {
    const details = String(result.stderr ?? result.stdout ?? "").trim() || "failed to render prompt";
    throw new Error(details);
  }

  const prompt = String(result.stdout ?? "");

  return {
    prompt,
    projectName,
    builder,
    memberName,
    ...launchRecord,
  };
}
