#!/usr/bin/env node

/**
 * Kuma Picker automated installer.
 *
 * Designed to be run BY an agent, not by a human.
 * Handles: npm install, daemon launch, state home creation,
 * and global skill installation for the active agent.
 *
 * Usage:
 *   node scripts/install.mjs [--skip-daemon] [--also-codex] [--also-claude]
 */

import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KUMA_ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stdout.write(`[kuma-picker:install] ${msg}\n`);
}

function err(msg) {
  process.stderr.write(`[kuma-picker:install] ERROR: ${msg}\n`);
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: KUMA_ROOT, stdio: "pipe", ...opts }).toString().trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skip-daemon") {
      flags.skipDaemon = true;
    }
    if (argv[i] === "--also-codex") {
      flags.alsoCodex = true;
    }
    if (argv[i] === "--also-claude") {
      flags.alsoClaude = true;
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Detect which agent is running this installer
// ---------------------------------------------------------------------------

function detectActiveAgent() {
  if (process.env.CODEX_HOME || process.env.CODEX) return "codex";
  return "claude";
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 20) {
    err(`Node.js >= 20 required (current: ${process.versions.node})`);
    process.exit(1);
  }
  log(`Node.js ${process.versions.node} — OK`);
}

function installDependencies() {
  if (existsSync(resolve(KUMA_ROOT, "node_modules"))) {
    log("node_modules already exists — skipping npm install");
    return;
  }
  log("Running npm install...");
  try {
    execSync("npm install", { cwd: KUMA_ROOT, stdio: "inherit" });
    log("npm install — OK");
  } catch {
    err("npm install failed");
    process.exit(1);
  }
}

function isDaemonRunning() {
  try {
    const res = run(`node ./packages/server/src/cli.mjs get-browser-session 2>&1`);
    return res !== null && !res.includes("ECONNREFUSED") && !res.includes("fetch failed");
  } catch {
    return false;
  }
}

function startDaemon() {
  if (isDaemonRunning()) {
    log("Daemon already running on http://127.0.0.1:4312 — OK");
    return;
  }
  log("Starting daemon in background...");
  const child = spawn("node", ["./packages/server/src/cli.mjs", "serve"], {
    cwd: KUMA_ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  log(`Daemon started (pid ${child.pid}) on http://127.0.0.1:4312`);
}

function ensureStateHome() {
  const stateHome =
    process.env.KUMA_PICKER_STATE_HOME ||
    resolve(os.homedir(), ".kuma-picker");

  if (!existsSync(stateHome)) {
    mkdirSync(stateHome, { recursive: true });
    log(`Created state home: ${stateHome}`);
  } else {
    log(`State home exists: ${stateHome}`);
  }
  return stateHome;
}

function installSkillCopy(destDir) {
  const skillSrc = resolve(KUMA_ROOT, "skills", "kuma-picker");
  if (!existsSync(skillSrc)) {
    err(`Skill source not found: ${skillSrc}`);
    return;
  }

  mkdirSync(destDir, { recursive: true });
  cpSync(skillSrc, destDir, { recursive: true });

  // Stamp the repo path into the installed SKILL.md
  const skillMdPath = resolve(destDir, "SKILL.md");
  if (existsSync(skillMdPath)) {
    const content = readFileSync(skillMdPath, "utf-8");
    writeFileSync(skillMdPath, content.replaceAll("__KUMA_PICKER_REPO__", KUMA_ROOT));
  }
  // Also stamp references/commands.md
  const cmdsMdPath = resolve(destDir, "references", "commands.md");
  if (existsSync(cmdsMdPath)) {
    const content = readFileSync(cmdsMdPath, "utf-8");
    writeFileSync(cmdsMdPath, content.replaceAll("__KUMA_PICKER_REPO__", KUMA_ROOT));
  }

  log(`Skill installed to ${destDir} (repo: ${KUMA_ROOT})`);
}

function installGlobalSkills(activeAgent, flags) {
  const claudeDest = resolve(os.homedir(), ".claude", "skills", "kuma-picker");
  const codexDest = resolve(os.homedir(), ".codex", "skills", "kuma-picker");

  if (activeAgent === "claude") {
    // Claude is primary — always install Claude skill
    installSkillCopy(claudeDest);
    if (flags.alsoCodex) {
      installSkillCopy(codexDest);
    }
  } else {
    // Codex is primary — always install Codex skill
    installSkillCopy(codexDest);
    if (flags.alsoClaude) {
      installSkillCopy(claudeDest);
    }
  }
}

function printExtensionGuide() {
  const extensionPath = resolve(KUMA_ROOT, "packages", "browser-extension");
  process.stdout.write(`
╔══════════════════════════════════════════════════════════════════╗
║  ONE REMAINING STEP (requires human action in Chrome)          ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  1. Open chrome://extensions in Chrome                          ║
║  2. Enable "Developer mode" (top right toggle)                  ║
║  3. Click "Load unpacked"                                       ║
║  4. Select this folder:                                         ║
║     ${extensionPath}
║                                                                  ║
║  After loading, click the Kuma Picker extension icon and        ║
║  confirm the daemon URL is http://127.0.0.1:4312                ║
║  Then refresh the target page once.                             ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

function printSummary(stateHome, activeAgent) {
  process.stdout.write(`
── Kuma Picker install summary ──────────────────────────────────
  Repo:         ${KUMA_ROOT}
  Active agent: ${activeAgent}
  State home:   ${stateHome}
  Daemon:       http://127.0.0.1:4312
  Extension:    ${resolve(KUMA_ROOT, "packages/browser-extension")}
  Claude skill: ~/.claude/skills/kuma-picker/
  Codex skill:  ~/.codex/skills/kuma-picker/
─────────────────────────────────────────────────────────────────

To verify everything works:
  node ${resolve(KUMA_ROOT, "packages/server/src/cli.mjs")} get-browser-session

`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const flags = parseArgs(process.argv.slice(2));
const activeAgent = detectActiveAgent();

checkNodeVersion();
installDependencies();
const stateHome = ensureStateHome();
installGlobalSkills(activeAgent, flags);
if (!flags.skipDaemon) {
  startDaemon();
}
printExtensionGuide();
printSummary(stateHome, activeAgent);
