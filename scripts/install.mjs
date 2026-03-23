#!/usr/bin/env node

/**
 * Kuma Picker automated installer.
 *
 * Designed to be run BY an agent, not by a human.
 * Handles: npm install, daemon launch, state home creation,
 * and global skill installation for the active agent by default.
 *
 * Usage:
 *   node scripts/install.mjs [--skip-daemon] [--all] [--also-codex] [--also-claude]
 */

import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KUMA_ROOT = resolve(__dirname, "..");

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
  const flags = {
    installAllAgents: false,
    alsoCodex: false,
    alsoClaude: false,
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skip-daemon") {
      flags.skipDaemon = true;
    } else if (argv[i] === "--all" || argv[i] === "--all-agents") {
      flags.installAllAgents = true;
    } else if (argv[i] === "--also-codex") {
      flags.alsoCodex = true;
    } else if (argv[i] === "--also-claude") {
      flags.alsoClaude = true;
    }
  }

  return flags;
}

function resolveCodexHome() {
  return process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : resolve(os.homedir(), ".codex");
}

function detectPrimaryAgent() {
  if (
    process.env.CODEX_HOME ||
    process.env.CODEX_SHELL ||
    process.env.CODEX_CI ||
    process.env.CODEX_THREAD_ID ||
    process.env.CODEX
  ) {
    return "codex";
  }

  return "claude";
}

function resolveSkillDest(agent) {
  if (agent === "codex") {
    return resolve(resolveCodexHome(), "skills", "kuma-picker");
  }

  return resolve(os.homedir(), ".claude", "skills", "kuma-picker");
}

function resolveSkillInstallTargets(flags) {
  const targets = new Set([detectPrimaryAgent()]);

  if (flags.installAllAgents) {
    targets.add("codex");
    targets.add("claude");
  }
  if (flags.alsoCodex) {
    targets.add("codex");
  }
  if (flags.alsoClaude) {
    targets.add("claude");
  }

  return [...targets];
}

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
  const stateHome = process.env.KUMA_PICKER_STATE_HOME || resolve(os.homedir(), ".kuma-picker");

  if (!existsSync(stateHome)) {
    mkdirSync(stateHome, { recursive: true });
    log(`Created state home: ${stateHome}`);
  } else {
    log(`State home exists: ${stateHome}`);
  }
  return stateHome;
}

function installSkillCopy(skillSrc, skillDest) {
  mkdirSync(skillDest, { recursive: true });
  cpSync(skillSrc, skillDest, { recursive: true });

  const skillMdPath = resolve(skillDest, "SKILL.md");
  if (existsSync(skillMdPath)) {
    const content = readFileSync(skillMdPath, "utf-8");
    writeFileSync(skillMdPath, content.replaceAll("__KUMA_PICKER_REPO__", KUMA_ROOT));
  }

  const cmdsMdPath = resolve(skillDest, "references", "commands.md");
  if (existsSync(cmdsMdPath)) {
    const content = readFileSync(cmdsMdPath, "utf-8");
    writeFileSync(cmdsMdPath, content.replaceAll("__KUMA_PICKER_REPO__", KUMA_ROOT));
  }
}

function installGlobalSkills(flags) {
  const skillSrc = resolve(KUMA_ROOT, "skills", "kuma-picker");
  if (!existsSync(skillSrc)) {
    err(`Skill source not found: ${skillSrc}`);
    return { installedTargets: [], primaryAgent: detectPrimaryAgent() };
  }

  const primaryAgent = detectPrimaryAgent();
  const installedTargets = resolveSkillInstallTargets(flags);

  for (const target of installedTargets) {
    const skillDest = resolveSkillDest(target);
    installSkillCopy(skillSrc, skillDest);
    log(`Global skill installed to ${skillDest} (${target}, repo: ${KUMA_ROOT})`);
  }

  return { installedTargets, primaryAgent };
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

function printSummary(stateHome, installSummary) {
  const { installedTargets, primaryAgent } = installSummary;
  const codexSkillPath = resolveSkillDest("codex");
  const claudeSkillPath = resolveSkillDest("claude");
  const installedLabel = installedTargets.length > 0 ? installedTargets.join(", ") : "(none)";
  const optionalHints = [];

  if (!installedTargets.includes("codex")) {
    optionalHints.push("--also-codex");
  }
  if (!installedTargets.includes("claude")) {
    optionalHints.push("--also-claude");
  }

  process.stdout.write(`
── Kuma Picker install summary ──────────────────────────────────
  Repo:         ${KUMA_ROOT}
  Active agent: ${primaryAgent}
  State home:   ${stateHome}
  Daemon:       http://127.0.0.1:4312
  Extension:    ${resolve(KUMA_ROOT, "packages/browser-extension")}
  Installed:    ${installedLabel}
  Codex skill:  ${codexSkillPath}
  Claude skill: ${claudeSkillPath}
─────────────────────────────────────────────────────────────────

To verify everything works:
  node ${resolve(KUMA_ROOT, "packages/server/src/cli.mjs")} get-browser-session

${optionalHints.length > 0 ? `Optional extra skill targets: node ${resolve(KUMA_ROOT, "scripts/install.mjs")} ${optionalHints.join(" ")}\n` : ""}

`);
}

const flags = parseArgs(process.argv.slice(2));

checkNodeVersion();
installDependencies();
const stateHome = ensureStateHome();
const installSummary = installGlobalSkills(flags);
if (!flags.skipDaemon) {
  startDaemon();
}
printExtensionGuide();
printSummary(stateHome, installSummary);
