import { assert, describe, it } from "vitest";

import { extractStudioSkillDescription } from "./studio-skill-catalog.mjs";

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
});
