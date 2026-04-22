import { lstat, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  bootstrapPrivateRepo,
  inspectPrivateRepoLinks,
  PRIVATE_REPO_NAME,
} from "./private-repo-bootstrap.mjs";

const tempRoots = [];

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

describe("private-repo-bootstrap", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("bootstraps an empty private repo by copying canonical local data and relinking ~/.kuma", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "kuma-private-bootstrap-")));
    tempRoots.push(root);

    const repoRoot = join(root, "kuma-studio");
    const targetDir = join(root, PRIVATE_REPO_NAME);
    const kumaHomeDir = join(root, ".kuma");
    await mkdir(repoRoot, { recursive: true });
    await mkdir(join(kumaHomeDir, "vault"), { recursive: true });
    await mkdir(join(kumaHomeDir, "plans"), { recursive: true });
    await mkdir(join(kumaHomeDir, "runtime"), { recursive: true });
    await mkdir(join(kumaHomeDir, "dispatch"), { recursive: true });
    await mkdir(join(kumaHomeDir, "cmux"), { recursive: true });
    await writeFile(join(kumaHomeDir, "vault", "index.md"), "# live vault\n", "utf8");
    await writeFile(join(kumaHomeDir, "plans", "index.md"), "# live plans\n", "utf8");
    await writeFile(join(kumaHomeDir, "team.json"), '{"teams":{"system":{"members":[]}}}\n', "utf8");
    await writeFile(join(kumaHomeDir, "runtime", "state.json"), "{}\n", "utf8");
    await writeFile(join(kumaHomeDir, "dispatch", "task.result.md"), "sensitive\n", "utf8");
    await writeFile(join(kumaHomeDir, "projects.json"), '{"private":true}\n', "utf8");

    const result = await bootstrapPrivateRepo({
      repoRoot,
      targetDir,
      kumaHomeDir,
      now: new Date("2026-04-23T00:00:00.000Z"),
    });

    expect(result.targetWasPopulated).toBe(false);
    expect(await pathExists(join(targetDir, ".git"))).toBe(true);
    expect(await readFile(join(targetDir, "vault", "index.md"), "utf8")).toContain("live vault");
    expect(await readFile(join(targetDir, "plans", "index.md"), "utf8")).toContain("live plans");
    expect(await readFile(join(targetDir, "team.json"), "utf8")).toContain('"system"');
    expect(await pathExists(join(targetDir, "runtime"))).toBe(false);
    expect(await pathExists(join(targetDir, "dispatch"))).toBe(false);
    expect(await pathExists(join(targetDir, "cmux"))).toBe(false);
    expect(await pathExists(join(targetDir, "projects.json"))).toBe(false);

    const inspection = await inspectPrivateRepoLinks({ kumaHomeDir });
    expect(inspection.ok).toBe(true);
    expect(inspection.sharedRepoRoot).toBe(resolve(targetDir));

    const vaultStats = await lstat(join(kumaHomeDir, "vault"));
    const plansStats = await lstat(join(kumaHomeDir, "plans"));
    const teamStats = await lstat(join(kumaHomeDir, "team.json"));
    expect(vaultStats.isSymbolicLink()).toBe(true);
    expect(plansStats.isSymbolicLink()).toBe(true);
    expect(teamStats.isSymbolicLink()).toBe(true);

    expect(result.backups).toHaveLength(3);
    expect(await pathExists(join(result.backupRoot, "vault"))).toBe(true);
    expect(await pathExists(join(result.backupRoot, "plans"))).toBe(true);
    expect(await pathExists(join(result.backupRoot, "team.json"))).toBe(true);
  });

  it("keeps an existing populated private repo authoritative and does not overwrite it", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "kuma-private-bootstrap-")));
    tempRoots.push(root);

    const repoRoot = join(root, "kuma-studio");
    const targetDir = join(root, PRIVATE_REPO_NAME);
    const kumaHomeDir = join(root, ".kuma");
    await mkdir(repoRoot, { recursive: true });
    await mkdir(join(targetDir, "vault"), { recursive: true });
    await mkdir(join(targetDir, "plans"), { recursive: true });
    await writeFile(join(targetDir, "vault", "index.md"), "# private repo wins\n", "utf8");
    await writeFile(join(targetDir, "plans", "index.md"), "# private plans\n", "utf8");
    await writeFile(join(targetDir, "team.json"), '{"owner":"private-repo"}\n', "utf8");

    await mkdir(join(kumaHomeDir, "vault"), { recursive: true });
    await mkdir(join(kumaHomeDir, "plans"), { recursive: true });
    await writeFile(join(kumaHomeDir, "vault", "index.md"), "# live local copy\n", "utf8");
    await writeFile(join(kumaHomeDir, "plans", "index.md"), "# live local plans\n", "utf8");
    await writeFile(join(kumaHomeDir, "team.json"), '{"owner":"local-copy"}\n', "utf8");

    const result = await bootstrapPrivateRepo({
      repoRoot,
      targetDir,
      kumaHomeDir,
      now: new Date("2026-04-23T00:00:00.000Z"),
    });

    expect(result.targetWasPopulated).toBe(true);
    expect(result.copied).toEqual([]);
    expect(await readFile(join(targetDir, "vault", "index.md"), "utf8")).toContain("private repo wins");
    expect(await readFile(join(targetDir, "plans", "index.md"), "utf8")).toContain("private plans");
    expect(await readFile(join(targetDir, "team.json"), "utf8")).toContain("private-repo");

    const inspection = await inspectPrivateRepoLinks({ kumaHomeDir });
    expect(inspection.ok).toBe(true);
    expect(inspection.sharedRepoRoot).toBe(resolve(targetDir));
    expect(await pathExists(join(result.backupRoot, "vault"))).toBe(true);
  });

  it("rejects nesting the private repo inside the public repo", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "kuma-private-bootstrap-")));
    tempRoots.push(root);

    const repoRoot = join(root, "kuma-studio");
    await mkdir(repoRoot, { recursive: true });

    await expect(
      bootstrapPrivateRepo({
        repoRoot,
        targetDir: join(repoRoot, PRIVATE_REPO_NAME),
        kumaHomeDir: join(root, ".kuma"),
      }),
    ).rejects.toThrow(/outside the public repo/u);
  });

  it("reports non-symlink canonical entries as drift", async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "kuma-private-bootstrap-")));
    tempRoots.push(root);

    const kumaHomeDir = join(root, ".kuma");
    await mkdir(join(kumaHomeDir, "vault"), { recursive: true });
    await mkdir(join(kumaHomeDir, "plans"), { recursive: true });
    await writeFile(join(kumaHomeDir, "team.json"), '{"teams":{}}\n', "utf8");

    const inspection = await inspectPrivateRepoLinks({ kumaHomeDir });
    expect(inspection.ok).toBe(false);
    expect(inspection.items.map((item) => item.status)).toEqual([
      "not-symlink",
      "not-symlink",
      "not-symlink",
    ]);
  });
});
