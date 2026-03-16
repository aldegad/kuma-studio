import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const skillName = "agent-picker";
const sourceDir = path.join(repoRoot, "skills", skillName);
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const targetDir = path.join(codexHome, "skills", skillName);

if (!fs.existsSync(sourceDir)) {
  console.error(`Skill source not found: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(targetDir), { recursive: true });
fs.rmSync(targetDir, { recursive: true, force: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });

console.log(`Installed ${skillName} skill to ${targetDir}`);
