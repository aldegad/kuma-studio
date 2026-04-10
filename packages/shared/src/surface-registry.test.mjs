import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildRegistryLabel,
  normalizeSurfaceRegistry,
  removeSurfaceFromRegistry,
  resolveProjectAnchorSurface,
  resolveRegistryMemberContext,
  updateRegistryMemberSurface,
} from "../surface-registry.mjs";

const execFile = promisify(execFileCallback);
const SURFACE_REGISTRY_CLI_PATH = resolve(process.cwd(), "packages/shared/surface-registry-cli.mjs");

async function writeRegistry(root, value) {
  const registryPath = join(root, "surfaces.json");
  await writeFile(registryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return registryPath;
}

describe("shared surface registry", () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("converges duplicate member labels into a single canonical mapping", () => {
    const next = updateRegistryMemberSurface(
      {
        alpha: {
          하울: "surface:10",
          "🐺 하울": "surface:11",
        },
        beta: {
          "🐺 하울": "surface:12",
        },
      },
      {
        projectId: "alpha",
        memberName: "하울",
        emoji: "🐺",
        surface: "surface:31",
      },
    );

    expect(next).toEqual({
      alpha: {
        "🐺 하울": "surface:31",
      },
    });
  });

  it("resolves a member context from requested project and shell member json fields", () => {
    const registry = normalizeSurfaceRegistry({
      system: {
        "🐻 쿠마": "surface:1",
      },
      smoke: {
        "🐺 하울": "surface:31",
      },
    });

    expect(
      resolveRegistryMemberContext(registry, {
        displayName: "하울",
        emoji: "🐺",
        id: "howl",
        team: "dev",
      }, "smoke"),
    ).toEqual({
      project: "smoke",
      label: "🐺 하울",
      surface: "surface:31",
    });
  });

  it("removes stale surfaces and resolves anchor surfaces deterministically", () => {
    const registry = removeSurfaceFromRegistry({
      smoke: {
        "🐺 하울": "surface:31",
        "🦫 뚝딱이": "surface:32",
      },
    }, "surface:31");

    expect(registry).toEqual({
      smoke: {
        "🦫 뚝딱이": "surface:32",
      },
    });
    expect(resolveProjectAnchorSurface(registry, "smoke")).toBe("surface:32");
    expect(buildRegistryLabel("하울", "🐺")).toBe("🐺 하울");
  });

  it("CLI bridge updates, resolves, and removes registry entries through the shared module", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-surface-registry-"));
    tempRoots.push(root);

    const registryPath = await writeRegistry(root, {
      smoke: {
        "🦫 뚝딱이": "surface:32",
      },
    });
    const member = JSON.stringify({
      displayName: "하울",
      emoji: "🐺",
      id: "howl",
      team: "dev",
    });

    await execFile("node", [
      SURFACE_REGISTRY_CLI_PATH,
      "upsert-label-surface",
      registryPath,
      "smoke",
      "🐺 하울",
      "surface:31",
    ]);

    const { stdout: contextJson } = await execFile("node", [
      SURFACE_REGISTRY_CLI_PATH,
      "resolve-member-context",
      registryPath,
      "smoke",
      member,
    ]);
    expect(JSON.parse(contextJson)).toEqual({
      project: "smoke",
      label: "🐺 하울",
      surface: "surface:31",
    });

    const { stdout: anchorSurface } = await execFile("node", [
      SURFACE_REGISTRY_CLI_PATH,
      "resolve-project-anchor-surface",
      registryPath,
      "smoke",
    ]);
    expect(anchorSurface.trim()).toBe("surface:32");

    await execFile("node", [
      SURFACE_REGISTRY_CLI_PATH,
      "remove-surface",
      registryPath,
      "surface:31",
      "smoke",
    ]);

    const persisted = JSON.parse(await readFile(registryPath, "utf8"));
    expect(persisted).toEqual({
      smoke: {
        "🦫 뚝딱이": "surface:32",
      },
    });
  });
});
