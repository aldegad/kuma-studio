import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
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

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function runTeamConfigHelper(helperName, teamPath) {
  const { stdout } = await execFile(
    "bash",
    ["-lc", 'source "$1"; "$2"', "bash", TEAM_CONFIG_SCRIPT_PATH, helperName],
    {
      env: {
        ...process.env,
        KUMA_TEAM_JSON_PATH: teamPath,
      },
    },
  );

  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
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
});
