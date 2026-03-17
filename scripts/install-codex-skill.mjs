import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const skillName = "agent-picker";
const sourceDir = path.join(repoRoot, "skills", skillName);
const extensionSourceDir = path.join(repoRoot, "packages", "browser-extension");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const targetDir = path.join(codexHome, "skills", skillName);
const extensionTargetDir = path.join(codexHome, "extensions", "agent-picker-browser-extension");

function installDirectory(sourcePath, targetPath, label) {
  if (!fs.existsSync(sourcePath)) {
    console.error(`${label} source not found: ${sourcePath}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

installDirectory(sourceDir, targetDir, "Skill");
installDirectory(extensionSourceDir, extensionTargetDir, "Browser extension");

console.log(`Installed ${skillName} skill to ${targetDir}`);
console.log(`Installed browser extension to ${extensionTargetDir}`);
