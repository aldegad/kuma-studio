#!/usr/bin/env node

/**
 * Kuma Picker automated installer.
 *
 * Designed to be run BY an agent, not by a human.
 * Handles: npm install, daemon launch, skill file copy, and
 * prints the one remaining human step (Chrome extension loading).
 *
 * Usage:
 *   node scripts/install.mjs [--target-project /path/to/project] [--skip-daemon]
 *
 * When --target-project is given, the script also vendors a CLI shim and
 * skill files into that project so kuma-pickerd commands work from there.
 */

import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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
  } catch (e) {
    return null;
  }
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target-project" && argv[i + 1]) {
      flags.targetProject = resolve(argv[++i]);
    }
    if (argv[i] === "--skip-daemon") {
      flags.skipDaemon = true;
    }
  }
  return flags;
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
    // If daemon is not running, the command errors or returns connection refused.
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
    (process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME, "kuma-picker") : null) ||
    resolve(os.homedir(), ".kuma-picker");

  if (!existsSync(stateHome)) {
    mkdirSync(stateHome, { recursive: true });
    log(`Created state home: ${stateHome}`);
  } else {
    log(`State home exists: ${stateHome}`);
  }
  return stateHome;
}

function copyExtensionToGlobalPath() {
  const codexHome = process.env.CODEX_HOME || resolve(os.homedir(), ".codex");
  const extDest = resolve(codexHome, "extensions", "kuma-picker-browser-extension");
  const extSrc = resolve(KUMA_ROOT, "packages", "browser-extension");

  if (!existsSync(extSrc)) {
    err(`Extension source not found: ${extSrc}`);
    return null;
  }

  mkdirSync(extDest, { recursive: true });
  cpSync(extSrc, extDest, { recursive: true });
  log(`Extension copied to ${extDest}`);
  return extDest;
}

function copySkillFiles(targetProject) {
  if (!targetProject) return;

  // Copy skill files into target project's .claude/skills/kuma-picker/
  const skillSrc = resolve(KUMA_ROOT, "skills", "kuma-picker");
  const skillDest = resolve(targetProject, ".claude", "skills", "kuma-picker");

  if (!existsSync(skillSrc)) {
    err(`Skill source not found: ${skillSrc}`);
    return;
  }

  mkdirSync(skillDest, { recursive: true });
  cpSync(skillSrc, skillDest, { recursive: true });
  log(`Skill files copied to ${skillDest}`);

  // Inject kuma-pickerd:serve and kuma-pickerd:get-selection scripts into
  // the target project's package.json so that npm run kuma-pickerd:* works.
  const targetPkgPath = resolve(targetProject, "package.json");
  if (existsSync(targetPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(targetPkgPath, "utf-8"));
      const cliPath = relative(targetProject, resolve(KUMA_ROOT, "packages/server/src/cli.mjs"));
      const scripts = pkg.scripts || {};
      let changed = false;

      const essentialScripts = [
        "kuma-pickerd:serve",
        "kuma-pickerd:get-selection",
        "kuma-pickerd:get-job-card",
        "kuma-pickerd:get-extension-status",
        "kuma-pickerd:get-browser-session",
        "kuma-pickerd:set-job-status",
        "kuma-pickerd:browser-context",
        "kuma-pickerd:browser-navigate",
        "kuma-pickerd:browser-dom",
        "kuma-pickerd:browser-click",
        "kuma-pickerd:browser-screenshot",
        "kuma-pickerd:browser-refresh",
        "kuma-pickerd:browser-sequence",
        "kuma-pickerd:browser-fill",
        "kuma-pickerd:browser-key",
        "kuma-pickerd:browser-eval",
        "kuma-pickerd:browser-console",
        "kuma-pickerd:browser-query-dom",
      ];

      for (const name of essentialScripts) {
        const cmd = name.replace("kuma-pickerd:", "");
        if (!scripts[name]) {
          scripts[name] = `node ${cliPath} ${cmd}`;
          changed = true;
        }
      }

      if (changed) {
        pkg.scripts = scripts;
        writeFileSync(targetPkgPath, JSON.stringify(pkg, null, 2) + "\n");
        log(`Injected kuma-pickerd scripts into ${targetPkgPath}`);
      }
    } catch (e) {
      err(`Could not update target package.json: ${e.message}`);
    }
  }
}

function printExtensionGuide(globalExtPath) {
  const extensionPath = globalExtPath || resolve(KUMA_ROOT, "packages", "browser-extension");
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

function printSummary(stateHome, globalExtPath) {
  const extPath = globalExtPath || resolve(KUMA_ROOT, "packages/browser-extension");
  process.stdout.write(`
── Kuma Picker install summary ──────────────────────────────────
  Repo:         ${KUMA_ROOT}
  State home:   ${stateHome}
  Daemon:       http://127.0.0.1:4312
  Extension:    ${extPath}
─────────────────────────────────────────────────────────────────

To verify everything works:
  npm run kuma-pickerd:get-browser-session

`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const flags = parseArgs(process.argv.slice(2));

checkNodeVersion();
installDependencies();
const stateHome = ensureStateHome();
const globalExtPath = copyExtensionToGlobalPath();
if (!flags.skipDaemon) {
  startDaemon();
}
copySkillFiles(flags.targetProject);
printExtensionGuide(globalExtPath);
printSummary(stateHome, globalExtPath);
