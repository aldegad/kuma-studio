import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("noeuri skill protections", () => {
  it("marks user-memo as read-only and forbids destructive edits", async () => {
    const skillPath = resolve(process.cwd(), "skills/noeuri/SKILL.md");
    const skill = await readFile(skillPath, "utf8");

    expect(skill).toContain("KUMA_USER_MEMO_DIR");
    expect(skill).toContain("read-only");
    expect(skill).toContain("MEMORY.md");
    expect(skill).toContain("write`, `rewrite`, `move`, `rename`, `delete`");
    expect(skill).toContain("과거 migration brief");
    expect(skill).toContain("dispatch-status --task-file");
    expect(skill).toContain("broker record");
    expect(skill).toContain("dispatch-log.md");
  });
});
