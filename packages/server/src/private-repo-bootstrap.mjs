import { execFile as execFileCallback } from "node:child_process";
import { access, copyFile, cp, lstat, mkdir, readdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { DEFAULT_KUMA_HOME_DIR } from "./kuma-paths.mjs";

const execFile = promisify(execFileCallback);
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(MODULE_DIR, "../../..");
export const PRIVATE_REPO_NAME = "kuma-studio-private";
const BUNDLED_TEAM_TEMPLATE_PATH = resolve(REPO_ROOT, "packages", "shared", "team.json");
const DIRECTORY_ENTRY_IGNORES = new Set([".git", ".DS_Store"]);

const CANONICAL_ENTRY_SPECS = [
  {
    id: "vault",
    kind: "dir",
    sourcePath: (kumaHomeDir) => join(kumaHomeDir, "vault"),
    targetPath: (privateRepoDir) => join(privateRepoDir, "vault"),
  },
  {
    id: "plans",
    kind: "dir",
    sourcePath: (kumaHomeDir) => join(kumaHomeDir, "plans"),
    targetPath: (privateRepoDir) => join(privateRepoDir, "plans"),
  },
  {
    id: "team.json",
    kind: "file",
    sourcePath: (kumaHomeDir) => join(kumaHomeDir, "team.json"),
    targetPath: (privateRepoDir) => join(privateRepoDir, "team.json"),
  },
];

export function resolveDefaultPrivateRepoDir(repoRoot = REPO_ROOT) {
  return resolve(repoRoot, "..", PRIVATE_REPO_NAME);
}

export function resolveKumaHomePaths(kumaHomeDir = DEFAULT_KUMA_HOME_DIR) {
  const rootDir = resolve(kumaHomeDir);
  return {
    rootDir,
    vaultDir: join(rootDir, "vault"),
    plansDir: join(rootDir, "plans"),
    teamJsonPath: join(rootDir, "team.json"),
    runtimeDir: join(rootDir, "runtime"),
    dispatchDir: join(rootDir, "dispatch"),
    cmuxDir: join(rootDir, "cmux"),
    projectsJsonPath: join(rootDir, "projects.json"),
  };
}

export function resolvePrivateRepoPaths(targetDir) {
  const rootDir = resolve(targetDir);
  return {
    rootDir,
    vaultDir: join(rootDir, "vault"),
    plansDir: join(rootDir, "plans"),
    teamJsonPath: join(rootDir, "team.json"),
    readmePath: join(rootDir, "README.md"),
    gitignorePath: join(rootDir, ".gitignore"),
  };
}

function formatBackupStamp(now = new Date()) {
  return now
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z")
    .replace("T", "-");
}

function resolveExpectedRepoRoot(targetPath) {
  return dirname(resolve(targetPath));
}

function resolveLinkTarget(sourcePath, linkTarget) {
  return isAbsolute(linkTarget)
    ? resolve(linkTarget)
    : resolve(dirname(sourcePath), linkTarget);
}

export function isPathWithin(parentDir, candidatePath) {
  const relativePath = relative(resolve(parentDir), resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.startsWith(`..${requirePathSep()}`) && !isAbsolute(relativePath))
  );
}

function requirePathSep() {
  return process.platform === "win32" ? "\\" : "/";
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function lstatOrNull(targetPath) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function directoryHasUserContent(dirPath) {
  const stats = await lstatOrNull(dirPath);
  if (!stats?.isDirectory()) {
    return false;
  }
  const entries = await readdir(dirPath);
  return entries.some((entry) => !DIRECTORY_ENTRY_IGNORES.has(entry));
}

async function copyCanonicalEntry(sourcePath, targetPath, kind) {
  await mkdir(dirname(targetPath), { recursive: true });
  if (kind === "dir") {
    await cp(sourcePath, targetPath, { recursive: true, force: false });
    return;
  }
  await copyFile(sourcePath, targetPath);
}

async function ensureGitRepo(targetDir, { runCommand = execFile } = {}) {
  const gitDir = join(targetDir, ".git");
  if (await pathExists(gitDir)) {
    return false;
  }
  await runCommand("git", ["init", targetDir]);
  return true;
}

function privateRepoReadme() {
  return `# ${PRIVATE_REPO_NAME}

Private canonical brain repo for Kuma Studio.

Tracked here:
- vault/
- plans/
- team.json

Do not track here:
- runtime/
- dispatch/
- cmux/
- projects.json
- secrets / .env*

This repo is the canonical owner of your operator knowledge. Public \`kuma-studio\`
reads and serves this data, but does not own it.
`;
}

function privateRepoGitignore() {
  return `# Machine-local runtime and secrets stay outside the private brain repo.
.DS_Store
.env
.env.*
runtime/
dispatch/
cmux/
projects.json
`;
}

async function writeFileIfMissing(filePath, content) {
  if (await pathExists(filePath)) {
    return false;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return true;
}

async function ensurePrivateRepoScaffold(targetDir, summary) {
  const privatePaths = resolvePrivateRepoPaths(targetDir);
  for (const dirPath of [privatePaths.vaultDir, privatePaths.plansDir]) {
    if (await pathExists(dirPath)) {
      continue;
    }
    await mkdir(dirPath, { recursive: true });
    summary.scaffolded.push(dirPath);
  }

  if (!(await pathExists(privatePaths.teamJsonPath))) {
    const bundledTeamTemplate = await readFile(BUNDLED_TEAM_TEMPLATE_PATH, "utf8");
    await writeFile(privatePaths.teamJsonPath, bundledTeamTemplate, "utf8");
    summary.scaffolded.push(privatePaths.teamJsonPath);
  }

  if (await writeFileIfMissing(privatePaths.gitignorePath, privateRepoGitignore())) {
    summary.scaffolded.push(privatePaths.gitignorePath);
  }

  if (await writeFileIfMissing(privatePaths.readmePath, privateRepoReadme())) {
    summary.scaffolded.push(privatePaths.readmePath);
  }
}

async function seedTargetFromLocalSources({ targetDir, kumaHomeDir, targetWasPopulated, summary }) {
  if (targetWasPopulated) {
    return;
  }

  for (const spec of CANONICAL_ENTRY_SPECS) {
    const sourcePath = spec.sourcePath(kumaHomeDir);
    const targetPath = spec.targetPath(targetDir);
    if (!(await pathExists(sourcePath))) {
      continue;
    }
    if (await pathExists(targetPath)) {
      continue;
    }
    await copyCanonicalEntry(sourcePath, targetPath, spec.kind);
    summary.copied.push({ id: spec.id, sourcePath, targetPath });
  }
}

async function relinkCanonicalEntries({ targetDir, kumaHomeDir, now, summary }) {
  const backupRoot = join(
    kumaHomeDir,
    "backups",
    "private-bootstrap",
    formatBackupStamp(now),
  );
  let backupRootCreated = false;

  for (const spec of CANONICAL_ENTRY_SPECS) {
    const sourcePath = spec.sourcePath(kumaHomeDir);
    const targetPath = spec.targetPath(targetDir);
    const currentStats = await lstatOrNull(sourcePath);

    if (currentStats?.isSymbolicLink()) {
      const existingLink = await readlink(sourcePath);
      if (resolveLinkTarget(sourcePath, existingLink) === resolve(targetPath)) {
        summary.linked.push({ id: spec.id, sourcePath, targetPath, status: "skipped" });
        continue;
      }
      await rm(sourcePath, { force: true, recursive: true });
    } else if (currentStats) {
      if (!backupRootCreated) {
        await mkdir(backupRoot, { recursive: true });
        backupRootCreated = true;
        summary.backupRoot = backupRoot;
      }
      const backupPath = join(backupRoot, basename(sourcePath));
      await rename(sourcePath, backupPath);
      summary.backups.push({ id: spec.id, sourcePath, backupPath });
    }

    await mkdir(dirname(sourcePath), { recursive: true });
    await symlink(resolve(targetPath), sourcePath);
    summary.linked.push({
      id: spec.id,
      sourcePath,
      targetPath,
      status: currentStats ? "updated" : "created",
    });
  }
}

export async function inspectPrivateRepoLinks({ kumaHomeDir = DEFAULT_KUMA_HOME_DIR } = {}) {
  const items = [];

  for (const spec of CANONICAL_ENTRY_SPECS) {
    const sourcePath = spec.sourcePath(kumaHomeDir);
    const targetLeaf = basename(spec.targetPath("/private-root"));
    const currentStats = await lstatOrNull(sourcePath);

    if (!currentStats) {
      items.push({
        id: spec.id,
        sourcePath,
        exists: false,
        isSymlink: false,
        status: "missing",
        targetPath: null,
        repoRoot: null,
      });
      continue;
    }

    if (!currentStats.isSymbolicLink()) {
      items.push({
        id: spec.id,
        sourcePath,
        exists: true,
        isSymlink: false,
        status: "not-symlink",
        targetPath: null,
        repoRoot: null,
      });
      continue;
    }

    const rawTarget = await readlink(sourcePath);
    const targetPath = resolveLinkTarget(sourcePath, rawTarget);
    const repoRoot = resolveExpectedRepoRoot(targetPath);
    const targetLeafMatches = basename(targetPath) === targetLeaf;
    const pointsToCanonicalPrivateRepo = targetLeafMatches && basename(repoRoot) === PRIVATE_REPO_NAME;

    items.push({
      id: spec.id,
      sourcePath,
      exists: true,
      isSymlink: true,
      status: pointsToCanonicalPrivateRepo ? "ok" : "unexpected-target",
      targetPath,
      repoRoot,
      targetLeafMatches,
      pointsToCanonicalPrivateRepo,
    });
  }

  const repoRoots = Array.from(
    new Set(items.map((item) => item.repoRoot).filter(Boolean)),
  );
  const sharedRepoRoot = repoRoots.length === 1 ? repoRoots[0] : null;

  return {
    items,
    sharedRepoRoot,
    ok:
      items.every((item) => item.status === "ok") &&
      Boolean(sharedRepoRoot) &&
      basename(sharedRepoRoot) === PRIVATE_REPO_NAME,
  };
}

export async function bootstrapPrivateRepo({
  repoRoot = REPO_ROOT,
  targetDir = resolveDefaultPrivateRepoDir(repoRoot),
  kumaHomeDir = DEFAULT_KUMA_HOME_DIR,
  now = new Date(),
  runCommand = execFile,
} = {}) {
  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedTargetDir = resolve(targetDir);
  const resolvedKumaHomeDir = resolve(kumaHomeDir);

  if (isPathWithin(resolvedRepoRoot, resolvedTargetDir)) {
    throw new Error(
      `Private repo path must stay outside the public repo. Received ${resolvedTargetDir}`,
    );
  }

  await mkdir(resolvedTargetDir, { recursive: true });

  const summary = {
    repoRoot: resolvedRepoRoot,
    targetDir: resolvedTargetDir,
    kumaHomeDir: resolvedKumaHomeDir,
    targetWasPopulated: await directoryHasUserContent(resolvedTargetDir),
    gitInitialized: false,
    copied: [],
    scaffolded: [],
    backups: [],
    linked: [],
    backupRoot: null,
  };

  summary.gitInitialized = await ensureGitRepo(resolvedTargetDir, { runCommand });
  await seedTargetFromLocalSources({
    targetDir: resolvedTargetDir,
    kumaHomeDir: resolvedKumaHomeDir,
    targetWasPopulated: summary.targetWasPopulated,
    summary,
  });
  await ensurePrivateRepoScaffold(resolvedTargetDir, summary);
  await relinkCanonicalEntries({
    targetDir: resolvedTargetDir,
    kumaHomeDir: resolvedKumaHomeDir,
    now,
    summary,
  });

  return summary;
}

