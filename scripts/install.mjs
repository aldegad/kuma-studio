#!/usr/bin/env node

/**
 * Kuma Studio portable installer.
 *
 * Installs:
 *   1. npm dependencies
 *   2. Skill files → ~/.claude/skills/{kuma,dev-team,analytics-team,strategy-team}
 *   3. State directory → ~/.kuma-picker/
 *   4. Team metadata → ~/.kuma-picker/team.json
 *   5. Studio-web production build
 *
 * Usage:
 *   node scripts/install.mjs [--skip-build] [--skip-deps]
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const HOME = homedir();

const SKILLS = ["kuma", "dev-team", "analytics-team", "strategy-team"];

function log(msg) { process.stdout.write(`  ✓ ${msg}\n`); }
function warn(msg) { process.stdout.write(`  ⚠ ${msg}\n`); }
function header(msg) { process.stdout.write(`\n🐻 ${msg}\n${"─".repeat(40)}\n`); }

function parseFlags(argv) {
  const flags = new Set();
  for (const arg of argv) {
    if (arg.startsWith("--")) flags.add(arg.slice(2));
  }
  return flags;
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return true;
  }
  return false;
}

function installSkills() {
  header("Installing skills");
  const claudeSkillsDir = resolve(HOME, ".claude", "skills");
  ensureDir(claudeSkillsDir);

  for (const skill of SKILLS) {
    const srcDir = resolve(ROOT, "skills", skill);
    const destDir = resolve(claudeSkillsDir, skill);

    if (!existsSync(resolve(srcDir, "skill.md"))) {
      warn(`skill source not found: skills/${skill}/skill.md — skipping`);
      continue;
    }

    ensureDir(destDir);

    // Copy all files in skill directory
    const files = readdirSync(srcDir);
    for (const file of files) {
      copyFileSync(resolve(srcDir, file), resolve(destDir, file));
    }
    log(`${skill} → ${destDir}`);
  }
}

function setupStateDir() {
  header("Setting up state directory");
  const stateDir = resolve(HOME, ".kuma-picker");
  const created = ensureDir(stateDir);
  if (created) {
    log(`Created ${stateDir}`);
  } else {
    log(`${stateDir} already exists`);
  }

  // Write team metadata
  const teamMetaPath = resolve(stateDir, "team.json");
  const teamMeta = {
    name: "쿠마팀",
    version: "1.0.0",
    leader: "kuma",
    teams: {
      management: { lead: "kuma", emoji: "🐻", label: "총괄" },
      dev: { lead: "howl", emoji: "🐺", label: "개발팀", workers: ["tookdaki", "saemi", "koon", "bamdori"] },
      analytics: { lead: "rumi", emoji: "🦊", label: "분석팀", workers: ["darami", "buri"] },
      strategy: { lead: "noeuri", emoji: "🦌", label: "전략팀", workers: ["kongkongi", "moongchi", "jjooni"] },
    },
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(teamMetaPath, JSON.stringify(teamMeta, null, 2) + "\n");
  log(`Team metadata → ${teamMetaPath}`);
}

function installDeps(flags) {
  if (flags.has("skip-deps")) {
    warn("Skipping npm install (--skip-deps)");
    return;
  }
  header("Installing dependencies");
  try {
    execSync("npm install", { cwd: ROOT, stdio: "inherit", timeout: 120_000 });
    log("Dependencies installed");
  } catch {
    warn("npm install failed — you may need to run it manually");
  }
}

function buildStudio(flags) {
  if (flags.has("skip-build")) {
    warn("Skipping build (--skip-build)");
    return;
  }
  header("Building studio-web");
  try {
    execSync("npm run build:studio", { cwd: ROOT, stdio: "inherit", timeout: 60_000 });
    log("Studio-web built successfully");
  } catch {
    warn("Build failed — you can run 'npm run build:studio' manually");
  }
}

function registerSettings() {
  header("Registering settings");
  const settingsPath = resolve(HOME, ".claude", "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch { settings = {}; }
  }

  // Ensure enabledPlugins includes kuma skills
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  let changed = false;
  for (const skill of SKILLS) {
    const key = `${skill}@user-skills`;
    if (!settings.enabledPlugins[key]) {
      settings.enabledPlugins[key] = true;
      changed = true;
    }
  }

  if (changed) {
    ensureDir(dirname(settingsPath));
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    log("Skills registered in settings.json");
  } else {
    log("Skills already registered");
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  process.stdout.write("\n🐻 Kuma Studio Installer\n");
  process.stdout.write("========================\n");

  installDeps(flags);
  installSkills();
  setupStateDir();
  registerSettings();
  buildStudio(flags);

  header("Installation complete!");
  process.stdout.write(`
  Quick start:
    cd ${ROOT}
    npm run kuma-studio:serve     # Start daemon (port 4312)
    npm run kuma-studio:dashboard # Open studio in browser

  Skills installed:
${SKILLS.map((s) => `    /claude ${s}`).join("\n")}

  Chrome extension:
    1. Open chrome://extensions
    2. Enable Developer Mode
    3. Load unpacked → ${resolve(ROOT, "packages/browser-extension")}

`);
}

main().catch((err) => {
  process.stderr.write(`\n❌ Error: ${err.message}\n`);
  process.exitCode = 1;
});
