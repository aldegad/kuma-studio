import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, assert, describe, it } from "vitest";

import { TeamConfigStore } from "./team-config-store.mjs";

describe("team-config-store", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("seeds a default config with all members including 쿠마", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const store = new TeamConfigStore(configPath);
    const config = store.getConfig();
    const raw = JSON.parse(readFileSync(configPath, "utf8"));

    assert.strictEqual(config.members["쿠마"].id, "kuma");
    assert.strictEqual(config.members["쿠마"].type, "claude");
    assert.strictEqual(config.members["뚝딱이"].type, "codex");
    assert.match(config.members["뚝딱이"].options, /model_reasoning_effort="xhigh"/u);
    assert.strictEqual(config.members["밤토리"].model, "claude-sonnet-4-6");
    assert.strictEqual(config.defaults.codex.model, "gpt-5.4");
    assert.match(config.defaults.codex.options, /model_reasoning_effort="xhigh"/u);
    assert.strictEqual(raw.teams.system.members.find((member) => member.name === "쿠마")?.spawnType, "claude");
    assert.strictEqual(raw.teams.dev.members.find((member) => member.name === "뚝딱이")?.spawnType, "codex");
  });

  it("updates members by id and resets defaults when type changes", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const store = new TeamConfigStore(configPath);
    const updated = store.updateMember("kuma", { type: "codex" });
    const raw = JSON.parse(readFileSync(configPath, "utf8"));

    assert.ok(updated);
    assert.strictEqual(updated.key, "쿠마");
    assert.strictEqual(updated.member.type, "codex");
    assert.strictEqual(updated.member.model, "gpt-5.4");
    assert.match(updated.member.options, /dangerously-bypass-approvals-and-sandbox/u);
    assert.match(updated.member.options, /model_reasoning_effort="xhigh"/u);
    assert.strictEqual(raw.teams.system.members.find((member) => member.name === "쿠마")?.spawnType, "codex");
    assert.strictEqual(raw.teams.system.members.find((member) => member.name === "쿠마")?.spawnModel, "gpt-5.4");
  });

  it("normalizes team.json Codex reasoning options to xhigh", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    writeFileSync(
      configPath,
      `${JSON.stringify({
        teams: {
          dev: {
            name: "개발팀",
            members: [
              {
                id: "tookdaki",
                name: "뚝딱이",
                emoji: "🦫",
                role: "developer",
                team: "dev",
                nodeType: "worker",
                spawnType: "codex",
                spawnModel: "gpt-5.4",
                spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="max"',
              },
            ],
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const store = new TeamConfigStore(configPath);
    const config = store.getConfig();

    assert.match(config.members["뚝딱이"].options, /model_reasoning_effort="xhigh"/u);
    assert.ok(!/model_reasoning_effort="max"/u.test(config.members["뚝딱이"].options));
    assert.match(config.defaults.codex.options, /model_reasoning_effort="xhigh"/u);
  });
});
