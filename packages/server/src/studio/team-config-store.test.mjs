import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, assert, describe, it } from "vitest";

import { TeamConfigStore, diffTeamConfig, watchTeamConfig } from "./team-config-store.mjs";

async function waitFor(assertion, timeoutMs = 4_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) {
      return;
    }
    await delay(50);
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

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
    assert.match(config.members["노을이"].options, /model_reasoning_effort="high"/u);
    assert.strictEqual(config.members["밤토리"].model, "gpt-5.4-mini");
    assert.strictEqual(config.defaults.codex.model, "gpt-5.4");
    assert.match(config.defaults.codex.options, /model_reasoning_effort="xhigh"/u);
    assert.strictEqual(config.modelCatalog.length, 7);
    assert.strictEqual(config.members["쿠마"].modelCatalogId, "claude-opus-4-6-high");
    assert.strictEqual(raw.modelCatalog.length, 7);
    assert.strictEqual(raw.teams.system.members.find((member) => member.name === "쿠마")?.modelCatalogId, "claude-opus-4-6-high");
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

  it("diffTeamConfig separates added removed and updated members by id", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const store = new TeamConfigStore(configPath);
    const previousSchema = store.readTeamSchema();
    const nextSchema = JSON.parse(JSON.stringify(previousSchema));

    const devMembers = nextSchema.teams.dev.members;
    const removedMemberIndex = devMembers.findIndex((member) => member.id === "darami");
    devMembers.splice(removedMemberIndex, 1);

    const howlMember = devMembers.find((member) => member.id === "howl");
    howlMember.spawnModel = "gpt-5.4-mini";

    devMembers.push({
      id: "newbie",
      name: "뉴비",
      emoji: "🫐",
      role: "developer",
      team: "dev",
      nodeType: "worker",
      spawnType: "codex",
      spawnModel: "gpt-5.4-mini",
      spawnOptions: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="xhigh"',
    });

    const diff = diffTeamConfig(previousSchema, nextSchema);

    assert.deepStrictEqual(diff.added, ["newbie"]);
    assert.deepStrictEqual(diff.removed, ["darami"]);
    assert.deepStrictEqual(diff.updated, ["howl"]);
  });

  it("diffTeamConfig treats modelCatalogId-only changes as member updates", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const store = new TeamConfigStore(configPath);
    const previousSchema = store.readTeamSchema();
    const nextSchema = JSON.parse(JSON.stringify(previousSchema));

    nextSchema.teams.system.members.find((member) => member.id === "kuma").modelCatalogId = "claude-opus-4-6-max";

    const diff = diffTeamConfig(previousSchema, nextSchema);
    assert.deepStrictEqual(diff.added, []);
    assert.deepStrictEqual(diff.removed, []);
    assert.deepStrictEqual(diff.updated, ["kuma"]);
  });

  it("watchTeamConfig emits changed ids and snapshots after file updates", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const store = new TeamConfigStore(configPath);
    const nextSchema = store.readTeamSchema();
    nextSchema.teams.system.members.find((member) => member.id === "kuma").spawnModel = "claude-sonnet-4-6";

    let payload = null;
    const watcher = watchTeamConfig({
      configPath,
      debounceMs: 150,
      onChange(change) {
        payload = change;
      },
    });

    try {
      await delay(50);
      writeFileSync(configPath, `${JSON.stringify(nextSchema, null, 2)}\n`, "utf8");

      await waitFor(() => payload !== null);

      assert.deepStrictEqual(payload.changedIds, ["kuma"]);
      assert.deepStrictEqual(payload.diff.updated, ["kuma"]);
      assert.strictEqual(payload.previousMembers.kuma.spawnModel, "claude-opus-4-6");
      assert.strictEqual(payload.currentMembers.kuma.spawnModel, "claude-sonnet-4-6");
    } finally {
      watcher.close();
    }
  });

  it("watchTeamConfig debounces rapid changes into a single callback", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const store = new TeamConfigStore(configPath);
    const schemaA = store.readTeamSchema();
    const schemaB = JSON.parse(JSON.stringify(schemaA));
    schemaA.teams.dev.members.find((member) => member.id === "howl").spawnOptions = '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="high"';
    schemaB.teams.dev.members.find((member) => member.id === "howl").spawnOptions = '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="medium"';

    let changeCount = 0;
    let latestPayload = null;
    const watcher = watchTeamConfig({
      configPath,
      debounceMs: 200,
      onChange(change) {
        changeCount += 1;
        latestPayload = change;
      },
    });

    try {
      writeFileSync(configPath, `${JSON.stringify(schemaA, null, 2)}\n`, "utf8");
      await delay(100);
      writeFileSync(configPath, `${JSON.stringify(schemaB, null, 2)}\n`, "utf8");

      await waitFor(() => changeCount === 1);
      await delay(300);

      assert.strictEqual(changeCount, 1);
      assert.deepStrictEqual(latestPayload.diff.updated, ["howl"]);
      assert.match(latestPayload.currentMembers.howl.spawnOptions, /model_reasoning_effort="medium"/u);
    } finally {
      watcher.close();
    }
  });
});
