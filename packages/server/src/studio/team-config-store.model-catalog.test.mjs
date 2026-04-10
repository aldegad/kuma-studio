import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, assert, describe, it } from "vitest";

import { MODEL_CATALOG, getModelCatalogEntry } from "../../../shared/model-catalog.mjs";
import { TeamConfigStore, resolveModelCatalogEntry } from "./team-config-store.mjs";

describe("team-config-store model catalog", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("exposes the six shared catalog entries and direct id lookup", () => {
    assert.strictEqual(MODEL_CATALOG.length, 6);

    const entry = getModelCatalogEntry("gpt-5.4-mini-xhigh-fast");
    assert.ok(entry);
    assert.strictEqual(entry.type, "codex");
    assert.strictEqual(entry.model, "gpt-5.4-mini");
    assert.strictEqual(entry.effort, "xhigh");
    assert.strictEqual(entry.serviceTier, "fast");
  });

  it("resolves catalog ids to raw model and codex runtime options", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-catalog-"));
    tempDirs.push(root);

    const configPath = join(root, "team.json");
    const store = new TeamConfigStore(configPath);
    const updated = store.updateMember("kuma", {
      type: "codex",
      model: "gpt-5.4-mini-xhigh-fast",
    });

    assert.ok(updated);
    assert.strictEqual(updated.member.model, "gpt-5.4-mini");
    assert.strictEqual(updated.member.modelCatalogId, "gpt-5.4-mini-xhigh-fast");
    assert.match(updated.member.options, /model_reasoning_effort="xhigh"/u);
    assert.match(updated.member.options, /service_tier=fast/u);

    const resolved = resolveModelCatalogEntry("codex", "gpt-5.4-mini-xhigh-fast");
    assert.strictEqual(resolved?.model, "gpt-5.4-mini");
    assert.strictEqual(resolved?.effort, "xhigh");
    assert.strictEqual(resolved?.serviceTier, "fast");

    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    const kuma = raw.teams.system.members.find((member) => member.id === "kuma");
    assert.strictEqual(kuma.spawnModel, "gpt-5.4-mini");
    assert.match(kuma.spawnOptions, /model_reasoning_effort="xhigh"/u);
    assert.match(kuma.spawnOptions, /service_tier=fast/u);
  });

  it("silently normalizes bare team.json model ids to the canonical catalog entry", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-catalog-"));
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
                spawnModel: "gpt-5.4-mini",
              },
            ],
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const store = new TeamConfigStore(configPath);
    const config = store.getConfig();

    assert.strictEqual(config.modelCatalog.length, 6);
    assert.strictEqual(config.members["뚝딱이"].model, "gpt-5.4-mini");
    assert.strictEqual(config.members["뚝딱이"].modelCatalogId, "gpt-5.4-mini-xhigh-fast");
    assert.match(config.members["뚝딱이"].options, /model_reasoning_effort="xhigh"/u);
    assert.match(config.members["뚝딱이"].options, /service_tier=fast/u);
  });
});
