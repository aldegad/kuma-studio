import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = path.join(repoRoot, "example", "next-host");
const runtimeSourceDir = path.join(repoRoot, "node_modules");
const runtimeTargetDir = path.join(repoRoot, "web", "node_modules");

function tryReadLinkTarget(targetPath) {
  try {
    const stat = lstatSync(targetPath);
    if (!stat.isSymbolicLink()) {
      return null;
    }

    return path.resolve(path.dirname(targetPath), readlinkSync(targetPath));
  } catch {
    return null;
  }
}

function ensureDirectoryLink(sourceDir, targetDir, label) {
  mkdirSync(path.dirname(targetDir), { recursive: true });

  const currentLink = tryReadLinkTarget(targetDir);
  if (currentLink === sourceDir) {
    return false;
  }

  try {
    lstatSync(targetDir);
    rmSync(targetDir, { force: true, recursive: true });
  } catch {
    // Ignore missing target path.
  }

  const relativeSource = path.relative(path.dirname(targetDir), sourceDir);
  try {
    symlinkSync(relativeSource, targetDir, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
      throw error;
    }

    if (tryReadLinkTarget(targetDir) !== sourceDir) {
      throw error;
    }
  }

  process.stdout.write(`kuma-picker ${label} link ready: ${targetDir} -> ${relativeSource}\n`);
  return true;
}

function removeLegacyPath(targetPath) {
  try {
    lstatSync(targetPath);
  } catch {
    return;
  }

  rmSync(targetPath, { force: true, recursive: true });
}

try {
  lstatSync(runtimeSourceDir);
} catch {
  process.stdout.write("kuma-picker runtime link skipped: root node_modules not found\n");
  process.exit(0);
}

removeLegacyPath(path.join(exampleRoot, "vendor", "kuma-picker"));

ensureDirectoryLink(runtimeSourceDir, runtimeTargetDir, "runtime");
