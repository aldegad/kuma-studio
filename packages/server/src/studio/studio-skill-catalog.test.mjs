import { assert, describe, it } from "vitest";

import {
  extractStudioSkillDescription,
  filterClaudePluginKeys,
  parseCodexEnabledPluginKeys,
} from "./studio-skill-catalog.mjs";

describe("studio-skill-catalog", () => {
  it("prefers frontmatter description when present", () => {
    const content = `---
title: Test Skill
description: Canonical description from frontmatter.
---

# Test Skill

Fallback body sentence.
`;

    assert.strictEqual(
      extractStudioSkillDescription(content),
      "Canonical description from frontmatter.",
    );
  });

  it("falls back to the first body sentence after the heading", () => {
    const content = `# Test Skill

First sentence wins. Second sentence should not.

## Usage

More details.
`;

    assert.strictEqual(
      extractStudioSkillDescription(content),
      "First sentence wins.",
    );
  });

  it("keeps Claude user-skills out of the plugin list", () => {
    assert.deepStrictEqual(
      filterClaudePluginKeys([
        "discord@claude-plugins-official",
        "kuma-vault@user-skills",
        "[object Object]@user-skills",
        "kuma-picker",
      ], new Set(["kuma-picker"])),
      ["discord@claude-plugins-official"],
    );
  });

  it("parses enabled Codex plugins from config.toml", () => {
    const config = `
[plugins."github@openai-curated"]
enabled = true

[plugins."disabled@openai-curated"]
enabled = false

[plugins."browser-use@openai-bundled"]
enabled = true
`;

    assert.deepStrictEqual(
      parseCodexEnabledPluginKeys(config),
      ["github@openai-curated", "browser-use@openai-bundled"],
    );
  });
});
