#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const extensionRoot = path.join(repoRoot, "packages", "browser-extension");
const manifestPath = path.join(extensionRoot, "manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error(`Extension manifest not found at ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = typeof manifest.version === "string" && manifest.version.trim() ? manifest.version.trim() : "0.0.0";

const outputDir = path.join(repoRoot, "artifacts", "chrome-web-store", `v${version}`);
const zipPath = path.join(outputDir, `kuma-picker-extension-v${version}.zip`);
const stageParent = mkdtempSync(path.join(tmpdir(), "kuma-picker-extension-package-"));
const stageDir = path.join(stageParent, "extension");

mkdirSync(outputDir, { recursive: true });
mkdirSync(stageDir, { recursive: true });
rmSync(zipPath, { force: true });

cpSync(extensionRoot, stageDir, {
  recursive: true,
  filter(sourcePath) {
    const baseName = path.basename(sourcePath);
    if (baseName === ".DS_Store") {
      return false;
    }
    if (baseName.endsWith(".test.ts")) {
      return false;
    }
    return true;
  },
});

execFileSync("zip", ["-qr", zipPath, "."], {
  cwd: stageDir,
  stdio: "inherit",
});

rmSync(stageParent, { recursive: true, force: true });

process.stdout.write(`${zipPath}\n`);
