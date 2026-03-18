import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const extensionSourceDir = path.join(repoRoot, "packages", "browser-extension");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const extensionTargetDir = path.join(codexHome, "extensions", "agent-picker-browser-extension");

if (!fs.existsSync(extensionSourceDir)) {
  console.error(`Browser extension source not found: ${extensionSourceDir}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(extensionTargetDir), { recursive: true });
fs.rmSync(extensionTargetDir, { recursive: true, force: true });
fs.cpSync(extensionSourceDir, extensionTargetDir, { recursive: true });

console.log(`Installed browser extension to ${extensionTargetDir}`);
console.log();
console.log("Next step: load the unpacked extension in Chrome:");
console.log("  chrome://extensions → Developer mode → Load unpacked →");
console.log(`  ${extensionTargetDir}`);
