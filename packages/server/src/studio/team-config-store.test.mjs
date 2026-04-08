import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

    const store = new TeamConfigStore(join(root, "team-config.json"));
    const config = store.getConfig();

    assert.strictEqual(config.members["쿠마"].id, "kuma");
    assert.strictEqual(config.members["쿠마"].type, "claude");
    assert.strictEqual(config.members["뚝딱이"].type, "codex");
    assert.match(config.members["뚝딱이"].options, /model_reasoning_effort="xhigh"/u);
    assert.strictEqual(config.members["밤토리"].model, "claude-sonnet-4-6");
    assert.strictEqual(config.defaults.codex.model, "gpt-5.4");
    assert.match(config.defaults.codex.options, /model_reasoning_effort="xhigh"/u);
  });

  it("updates members by id and resets defaults when type changes", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-"));
    tempDirs.push(root);

    const store = new TeamConfigStore(join(root, "team-config.json"));
    const updated = store.updateMember("kuma", { type: "codex" });

    assert.ok(updated);
    assert.strictEqual(updated.key, "쿠마");
    assert.strictEqual(updated.member.type, "codex");
    assert.strictEqual(updated.member.model, "gpt-5.4");
    assert.match(updated.member.options, /dangerously-bypass-approvals-and-sandbox/u);
    assert.match(updated.member.options, /model_reasoning_effort="xhigh"/u);
  });

  it("normalizes legacy Codex reasoning options to xhigh", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-team-config-"));
    tempDirs.push(root);

    const configPath = join(root, "team-config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify({
        members: {
          뚝딱이: {
            id: "tookdaki",
            emoji: "🦫",
            role: "구현",
            team: "dev",
            nodeType: "worker",
            type: "codex",
            model: "gpt-5.4",
            options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="max"',
          },
        },
        defaults: {
          claude: { model: "claude-opus-4-6", options: "--dangerously-skip-permissions" },
          codex: {
            model: "gpt-5.4",
            options: '--dangerously-bypass-approvals-and-sandbox -c service_tier=fast -c model_reasoning_effort="high"',
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
