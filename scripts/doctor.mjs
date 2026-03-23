#!/usr/bin/env node

/**
 * Kuma Picker health check (doctor).
 *
 * Agents run this to diagnose what's working and what needs fixing.
 * Exits 0 if everything is healthy, 1 if any required check fails.
 *
 * Usage:
 *   node scripts/doctor.mjs [--json]
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KUMA_ROOT = resolve(__dirname, "..");
const jsonMode = process.argv.includes("--json");

const checks = [];

function check(name, fn, { level = "required" } = {}) {
  try {
    const result = fn();
    checks.push({ name, ok: true, detail: result || "OK", level });
  } catch (e) {
    checks.push({ name, ok: false, detail: e.message || String(e), level });
  }
}

function run(cmd) {
  return execSync(cmd, { cwd: KUMA_ROOT, stdio: "pipe", timeout: 10000 }).toString().trim();
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

function resolveSkillPath(agent) {
  if (agent === "codex") {
    return resolve(resolveCodexHome(), "skills", "kuma-picker", "SKILL.md");
  }

  return resolve(os.homedir(), ".claude", "skills", "kuma-picker", "SKILL.md");
}

function checkSkill(agent) {
  const activeAgent = detectPrimaryAgent();
  const skillPath = resolveSkillPath(agent);
  const isActiveAgent = agent === activeAgent;

  check(
    `${agent}_skill`,
    () => {
      if (!existsSync(skillPath)) {
        const installHint = isActiveAgent
          ? "node scripts/install.mjs"
          : `node scripts/install.mjs --also-${agent}`;
        throw new Error(`Missing: ${skillPath}. Run: ${installHint}`);
      }

      return isActiveAgent ? skillPath : `${skillPath} (optional)`;
    },
    { level: isActiveAgent ? "required" : "optional" },
  );
}

check("node_version", () => {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 20) throw new Error(`Node.js >= 20 required (current: ${process.versions.node})`);
  return `v${process.versions.node}`;
});

check("node_modules", () => {
  if (!existsSync(resolve(KUMA_ROOT, "node_modules"))) {
    throw new Error("Missing. Run: npm install");
  }
  return "installed";
});

check("daemon_reachable", () => {
  try {
    const out = run(`node ./packages/server/src/cli.mjs get-browser-session 2>&1`);
    if (out.includes("ECONNREFUSED") || out.includes("fetch failed")) {
      throw new Error("Daemon not running. Run: node ./packages/server/src/cli.mjs serve");
    }
    return "http://127.0.0.1:4312";
  } catch (e) {
    if (e.message.includes("Daemon not running")) throw e;
    throw new Error("Daemon not running. Run: node ./packages/server/src/cli.mjs serve");
  }
});

check("state_home", () => {
  const stateHome = process.env.KUMA_PICKER_STATE_HOME || resolve(os.homedir(), ".kuma-picker");
  if (!existsSync(stateHome)) {
    throw new Error(`Missing: ${stateHome}. Run: node scripts/install.mjs`);
  }
  return stateHome;
});

check("extension_status", () => {
  try {
    const out = run(`node ./packages/server/src/cli.mjs get-extension-status 2>&1`);
    if (out.includes("No extension status") || out.includes("ECONNREFUSED")) {
      throw new Error("No heartbeat. Load the extension in chrome://extensions and refresh a page.");
    }
    return "connected";
  } catch (e) {
    if (e.message.includes("No heartbeat") || e.message.includes("Load the extension")) throw e;
    throw new Error("No heartbeat. Load the extension in chrome://extensions and refresh a page.");
  }
});

check("browser_bridge", () => {
  try {
    const out = run(`node ./packages/server/src/cli.mjs get-browser-session 2>&1`);
    const match = out.match(/"tabCount"\s*:\s*(\d+)/);
    const tabCount = match ? parseInt(match[1], 10) : 0;
    if (tabCount === 0) {
      throw new Error("No live tabs. Open a page in Chrome and refresh it with the extension active.");
    }
    return `${tabCount} tab(s) connected`;
  } catch (e) {
    if (e.message.includes("No live tabs")) throw e;
    throw new Error("Bridge unreachable. Start daemon and load extension first.");
  }
});

checkSkill("codex");
checkSkill("claude");

check("extension_source", () => {
  const extPath = resolve(KUMA_ROOT, "packages", "browser-extension", "manifest.json");
  if (!existsSync(extPath)) {
    throw new Error(`Missing: ${resolve(KUMA_ROOT, "packages/browser-extension")}`);
  }
  return resolve(KUMA_ROOT, "packages", "browser-extension");
});

if (jsonMode) {
  process.stdout.write(JSON.stringify({ checks }, null, 2) + "\n");
} else {
  const maxName = Math.max(...checks.map((c) => c.name.length));
  process.stdout.write("\n── Kuma Picker Doctor ──────────────────────────────\n\n");
  for (const c of checks) {
    const icon = c.ok ? "✓" : c.level === "optional" ? "⚠" : "✗";
    const suffix = !c.ok && c.level === "optional" ? " (optional)" : "";
    const pad = " ".repeat(maxName - c.name.length);
    process.stdout.write(`  ${icon} ${c.name}${pad}  ${c.detail}${suffix}\n`);
  }

  const failed = checks.filter((c) => !c.ok && c.level === "required");
  const warned = checks.filter((c) => !c.ok && c.level === "optional");
  if (warned.length > 0) {
    process.stdout.write(`\n  ${warned.length} optional warning(s).\n`);
  }
  if (failed.length > 0) {
    process.stdout.write(`\n  ${failed.length} issue(s) found. Fix them in order above.\n\n`);
    if (failed.some((c) => c.name === "node_modules")) {
      process.stdout.write("  Quick fix: npm install\n\n");
    } else if (failed.some((c) => c.name === "daemon_reachable")) {
      process.stdout.write(`  Quick fix: node ${resolve(KUMA_ROOT, "packages/server/src/cli.mjs")} serve &\n\n`);
    } else if (failed.some((c) => c.name === "codex_skill" || c.name === "claude_skill")) {
      process.stdout.write(`  Quick fix: node ${resolve(KUMA_ROOT, "scripts/install.mjs")}\n\n`);
    } else if (failed.some((c) => c.name === "extension_status" || c.name === "browser_bridge")) {
      process.stdout.write(
        "  Quick fix: Load the extension in chrome://extensions (Developer mode → Load unpacked)\n" +
          `  Extension folder: ${resolve(KUMA_ROOT, "packages/browser-extension")}\n\n`,
      );
    }
    process.exitCode = 1;
  } else {
    process.stdout.write("\n  All checks passed.\n\n");
  }
}
