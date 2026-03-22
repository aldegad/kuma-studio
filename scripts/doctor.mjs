#!/usr/bin/env node

/**
 * Kuma Picker health check (doctor).
 *
 * Agents run this to diagnose what's working and what needs fixing.
 * Exits 0 if everything is healthy, 1 if any check fails.
 *
 * Usage:
 *   node scripts/doctor.mjs [--json]
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KUMA_ROOT = resolve(__dirname, "..");
const jsonMode = process.argv.includes("--json");

const checks = [];

function check(name, fn) {
  try {
    const result = fn();
    checks.push({ name, ok: true, detail: result || "OK" });
  } catch (e) {
    checks.push({ name, ok: false, detail: e.message || String(e) });
  }
}

function run(cmd) {
  return execSync(cmd, { cwd: KUMA_ROOT, stdio: "pipe", timeout: 10000 }).toString().trim();
}

// ── Checks ────────────────────────────────────────────────────────────────

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
  const stateHome =
    process.env.KUMA_PICKER_STATE_HOME ||
    (process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME, "kuma-picker") : null) ||
    resolve(os.homedir(), ".kuma-picker");
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

check("global_skill", () => {
  const skillPath = resolve(os.homedir(), ".claude", "skills", "kuma-picker", "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error(`Missing: ${skillPath}. Run: node scripts/install.mjs`);
  }
  return skillPath;
});

check("extension_source", () => {
  const extPath = resolve(KUMA_ROOT, "packages", "browser-extension", "manifest.json");
  if (!existsSync(extPath)) {
    throw new Error(`Missing: ${resolve(KUMA_ROOT, "packages/browser-extension")}`);
  }
  return resolve(KUMA_ROOT, "packages", "browser-extension");
});

// ── Output ────────────────────────────────────────────────────────────────

if (jsonMode) {
  process.stdout.write(JSON.stringify({ checks }, null, 2) + "\n");
} else {
  const maxName = Math.max(...checks.map((c) => c.name.length));
  process.stdout.write("\n── Kuma Picker Doctor ──────────────────────────────\n\n");
  for (const c of checks) {
    const icon = c.ok ? "✓" : "✗";
    const pad = " ".repeat(maxName - c.name.length);
    process.stdout.write(`  ${icon} ${c.name}${pad}  ${c.detail}\n`);
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    process.stdout.write(`\n  ${failed.length} issue(s) found. Fix them in order above.\n\n`);
    if (failed.some((c) => c.name === "node_modules")) {
      process.stdout.write("  Quick fix: npm install\n\n");
    } else if (failed.some((c) => c.name === "daemon_reachable")) {
      process.stdout.write(`  Quick fix: node ${resolve(KUMA_ROOT, "packages/server/src/cli.mjs")} serve &\n\n`);
    } else if (failed.some((c) => c.name === "global_skill")) {
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
