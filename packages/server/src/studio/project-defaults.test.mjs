import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  getConfiguredDefaultProjectId,
  getDefaultProjectIdForTeam,
  inferProjectIdFromSlugPrefix,
  normalizePackageNameToProjectId,
  readPackageProjectId,
  resolveProjectIdFromDirectory,
} from "./project-defaults.mjs";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("project-defaults", () => {
  it("normalizes scoped package names into plain project ids", () => {
    expect(normalizePackageNameToProjectId("@kuma-studio/server")).toBe("server");
    expect(normalizePackageNameToProjectId("kuma-studio")).toBe("kuma-studio");
  });

  it("resolves the closest registered project from a directory", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-project-defaults-"));
    const workspace = join(root, "workspace");
    const studio = join(workspace, "kuma-studio");
    const app = join(workspace, "apps", "example-app");
    const nested = join(app, "packages", "web");
    const projectsPath = join(root, "projects.json");

    mkdirSync(studio, { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeJson(projectsPath, {
      "kuma-studio": studio,
      "example-app": app,
    });

    expect(resolveProjectIdFromDirectory(nested, projectsPath)).toBe("example-app");
    expect(resolveProjectIdFromDirectory(studio, projectsPath)).toBe("kuma-studio");
  });

  it("falls back to the package name when no registry match exists", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-project-defaults-"));
    const repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    writeJson(join(repo, "package.json"), { name: "sample-app" });

    expect(readPackageProjectId(repo)).toBe("sample-app");
    expect(getConfiguredDefaultProjectId({ cwd: repo, projectsPath: join(root, "missing.json") })).toBe("sample-app");
  });

  it("returns workspace for non-system teams when nothing is discoverable", () => {
    expect(getDefaultProjectIdForTeam("dev", {
      cwd: join(tmpdir(), "does-not-exist"),
      workspaceRoot: join(tmpdir(), "does-not-exist"),
      projectsPath: join(tmpdir(), "does-not-exist", "projects.json"),
    })).toBe("workspace");
    expect(getDefaultProjectIdForTeam("system")).toBe("system");
  });

  it("matches slug prefixes against registered project ids", () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-project-defaults-"));
    const workspace = join(root, "workspace");
    const studio = join(workspace, "kuma-studio");
    const exampleApp = join(workspace, "example-app");
    const projectsPath = join(root, "projects.json");

    mkdirSync(studio, { recursive: true });
    mkdirSync(exampleApp, { recursive: true });
    writeJson(projectsPath, {
      "kuma-studio": studio,
      "example-app": exampleApp,
    });

    expect(inferProjectIdFromSlugPrefix("example-app-20260412-001", { projectsPath })).toBe("example-app");
    expect(inferProjectIdFromSlugPrefix("kuma-studio-20260412-001", { projectsPath })).toBe("kuma-studio");
  });
});
