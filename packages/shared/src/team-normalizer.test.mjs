import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeAllTeams } from "../team-normalizer.mjs";

const execFile = promisify(execFileCallback);
const TEAM_NORMALIZER_CLI_PATH = resolve(process.cwd(), "packages/shared/team-normalizer-cli.mjs");
const TEAM_CONFIG_SCRIPT_PATH = resolve(process.cwd(), "scripts/cmux/kuma-cmux-team-config.sh");

async function writeTeamConfig(root, value) {
  const teamPath = join(root, "team.json");
  await writeFile(teamPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return teamPath;
}

async function writeRegistry(root, value) {
  const registryPath = join(root, "surfaces.json");
  await writeFile(registryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return registryPath;
}

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function writeSessionPromptFixture(root) {
  const promptPath = join(root, "kuma-system-prompt.md");
  await writeFile(
    promptPath,
    "You are Kuma session prompt fixture.\nUse the shared session launch builder.\n",
    "utf8",
  );
  return promptPath;
}

async function runTeamConfigHelper(helperName, teamPath, args = [], extraEnv = {}) {
  const { stdout } = await execFile(
    "bash",
    ["-lc", 'source "$1"; shift; "$@"', "bash", TEAM_CONFIG_SCRIPT_PATH, helperName, ...args],
    {
      env: {
        ...process.env,
        KUMA_TEAM_JSON_PATH: teamPath,
        ...extraEnv,
      },
    },
  );

  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function runTeamConfigHelperRaw(helperName, teamPath, args = [], extraEnv = {}) {
  const { stdout } = await execFile(
    "bash",
    ["-lc", 'source "$1"; shift; "$@"', "bash", TEAM_CONFIG_SCRIPT_PATH, helperName, ...args],
    {
      env: {
        ...process.env,
        KUMA_TEAM_JSON_PATH: teamPath,
        ...extraEnv,
      },
    },
  );

  return stdout.trimEnd();
}

describe("shared team normalizer", () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("fills missing codex runtime settings with xhigh and fast", () => {
    const data = normalizeAllTeams({
      teams: {
        dev: {
          members: [
            {
              id: "tookdaki",
              name: "뚝딱이",
              spawnType: "codex",
              spawnOptions: "--dangerously-bypass-approvals-and-sandbox",
            },
          ],
        },
      },
    });

    expect(data.members).toHaveLength(1);
    expect(data.members[0].options).toContain('service_tier=fast');
    expect(data.members[0].options).toContain('model_reasoning_effort="xhigh"');
    expect(data.members[0].effort).toBe("xhigh");
    expect(data.members[0].serviceTier).toBe("fast");
  });

  it("filters deprecated alias teams from the active team list", () => {
    const data = normalizeAllTeams({
      teams: {
        system: {
          name: "시스템",
          members: [{ id: "kuma", name: "쿠마", team: "system" }],
        },
        "strategy-analytics": {
          name: "전략분석팀",
          leadId: "buri",
          members: [{ id: "buri", name: "부리", team: "strategy-analytics" }],
        },
        analytics: {
          name: "분석팀",
          deprecated: true,
          aliasFor: "strategy-analytics",
          members: [],
        },
        strategy: {
          name: "전략팀",
          deprecated: true,
          aliasFor: "strategy-analytics",
          members: [],
        },
      },
    });

    expect(data.teams.map((team) => team.id)).toEqual(["system", "strategy-analytics"]);
    expect(data.allTeams.map((team) => team.id)).toEqual(["system", "strategy-analytics", "analytics", "strategy"]);
  });

  it("normalizes implicit codex and claude members consistently", () => {
    const data = normalizeAllTeams({
      teams: {
        dev: {
          members: [
            { id: "lumi", name: "루미", spawnModel: "gpt-5.4-mini" },
            { id: "koon", name: "쿤" },
          ],
        },
      },
    });

    expect(data.members.map((member) => ({ id: member.id, engine: member.engine, model: member.model }))).toEqual([
      { id: "lumi", engine: "codex", model: "gpt-5.4-mini" },
      { id: "koon", engine: "claude", model: "claude-opus-4-6" },
    ]);
  });

  it("resolves member runtime settings from top-level modelCatalog references", () => {
    const data = normalizeAllTeams({
      modelCatalog: [
        {
          id: "gpt-5.4-mini-high-fast",
          type: "codex",
          model: "gpt-5.4-mini",
          label: "GPT-5.4 mini · high · fast",
          effort: "high",
          serviceTier: "fast",
        },
        {
          id: "claude-sonnet-4-6-high",
          type: "claude",
          model: "claude-sonnet-4-6",
          label: "Claude Sonnet 4.6 · high",
          options: "--dangerously-skip-permissions",
        },
      ],
      teams: {
        dev: {
          members: [
            {
              id: "lumi",
              name: "루미",
              modelCatalogId: "gpt-5.4-mini-high-fast",
              spawnType: "codex",
              spawnModel: "gpt-5.4",
              spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
            },
            {
              id: "koon",
              name: "쿤",
              modelCatalogId: "claude-sonnet-4-6-high",
            },
          ],
        },
      },
    });

    expect(data.modelCatalog.map((entry) => entry.id)).toEqual([
      "gpt-5.4-mini-high-fast",
      "claude-sonnet-4-6-high",
    ]);
    expect(data.members.map((member) => ({
      id: member.id,
      modelCatalogId: member.modelCatalogId,
      engine: member.engine,
      model: member.model,
      options: member.options,
      effort: member.effort,
      serviceTier: member.serviceTier,
    }))).toEqual([
      {
        id: "lumi",
        modelCatalogId: "gpt-5.4-mini-high-fast",
        engine: "codex",
        model: "gpt-5.4-mini",
        options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="high"',
        effort: "high",
        serviceTier: "fast",
      },
      {
        id: "koon",
        modelCatalogId: "claude-sonnet-4-6-high",
        engine: "claude",
        model: "claude-sonnet-4-6",
        options: "--dangerously-skip-permissions",
        effort: null,
        serviceTier: null,
      },
    ]);
  });

  it("CLI bridge normalize-file matches the direct JS normalizer", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const rawTeamConfig = {
      teams: {
        system: {
          name: "시스템",
          members: [{ id: "kuma", name: "쿠마", team: "system", defaultSurface: "surface:1" }],
        },
        dev: {
          name: "개발팀",
          members: [{ id: "tookdaki", name: "뚝딱이", team: "dev", spawnType: "codex" }],
        },
      },
    };
    const teamPath = await writeTeamConfig(root, rawTeamConfig);
    const direct = normalizeAllTeams(rawTeamConfig);
    const { stdout } = await execFile("node", [TEAM_NORMALIZER_CLI_PATH, "normalize-file", teamPath]);

    expect(JSON.parse(stdout)).toEqual(direct);
  });

  it("preserves member vaultDomains through the normalizer and CLI member query bridge", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const rawTeamConfig = {
      teams: {
        dev: {
          name: "개발팀",
          members: [
            {
              id: "tookdaki",
              name: "뚝딱이",
              team: "dev",
              spawnType: "codex",
              vaultDomains: ["analytics", " image-generation ", "", 42],
            },
          ],
        },
      },
    };
    const teamPath = await writeTeamConfig(root, rawTeamConfig);
    const direct = normalizeAllTeams(rawTeamConfig);

    expect(direct.members[0]?.vaultDomains).toEqual(["analytics", "image-generation"]);

    const { stdout } = await execFile("node", [TEAM_NORMALIZER_CLI_PATH, "resolve-member-query", teamPath, "뚝딱이"]);
    expect(JSON.parse(stdout)).toMatchObject({
      id: "tookdaki",
      vaultDomains: ["analytics", "image-generation"],
    });
  });

  it("lists bootstrap system members in configured surface order through the shell helper", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const teamPath = await writeTeamConfig(root, {
      teams: {
        system: {
          members: [
            { id: "noeuri", name: "노을이", team: "system", defaultSurface: "surface:46" },
            { id: "kuma", name: "쿠마", team: "system", defaultSurface: "surface:1" },
            { id: "jjooni", name: "쭈니", team: "system", defaultSurface: "surface:2" },
          ],
        },
        dev: {
          members: [
            { id: "howl", name: "하울", team: "dev" },
            { id: "tookdaki", name: "뚝딱이", team: "dev" },
          ],
        },
      },
    });

    const members = await runTeamConfigHelper("list_bootstrap_system_members", teamPath);
    expect(members).toEqual(["쿠마", "쭈니", "노을이"]);
  });

  it("keeps project spawn members scoped to non-system teams through the shell helper", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const teamPath = await writeTeamConfig(root, {
      teams: {
        system: {
          members: [
            { id: "kuma", name: "쿠마", team: "system", defaultSurface: "surface:1" },
            { id: "jjooni", name: "쭈니", team: "system", defaultSurface: "surface:2" },
          ],
        },
        dev: {
          members: [
            { id: "howl", name: "하울", team: "dev" },
            { id: "tookdaki", name: "뚝딱이", team: "dev" },
          ],
        },
      },
    });

    const members = await runTeamConfigHelper("list_project_spawn_members", teamPath);
    expect(members).toEqual(["하울", "뚝딱이"]);
  });

  it("lists active project teams in canonical order through the shell helper", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const teamPath = await writeTeamConfig(root, {
      teams: {
        system: {
          members: [{ id: "kuma", name: "쿠마", team: "system", defaultSurface: "surface:1" }],
        },
        dev: {
          members: [{ id: "howl", name: "하울", team: "dev" }],
        },
        "strategy-analytics": {
          members: [{ id: "buri", name: "부리", team: "strategy-analytics" }],
        },
        analytics: {
          deprecated: true,
          aliasFor: "strategy-analytics",
          members: [],
        },
      },
    });

    const teams = await runTeamConfigHelper("list_project_spawn_teams", teamPath);
    expect(teams).toEqual(["dev", "strategy-analytics"]);
  });

  it("filters team members by node type through the shell helper", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const teamPath = await writeTeamConfig(root, {
      teams: {
        dev: {
          members: [
            { id: "howl", name: "하울", team: "dev", nodeType: "team" },
            { id: "tookdaki", name: "뚝딱이", team: "dev", nodeType: "worker" },
            { id: "koon", name: "쿤", team: "dev", nodeType: "worker" },
          ],
        },
      },
    });

    await expect(runTeamConfigHelper("list_team_members", teamPath, ["dev", "team"])).resolves.toEqual(["하울"]);
    await expect(runTeamConfigHelper("list_team_members", teamPath, ["dev", "worker"])).resolves.toEqual(["뚝딱이", "쿤"]);
  });

  it("builds a Claude startup command that includes the member identity and waits idle", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const teamPath = await writeTeamConfig(root, {
      teams: {
        system: {
          members: [
            {
              id: "noeuri",
              name: "노을이",
              team: "system",
              spawnType: "claude",
              spawnModel: "claude-opus-4-6",
              spawnOptions: "--dangerously-skip-permissions",
              roleLabel: { ko: "퍼블리셔/디자이너", en: "Publisher / Designer. HTML/CSS/Graphics" },
              skills: ["frontend-design"],
            },
          ],
        },
      },
    });

    const startupPrompt = await runTeamConfigHelperRaw(
      "build_claude_startup_system_prompt",
      teamPath,
      ["노을이", "퍼블리셔/디자이너", "worker", "kuma-studio"],
    );
    const [command] = await runTeamConfigHelper("build_member_command", teamPath, ["노을이", "", "/tmp/work"]);
    const promptFile = command.match(/--append-system-prompt-file\s+(\S+)/u)?.[1] ?? "";
    const promptFileContents = await readFile(promptFile, "utf8");
    expect(command).toContain('claude --model claude-opus-4-6');
    expect(command).toContain("--append-system-prompt-file");
    expect(promptFile).toBeTruthy();
    expect(promptFileContents).toContain("너의 이름은 노을이야.");
    expect(promptFileContents).toContain("주 역할: 퍼블리셔/디자이너.");
    expect(promptFileContents).toContain("공유 프로젝트 정책은 repo 지시 파일에 있다");
    expect(promptFileContents).not.toContain("Decisions Boot Pack:");
    expect(promptFileContents).not.toContain("앞으로 branch/worktree 는 사용자 승인 후에만 만든다.");
    expect(promptFileContents).toContain("디스패치된 작업을 기다려");
    expect(promptFileContents).toContain("시작 문제가 없으면 응답하지 마.");
    expect(command).not.toContain("Decisions Boot Pack:");
    expect(startupPrompt).toContain("너의 이름은 노을이야.");
    expect(startupPrompt).toContain("주 역할: 퍼블리셔/디자이너.");
    expect(startupPrompt).toContain("공유 프로젝트 정책은 repo 지시 파일에 있다");
    expect(startupPrompt).not.toContain("Decisions Boot Pack:");
    expect(startupPrompt).not.toContain("앞으로 branch/worktree 는 사용자 승인 후에만 만든다.");
    expect(startupPrompt).not.toContain("이 결정사항을 시스템프롬프트에도 넣어.");
    expect(startupPrompt).toContain("디스패치된 작업을 기다려");
    expect(startupPrompt).not.toContain("Default to no legacy fallback paths.");
    expect(command).not.toContain('"/frontend-design"');
    expect(command).not.toContain('-- "/frontend-design"');
  });

  it("builds Kuma session commands from the shared session launch source", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);
    const sessionPromptPath = await writeSessionPromptFixture(root);
    const projectRoot = join(root, "kuma-studio");
    await mkdir(projectRoot, { recursive: true });

    const teamPath = await writeTeamConfig(root, {
      teams: {
        system: {
          members: [
            {
              id: "kuma",
              name: "쿠마",
              emoji: "🐻",
              team: "system",
              nodeType: "session",
              spawnType: "claude",
              spawnModel: "claude-opus-4-6",
              spawnOptions: "--dangerously-skip-permissions",
              roleLabel: { en: "Leader" },
            },
          ],
        },
      },
    });

    const startupBrief = await runTeamConfigHelperRaw("build_session_start_prompt", teamPath, ["쿠마"], {
      KUMA_SYSTEM_PROMPT_PATH: sessionPromptPath,
    });
    const [command] = await runTeamConfigHelper("build_member_command", teamPath, ["쿠마", "", projectRoot], {
      KUMA_SYSTEM_PROMPT_PATH: sessionPromptPath,
    });
    const promptFile = command.match(/--append-system-prompt-file\s+(\S+)/u)?.[1] ?? "";

    expect(command).toMatch(/^cd ".+" && exec claude --model claude-opus-4-6 /u);
    expect(command).toContain("--channels plugin:discord@claude-plugins-official");
    expect(command).toContain("--name '🐻 쿠마'");
    expect(command).not.toContain("KUMA_ROLE=worker");
    expect(command).toContain('$(cat ');
    expect(promptFile).toBeTruthy();
    expect(startupBrief).toContain("쿠마 모드로 부트스트랩 직후 첫 브리핑을 시작해줘.");
    expect(startupBrief).toContain("managed infra 상태");
    expect(startupBrief).toContain("`kuma-server`(port 4312, Studio UI 포함)");
    expect(startupBrief).toContain("bootstrap 직전에 이미 확보된 managed infra 정보를 그대로 요약한다.");
    expect(startupBrief).toContain("`kuma-server echo STATUS_CHECK` 같은 문자열을 composer에 남기지 않는다.");

    const startupPrompt = await readFile(promptFile, "utf8");
    expect(startupPrompt).toContain("You are Kuma session prompt fixture.");
    expect(startupPrompt).not.toContain("Decisions Boot Pack:");
    expect(startupPrompt).not.toContain("앞으로 branch/worktree 는 사용자 승인 후에만 만든다.");
    expect(startupPrompt).not.toContain("프로젝트 결정은 project-decisions에서 읽는다.");
    expect(startupPrompt).not.toContain("디스패치된 작업을 기다려");
    expect(startupPrompt).not.toContain("시작 문제가 없으면 응답하지 마.");
  });

  it("builds a Codex startup command with the member identity, idle guard, and without preferred skill injection", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const teamPath = await writeTeamConfig(root, {
      teams: {
        dev: {
          members: [
            {
              id: "bamdori",
              name: "밤토리",
              team: "dev",
              spawnType: "codex",
              spawnModel: "gpt-5.4-mini",
              spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
              roleLabel: { ko: "QA. 빌드, 배포, 화면 검증", en: "QA. Build, deploy, screen verification. No code edits" },
              skills: ["kuma-picker"],
            },
          ],
        },
      },
    });

    const developerInstructions = await runTeamConfigHelperRaw(
      "build_codex_developer_instructions",
      teamPath,
      ["밤토리", "QA. 빌드, 배포, 화면 검증", "worker", "kuma-studio"],
    );
    const [command] = await runTeamConfigHelper("build_member_command", teamPath, ["밤토리", "", "/tmp/work"]);
    expect(command).toContain('codex -m gpt-5.4-mini');
    expect(command).toContain("developer_instructions=");
    expect(developerInstructions).toContain("너의 이름은 밤토리야.");
    expect(developerInstructions).toContain("주 역할: QA. 빌드, 배포, 화면 검증.");
    expect(developerInstructions).toContain("공유 프로젝트 정책은 repo 지시 파일에 있다");
    expect(developerInstructions).not.toContain("Decisions Boot Pack:");
    expect(developerInstructions).not.toContain("앞으로 branch/worktree 는 사용자 승인 후에만 만든다.");
    expect(developerInstructions).not.toContain("이 결정사항을 시스템프롬프트에도 넣어.");
    expect(developerInstructions).toContain("디스패치된 작업을 기다려");
    expect(developerInstructions).not.toContain("Default to no legacy fallback paths.");
    expect(command).not.toContain("kuma-picker");
  });

  it("builds a team-node startup command with persistent dispatch policy in system instructions", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const teamPath = await writeTeamConfig(root, {
      teams: {
        dev: {
          members: [
            {
              id: "howl",
              name: "하울",
              team: "dev",
              nodeType: "team",
              spawnType: "codex",
              spawnModel: "gpt-5.4",
              spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
              roleLabel: { ko: "PM. 작업 분해, 디스패치, 결과 취합", en: "Operator. Task decomposition, dispatch, aggregation" },
            },
          ],
        },
      },
    });

    const developerInstructions = await runTeamConfigHelperRaw(
      "build_codex_developer_instructions",
      teamPath,
      ["하울", "PM. 작업 분해, 디스패치, 결과 취합", "team"],
    );
    const [command] = await runTeamConfigHelper("build_member_command", teamPath, ["하울", "", "/tmp/work"]);
    expect(command).toContain("developer_instructions=");
    expect(developerInstructions).toContain("너의 이름은 하울이야.");
    expect(developerInstructions).toContain("주 역할: PM. 작업 분해, 디스패치, 결과 취합.");
    expect(developerInstructions).toContain("공유 프로젝트 정책은 repo 지시 파일에 있다");
    expect(developerInstructions).toContain("직접 작업은 금지되어 있지 않다.");
    expect(developerInstructions).toContain("kuma-dispatch assign 으로 위임한다.");
    expect(developerInstructions).toContain("--qa <member> 는 외부 QA 리뷰어가 실제로 필요할 때만 붙인다.");
    expect(developerInstructions).not.toContain("Do not implement directly");
  });

  it("builds a Codex startup command that stays shell-parseable without decision boot caches", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const teamPath = await writeTeamConfig(root, {
      teams: {
        dev: {
          members: [
            {
              id: "howl",
              name: "하울",
              team: "dev",
              nodeType: "team",
              spawnType: "codex",
              spawnModel: "gpt-5.4",
              spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
              roleLabel: { ko: "PM. 작업 분해, 디스패치, 결과 취합", en: "Operator. Task decomposition, dispatch, aggregation" },
            },
          ],
        },
      },
    });

    const [command] = await runTeamConfigHelper("build_member_command", teamPath, ["하울", "", "/tmp/work"]);

    expect(command).not.toContain("직접 작업 막는 훅들");
    expect(command).not.toContain("Decisions Boot Pack:");

    const bashParse = spawnSync("bash", ["-n"], {
      encoding: "utf8",
      input: `${command}\n`,
    });
    expect(bashParse.status).toBe(0);
    expect(bashParse.stderr).toBe("");

    const zshParse = spawnSync("zsh", ["-n"], {
      encoding: "utf8",
      input: `${command}\n`,
    });
    expect(zshParse.status).toBe(0);
    expect(zshParse.stderr).toBe("");
  });

  it("resolves the current pane for a surface using pane surface listings", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const teamPath = await writeTeamConfig(root, { teams: {} });
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  list-panes)
    printf 'pane:42\\npane:99\\n'
    ;;
  list-pane-surfaces)
    pane=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --pane) pane="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    if [ "$pane" = "pane:42" ]; then
      printf 'surface:77\\n'
    elif [ "$pane" = "pane:99" ]; then
      printf 'surface:1\\n'
    fi
    ;;
  tree)
    printf 'workspace:7\\n  pane:42\\n    surface:77\\n  pane:99\\n    surface:1\\n'
    ;;
esac
`,
    );

    const { stdout } = await execFile(
      "bash",
      ["-c", 'source "$1"; shift; "$@"', "bash", TEAM_CONFIG_SCRIPT_PATH, "resolve_surface_pane", "surface:1", "workspace:7"],
      {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          KUMA_TEAM_JSON_PATH: teamPath,
        },
      },
    );

    expect(stdout.trim()).toBe("pane:99");
  });

  it("resolves a registered member surface through the shell helper", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-team-normalizer-"));
    tempRoots.push(root);

    const teamPath = await writeTeamConfig(root, {
      teams: {
        dev: {
          members: [
            { id: "howl", name: "하울", emoji: "🐺", team: "dev", nodeType: "team" },
            { id: "tookdaki", name: "뚝딱이", emoji: "🦫", team: "dev", nodeType: "worker" },
          ],
        },
      },
    });
    const registryPath = await writeRegistry(root, {
      smoke: {
        "🐺 하울": "surface:31",
        "🦫 뚝딱이": "surface:32",
      },
    });

    const surfaces = await runTeamConfigHelper(
      "resolve_registered_member_surface",
      teamPath,
      ["smoke", "하울"],
      { KUMA_SURFACES_PATH: registryPath },
    );
    expect(surfaces).toEqual(["surface:31"]);
  });
});
