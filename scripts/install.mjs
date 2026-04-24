#!/usr/bin/env node

/**
 * Kuma Studio portable installer.
 *
 * Installs:
 *   1. npm dependencies
 *   2. Skill directories → user Claude/Codex skills directories
 *   3. cmux scripts → user Kuma cmux directory
 *   4. State directory → user Kuma Picker directory
 *   5. Team metadata → user Kuma Picker team metadata
 *   6. Studio-web production build
 *
 * Usage:
 *   node scripts/install.mjs [--skip-build] [--skip-deps] [--claude-only|--codex-only]
 */

import { access } from "node:fs/promises";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "../packages/server/src/constants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const CLAUDE_HOOKS_DIR = join(CLAUDE_DIR, "hooks");
const CLAUDE_SKILLS_DIR = join(CLAUDE_DIR, "skills");
const CODEX_DIR = join(HOME, ".codex");
const CODEX_SKILLS_DIR = join(CODEX_DIR, "skills");
const KUMA_DIR = join(HOME, ".kuma");
const KUMA_CMUX_DIR = join(KUMA_DIR, "cmux");
const KUMA_BIN_DIR = join(KUMA_DIR, "bin");
const KUMA_PROJECTS_PATH = join(KUMA_DIR, "projects.json");
const KUMA_TEAM_JSON_PATH = join(KUMA_DIR, "team.json");
const STATE_DIR = join(HOME, ".kuma-picker");
const BUNDLED_TEAM_METADATA_PATH = resolve(ROOT, "packages", "shared", "team.json");

const SKILLS = [
  { id: "kuma-brief", source: "kuma-brief" },
  { id: "kuma-cmux-ops", source: "kuma-cmux-ops" },
  { id: "kuma-picker", source: "kuma-picker" },
  { id: "kuma-recovery", source: "kuma-recovery" },
  { id: "kuma-server", source: "kuma-server" },
  { id: "kuma-snapshot", source: "kuma-snapshot" },
  { id: "kuma-vault", source: "kuma-vault" },
  { id: "noeuri", source: "noeuri" },
  { id: "overnight-on", source: "overnight-on" },
  { id: "overnight-off", source: "overnight-off" },
];
const RETIRED_SKILL_IDS = [
  "analytics-team",
  "dev-team",
  "strategy-analytics-team",
  "strategy-team",
  "tmux-ops",
];
const SKILL_INSTALL_TARGETS = [
  { id: "claude", label: "Claude", dir: CLAUDE_SKILLS_DIR },
  { id: "codex", label: "Codex", dir: CODEX_SKILLS_DIR },
];
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

async function pathEntryExists(target) {
  try {
    await lstat(target);
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

async function ensureSymlink(target, dest) {
  const destExists = await pathEntryExists(dest);

  if (destExists) {
    const stats = await lstat(dest);
    if (stats.isSymbolicLink()) {
      const resolved = await realpath(dest).catch(() => null);
      if (resolved === resolve(target)) {
        return "skipped";
      }
    }

    if (stats.isDirectory()) {
      // Repo-managed skill dirs may already exist as copied folders. Replace them so
      // future updates stay in sync via the symlink.
      await rm(dest, { recursive: true, force: true });
    } else {
      await unlink(dest);
    }
  }

  await mkdir(dirname(dest), { recursive: true });
  await symlink(target, dest);
  return destExists ? "updated" : "created";
}

async function cleanupRetiredSkillLinks(installTarget) {
  const repoSkillsRoot = resolve(ROOT, "skills");
  for (const skillId of RETIRED_SKILL_IDS) {
    const destDir = resolve(installTarget.dir, skillId);
    let stats;
    try {
      stats = await lstat(destDir);
    } catch {
      continue;
    }

    if (!stats.isSymbolicLink()) {
      warn(`${installTarget.label}: retired skill ${skillId} exists but is not a symlink — leaving untouched`);
      addSummary("skipped", `Skipped non-symlink retired skill ${summarizePath(destDir)}`);
      continue;
    }

    const rawTarget = await readlink(destDir);
    const absoluteTarget = resolve(dirname(destDir), rawTarget);
    const resolvedTarget = await realpath(destDir).catch(() => null);
    const pointsAtRepoSkills =
      absoluteTarget === repoSkillsRoot ||
      absoluteTarget.startsWith(`${repoSkillsRoot}/`) ||
      resolvedTarget === repoSkillsRoot ||
      Boolean(resolvedTarget?.startsWith(`${repoSkillsRoot}/`));

    if (!pointsAtRepoSkills) {
      warn(`${installTarget.label}: retired skill ${skillId} points outside repo skills — leaving untouched`);
      addSummary("skipped", `Skipped external retired skill ${summarizePath(destDir)} → ${rawTarget}`);
      continue;
    }

    await unlink(destDir);
    log(`${installTarget.label}: removed retired skill ${skillId}`);
    addSummary("removed", `${installTarget.label} removed retired skill ${summarizePath(destDir)}`);
  }
}

function resolveSkillInstallTargets(flags) {
  const claudeOnly = flags.has("claude-only");
  const codexOnly = flags.has("codex-only");

  if (claudeOnly && codexOnly) {
    throw new Error("Choose only one of --claude-only or --codex-only.");
  }
  if (claudeOnly) return SKILL_INSTALL_TARGETS.filter((target) => target.id === "claude");
  if (codexOnly) return SKILL_INSTALL_TARGETS.filter((target) => target.id === "codex");
  return SKILL_INSTALL_TARGETS;
}

async function installSkills(flags) {
  header("Installing skills");
  const installTargets = resolveSkillInstallTargets(flags);

  for (const installTarget of installTargets) {
    const agentRoot = dirname(installTarget.dir);
    await ensureDirWithSummary(agentRoot);
    await ensureDirWithSummary(installTarget.dir);
    await cleanupRetiredSkillLinks(installTarget);

    for (const skill of SKILLS) {
      const srcDir = resolve(ROOT, "skills", skill.source);
      const srcFile = resolve(srcDir, "SKILL.md");
      const destDir = resolve(installTarget.dir, skill.id);

      if (!(await pathExists(srcFile))) {
        warn(`skill source not found: ${summarizePath(srcFile)} — skipping`);
        addSummary("missing", `Missing skill source ${summarizePath(srcFile)}`);
        continue;
      }

      const result = await ensureSymlink(srcDir, destDir);
      if (result === "skipped") {
        log(`${installTarget.label}: ${skill.id} already up to date`);
        addSummary("skipped", `Skipped existing symlink ${summarizePath(destDir)}`);
        continue;
      }

      log(`${installTarget.label}: ${result} ${summarizePath(destDir)} → ${summarizePath(srcDir)}`);
      addSummary(result, `${installTarget.label} ${result} symlink ${summarizePath(destDir)} → ${summarizePath(srcDir)}`);
    }
  }
}

async function installHooks() {
  header("Installing hooks");
  const srcDir = resolve(ROOT, "scripts", "hooks");
  await ensureDirWithSummary(CLAUDE_DIR);
  await ensureDirWithSummary(CLAUDE_HOOKS_DIR);

  if (!(await pathExists(srcDir))) {
    warn(`hook source not found: ${summarizePath(srcDir)} — skipping`);
    addSummary("missing", `Missing hook source ${summarizePath(srcDir)}`);
    return;
  }

  const entries = await readdir(srcDir);
  const hooks = entries.filter((file) => file.endsWith(".sh"));

  for (const hook of hooks) {
    const src = resolve(srcDir, hook);
    const dest = resolve(CLAUDE_HOOKS_DIR, hook);
    const result = await copyFileIfChanged(src, dest);
    if (result === "skipped") {
      log(`${hook} already up to date`);
      addSummary("skipped", `Skipped existing ${hook}`);
    } else {
      await chmod(dest, 0o755);
      log(`${result} ${hook} → ${summarizePath(dest)}`);
      addSummary(result, `${result} ${summarizePath(src)} → ${summarizePath(dest)}`);
    }
  }
}

async function findRepoTeamMetadata(dir = ROOT) {
  const candidates = [
    BUNDLED_TEAM_METADATA_PATH,
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

async function writeBundledTeamMetadata(dest) {
  const bundled = await readFile(BUNDLED_TEAM_METADATA_PATH, "utf8");
  const normalized = bundled.endsWith("\n") ? bundled : `${bundled}\n`;
  await writeFile(dest, normalized, "utf8");
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

  await writeBundledTeamMetadata(teamMetaPath);
  log(`Created bundled team metadata → ${summarizePath(teamMetaPath)}`);
  addSummary("created", `Created bundled metadata ${summarizePath(teamMetaPath)}`);
}

async function setupTeamJsonLink() {
  header("Linking team metadata");
  await ensureDirWithSummary(KUMA_DIR);

  const result = await ensureSymlink(BUNDLED_TEAM_METADATA_PATH, KUMA_TEAM_JSON_PATH);
  if (result === "skipped") {
    log(`${summarizePath(KUMA_TEAM_JSON_PATH)} already points to bundled team.json`);
    addSummary("skipped", `Skipped existing symlink ${summarizePath(KUMA_TEAM_JSON_PATH)}`);
    return;
  }

  log(`${result} ${summarizePath(KUMA_TEAM_JSON_PATH)} → ${summarizePath(BUNDLED_TEAM_METADATA_PATH)}`);
  addSummary(result, `${result} symlink ${summarizePath(KUMA_TEAM_JSON_PATH)} → ${summarizePath(BUNDLED_TEAM_METADATA_PATH)}`);
}

async function ensureProjectsRegistryEntry() {
  header("Registering projects.json");
  await ensureDirWithSummary(KUMA_DIR);

  let projects = {};
  if (await pathExists(KUMA_PROJECTS_PATH)) {
    try {
      projects = JSON.parse(await readFile(KUMA_PROJECTS_PATH, "utf8"));
    } catch {
      projects = {};
    }
  }

  const previous = typeof projects?.["kuma-studio"] === "string" ? resolve(projects["kuma-studio"]) : null;
  const next = resolve(ROOT);
  if (previous === next) {
    log(`${summarizePath(KUMA_PROJECTS_PATH)} already maps kuma-studio → ${summarizePath(next)}`);
    addSummary("skipped", `Skipped existing project mapping in ${summarizePath(KUMA_PROJECTS_PATH)}`);
    return;
  }

  const merged = {
    ...(projects && typeof projects === "object" && !Array.isArray(projects) ? projects : {}),
    "kuma-studio": next,
  };
  await writeFile(KUMA_PROJECTS_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  log(`Updated ${summarizePath(KUMA_PROJECTS_PATH)} with kuma-studio → ${summarizePath(next)}`);
  addSummary(previous ? "updated" : "created", `Registered kuma-studio in ${summarizePath(KUMA_PROJECTS_PATH)}`);
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

async function installCmux() {
  header("Installing cmux scripts");
  const srcDir = resolve(ROOT, "scripts", "cmux");
  await ensureDirWithSummary(KUMA_DIR);
  await ensureDirWithSummary(KUMA_CMUX_DIR);

  const entries = await readdir(srcDir);
  const scripts = entries.filter((f) => f.endsWith(".sh"));

  for (const script of scripts) {
    const src = resolve(srcDir, script);
    const dest = resolve(KUMA_CMUX_DIR, script);
    const result = await copyFileIfChanged(src, dest);
    if (result === "skipped") {
      log(`${script} already up to date`);
      addSummary("skipped", `Skipped existing ${script}`);
    } else {
      await chmod(dest, 0o755);
      log(`${result} ${script} → ${summarizePath(dest)}`);
      addSummary(result, `${result} ${summarizePath(src)} → ${summarizePath(dest)}`);
    }
  }
}

async function installBinScripts() {
  header("Installing kuma bin scripts");
  const srcDir = resolve(ROOT, "scripts", "bin");
  await ensureDirWithSummary(KUMA_DIR);
  await ensureDirWithSummary(KUMA_BIN_DIR);

  if (!(await pathExists(srcDir))) {
    warn(`bin source not found: ${summarizePath(srcDir)} — skipping`);
    addSummary("missing", `Missing bin source ${summarizePath(srcDir)}`);
    return;
  }

  const entries = await readdir(srcDir);
  const scripts = entries.filter((file) => file.endsWith(".sh") || !file.includes("."));

  for (const script of scripts) {
    const src = resolve(srcDir, script);
    const dest = resolve(KUMA_BIN_DIR, script);
    const result = await ensureSymlink(src, dest);
    if (result === "skipped") {
      log(`${script} already up to date`);
      addSummary("skipped", `Skipped existing ${script}`);
    } else {
      log(`${result} ${summarizePath(dest)} → ${summarizePath(src)}`);
      addSummary(result, `${result} symlink ${summarizePath(dest)} → ${summarizePath(src)}`);
    }
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
  for (const skillId of RETIRED_SKILL_IDS) {
    const key = `${skillId}@user-skills`;
    if (settings.enabledPlugins[key] != null) {
      delete settings.enabledPlugins[key];
      changed = true;
    }
  }

  for (const skill of SKILLS) {
    const key = `${skill.id}@user-skills`;
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
  await installSkills(flags);
  await installHooks();
  await installCmux();
  await installBinScripts();
  await ensureProjectsRegistryEntry();
  await setupTeamJsonLink();
  await setupStateDir();
  await registerSettings();
  buildStudio(flags);

  header("Installation complete!");
  process.stdout.write(`
  Quick start:
    1. Pick your top-level work root
    2. Start Kuma Studio against that workspace:
       cd /path/to/workspace-root
       KUMA_STUDIO_WORKSPACE="$PWD" npm run --prefix ${ROOT} server:reload
    3. Open the dashboard:
       npm run --prefix ${ROOT} kuma-studio:dashboard

  Skills installed:
${SKILLS.flatMap((s) => resolveSkillInstallTargets(flags).map((target) => `    ${target.label}: ${s.id}`)).join("\n")}

  Chrome extension:
    1. Open chrome://extensions
    2. Enable Developer Mode
    3. Load unpacked → ${resolve(ROOT, "packages/browser-extension")}

  PATH hint:
    export PATH="$HOME/.kuma/bin:$PATH"

`);

  printSummary();
}

main().catch((err) => {
  process.stderr.write(`\n❌ Error: ${err.message}\n`);
  process.exitCode = 1;
});
