#!/usr/bin/env node

import { existsSync, realpathSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

function resolveMaybeRealPath(targetPath) {
  const normalized = resolve(targetPath);
  try {
    return realpathSync(normalized);
  } catch {
    return normalized;
  }
}

function readProjectRoots() {
  const projectsPath = resolve(join(homedir(), ".kuma", "projects.json"));
  if (!existsSync(projectsPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(projectsPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }

    return Object.values(parsed)
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => resolveMaybeRealPath(value.trim()));
  } catch {
    return [];
  }
}

function commonAncestor(paths) {
  const [first, ...rest] = paths;
  if (!first) {
    return null;
  }

  let candidate = first;
  while (candidate && candidate !== dirname(candidate)) {
    if (rest.every((entry) => entry === candidate || entry.startsWith(`${candidate}${sep}`))) {
      return candidate;
    }
    candidate = dirname(candidate);
  }

  return candidate || null;
}

const explicit = process.env.KUMA_STUDIO_DEFAULT_WORKSPACE?.trim();
if (explicit) {
  process.stdout.write(resolveMaybeRealPath(explicit));
  process.exit(0);
}

const roots = readProjectRoots();
const workspaceRoot = commonAncestor(roots);
if (!workspaceRoot) {
  console.error("KUMA_STUDIO_WORKSPACE is required: set it explicitly or register project roots in ~/.kuma/projects.json.");
  process.exit(2);
}

process.stdout.write(resolveMaybeRealPath(workspaceRoot));
