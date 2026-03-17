import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/install-codex-skill.mjs");

describe("install-codex-skill", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs the skill and browser extension into CODEX_HOME", () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "agent-picker-codex-home-"));
    tempDirs.push(codexHome);

    const output = execFileSync(process.execPath, [SCRIPT_PATH], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_HOME: codexHome },
      encoding: "utf8",
    });

    const skillPath = path.join(codexHome, "skills", "agent-picker", "SKILL.md");
    const extensionPath = path.join(codexHome, "extensions", "agent-picker-browser-extension", "manifest.json");

    expect(output).toContain("Installed agent-picker skill");
    expect(output).toContain("Installed browser extension");
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(extensionPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(extensionPath, "utf8")) as { manifest_version: number; name: string };
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toContain("Agent Picker");
  });
});
