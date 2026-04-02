#!/usr/bin/env node

/**
 * Kuma Studio portable installer.
 *
 * Installs:
 *   1. npm dependencies
 *   2. Skill files → user Claude skills directory
 *   3. State directory → user Kuma Picker directory
 *   4. Team metadata → user Kuma Picker team metadata
 *   5. Studio-web production build
 *
 * Usage:
 *   node scripts/install.mjs [--skip-build] [--skip-deps]
 */

import { access } from "node:fs/promises";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "../packages/server/src/constants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const CLAUDE_SKILLS_DIR = join(CLAUDE_DIR, "skills");
const STATE_DIR = join(HOME, ".kuma-picker");

const SKILLS = ["kuma", "dev-team", "analytics-team", "strategy-team"];
const IGNORED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".turbo"]);
const summary = [];

function log(msg) { process.stdout.write(`  ✓ ${msg}\n`); }
function warn(msg) { process.stdout.write(`  ⚠ ${msg}\n`); }
function header(msg) { process.stdout.write(`\n🐻 ${msg}\n${"─".repeat(40)}\n`); }

function addSummary(status, detail) {
  summary.push({ status, detail });
}

function summarizePath(targetPath) {
  if (targetPath.startsWith(HOME)) {
    return `~${targetPath.slice(HOME.length)}`;
  }
  return relative(ROOT, targetPath) || targetPath;
}

function parseFlags(argv) {
  const flags = new Set();
  for (const arg of argv) {
    if (arg.startsWith("--")) flags.add(arg.slice(2));
  }
  return flags;
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  const existed = await pathExists(dir);
  if (!existed) {
    await mkdir(dir, { recursive: true });
  }
  return !existed;
}

async function ensureDirWithSummary(dir) {
  const created = await ensureDir(dir);
  if (created) {
    log(`Created ${summarizePath(dir)}`);
    addSummary("created", `Created directory ${summarizePath(dir)}`);
  } else {
    log(`${summarizePath(dir)} already exists`);
    addSummary("skipped", `Skipped existing directory ${summarizePath(dir)}`);
  }
}

async function copyFileIfChanged(src, dest) {
  const srcContents = await readFile(src);
  const destExists = await pathExists(dest);

  if (destExists) {
    const destContents = await readFile(dest);
    if (srcContents.equals(destContents)) {
      return "skipped";
    }
  }

  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  return destExists ? "updated" : "copied";
}

async function installSkills() {
  header("Installing skills");
  await ensureDirWithSummary(CLAUDE_DIR);
  await ensureDirWithSummary(CLAUDE_SKILLS_DIR);

  for (const skill of SKILLS) {
    const srcFile = resolve(ROOT, ".claude", "skills", skill, "skill.md");
    const destDir = resolve(CLAUDE_SKILLS_DIR, skill);
    const destFile = resolve(destDir, "skill.md");

    if (!(await pathExists(srcFile))) {
      warn(`skill source not found: ${summarizePath(srcFile)} — skipping`);
      addSummary("missing", `Missing skill source ${summarizePath(srcFile)}`);
      continue;
    }

    await ensureDirWithSummary(destDir);

    const result = await copyFileIfChanged(srcFile, destFile);
    if (result === "copied") {
      log(`${skill} → ${summarizePath(destFile)}`);
      addSummary("copied", `Copied ${summarizePath(srcFile)} → ${summarizePath(destFile)}`);
    } else if (result === "updated") {
      log(`Updated ${skill} → ${summarizePath(destFile)}`);
      addSummary("updated", `Updated ${summarizePath(destFile)} from ${summarizePath(srcFile)}`);
    } else {
      log(`${summarizePath(destFile)} already up to date`);
      addSummary("skipped", `Skipped existing file ${summarizePath(destFile)}`);
    }
  }
}

async function findRepoTeamMetadata(dir = ROOT) {
  const candidates = [
    resolve(ROOT, ".claude", "team.json"),
    resolve(ROOT, "team.json"),
  ];

  if (dir === ROOT) {
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const found = await findRepoTeamMetadata(resolve(dir, entry.name));
      if (found) return found;
      continue;
    }

    if (entry.isFile() && entry.name === "team.json") {
      return resolve(dir, entry.name);
    }
  }

  return null;
}

async function writeDefaultTeamMetadata(dest) {
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

  await writeFile(dest, JSON.stringify(teamMeta, null, 2) + "\n");
}

async function setupStateDir() {
  header("Setting up state directory");
  const teamMetaPath = resolve(STATE_DIR, "team.json");

  await ensureDirWithSummary(STATE_DIR);

  const repoTeamMetadata = await findRepoTeamMetadata();
  if (repoTeamMetadata) {
    const result = await copyFileIfChanged(repoTeamMetadata, teamMetaPath);
    if (result === "copied") {
      log(`Team metadata → ${summarizePath(teamMetaPath)}`);
      addSummary("copied", `Copied ${summarizePath(repoTeamMetadata)} → ${summarizePath(teamMetaPath)}`);
    } else if (result === "updated") {
      log(`Updated team metadata → ${summarizePath(teamMetaPath)}`);
      addSummary("updated", `Updated ${summarizePath(teamMetaPath)} from ${summarizePath(repoTeamMetadata)}`);
    } else {
      log(`${summarizePath(teamMetaPath)} already up to date`);
      addSummary("skipped", `Skipped existing file ${summarizePath(teamMetaPath)}`);
    }
    return;
  }

  if (await pathExists(teamMetaPath)) {
    log(`${summarizePath(teamMetaPath)} already exists`);
    addSummary("skipped", `Skipped existing file ${summarizePath(teamMetaPath)}`);
    return;
  }

  await writeDefaultTeamMetadata(teamMetaPath);
  log(`Created default team metadata → ${summarizePath(teamMetaPath)}`);
  addSummary("created", `Created default metadata ${summarizePath(teamMetaPath)}`);
}

function installDeps(flags) {
  if (flags.has("skip-deps")) {
    warn("Skipping npm install (--skip-deps)");
    addSummary("skipped", "Skipped npm install (--skip-deps)");
    return;
  }
  header("Installing dependencies");
  try {
    execSync("npm install", { cwd: ROOT, stdio: "inherit", timeout: 120_000 });
    log("Dependencies installed");
    addSummary("completed", "Installed npm dependencies");
  } catch {
    warn("npm install failed — you may need to run it manually");
    addSummary("warning", "npm install failed");
  }
}

function buildStudio(flags) {
  if (flags.has("skip-build")) {
    warn("Skipping build (--skip-build)");
    addSummary("skipped", "Skipped studio build (--skip-build)");
    return;
  }
  header("Building studio-web");
  try {
    execSync("npm run build:studio", { cwd: ROOT, stdio: "inherit", timeout: 60_000 });
    log("Studio-web built successfully");
    addSummary("completed", "Built studio-web");
  } catch {
    warn("Build failed — you can run 'npm run build:studio' manually");
    addSummary("warning", "Studio-web build failed");
  }
}

async function registerSettings() {
  header("Registering settings");
  const settingsPath = join(CLAUDE_DIR, "settings.json");
  let settings = {};

  if (await pathExists(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, "utf8"));
    } catch {
      settings = {};
    }
  }

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
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    log("Skills registered in settings.json");
    addSummary("updated", `Updated ${summarizePath(settingsPath)}`);
  } else {
    log("Skills already registered");
    addSummary("skipped", `Skipped existing settings ${summarizePath(settingsPath)}`);
  }
}

function printSummary() {
  header("Installation summary");
  if (summary.length === 0) {
    process.stdout.write("  • No actions recorded\n");
    return;
  }

  for (const entry of summary) {
    process.stdout.write(`  • [${entry.status}] ${entry.detail}\n`);
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  process.stdout.write("\n🐻 Kuma Studio Installer\n");
  process.stdout.write("========================\n");

  installDeps(flags);
  await installSkills();
  await setupStateDir();
  await registerSettings();
  buildStudio(flags);

  header("Installation complete!");
  process.stdout.write(`
  Quick start:
    cd ${ROOT}
    npm run kuma-studio:serve     # Start daemon (port ${DEFAULT_PORT})
    npm run kuma-studio:dashboard # Open studio in browser

  Skills installed:
${SKILLS.map((s) => `    /claude ${s}`).join("\n")}

  Chrome extension:
    1. Open chrome://extensions
    2. Enable Developer Mode
    3. Load unpacked → ${resolve(ROOT, "packages/browser-extension")}

`);

  printSummary();
}

main().catch((err) => {
  process.stderr.write(`\n❌ Error: ${err.message}\n`);
  process.exitCode = 1;
});
