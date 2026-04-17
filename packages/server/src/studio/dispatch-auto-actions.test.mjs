import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDispatchAutoActions, __private__ } from "./dispatch-auto-actions.mjs";

const { resolveNoeuriSurface, dispatchNoeuriTrigger } = __private__;

async function createTaskFile(taskPath, overrides = {}) {
  const fm = {
    id: "tookdaki-20260413-045000",
    project: "kuma-studio",
    worker: "surface:37",
    qa: "surface:39",
    signal: "kuma-studio-autoaction-done",
    result: "/tmp/kuma-results/autoaction.result.md",
    plan: "/tmp/kuma-plans/autoaction.md",
    thread_id: "discord:thread-autoaction",
    session_id: "workspace:1/surface:1",
    channel_id: "discord:thread-autoaction",
    ...overrides,
  };
  const frontmatter = Object.entries(fm)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  await writeFile(
    taskPath,
    `---\n${frontmatter}\n---\n`,
    "utf8",
  );
  return fm;
}

async function writeTeamJson(teamJsonPath) {
  await writeFile(
    teamJsonPath,
    `${JSON.stringify({
      teams: {
        system: {
          name: "시스템",
          members: [
            { id: "noeuri", name: "노을이", emoji: "🦌", team: "system" },
          ],
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

async function writeSurfaceRegistry(registryPath) {
  await writeFile(
    registryPath,
    `${JSON.stringify({
      "kuma-studio": { "🦌 노을이": "surface:46" },
    }, null, 2)}\n`,
    "utf8",
  );
}

describe("runDispatchAutoActions", { timeout: 10000 }, () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("returns null ingest/noeuri when the event is not qa-passed", async () => {
    const result = await runDispatchAutoActions({
      event: "dispatched",
      taskFile: "/nonexistent",
    });
    expect(result).toEqual({ ingest: null, noeuri: null });
  });

  it("returns null ingest/noeuri when the task file cannot be parsed", async () => {
    const result = await runDispatchAutoActions({
      event: "qa-passed",
      taskFile: "/nonexistent.task.md",
    });
    expect(result).toEqual({ ingest: null, noeuri: null });
  });

  it("skips ingest when the task has no result file and does not trigger noeuri", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-auto-actions-"));
    tempRoots.push(root);
    const taskPath = join(root, "noresult.task.md");
    await createTaskFile(taskPath, { result: "" });

    const noeuriCalls = [];
    const result = await runDispatchAutoActions({
      event: "qa-passed",
      taskFile: taskPath,
      repoRoot: root,
      taskDir: join(root, "tasks"),
      stampDir: join(root, "stamps"),
      signalDir: join(root, "signals"),
      resultDir: join(root, "results"),
      teamJsonPath: join(root, "team.json"),
      registryPath: join(root, "surfaces.json"),
      sendScriptPath: join(root, "missing-send.sh"),
      userMemoDir: join(root, "user-memo"),
      execFile: async (...args) => {
        noeuriCalls.push(args);
        return { stdout: "", stderr: "" };
      },
    });

    expect(result.ingest).toBeNull();
    expect(result.noeuri).toBeNull();
    expect(noeuriCalls).toHaveLength(0);
  });

  it("resolveNoeuriSurface locates the Noeuri member surface from team.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-auto-actions-"));
    tempRoots.push(root);
    const teamJsonPath = join(root, "team.json");
    const registryPath = join(root, "surfaces.json");
    await writeTeamJson(teamJsonPath);
    await writeSurfaceRegistry(registryPath);

    const surface = resolveNoeuriSurface({
      project: "kuma-studio",
      teamJsonPath,
      registryPath,
    });
    expect(surface).toBe("surface:46");
  });

  it("resolveNoeuriSurface returns empty when team.json is missing", () => {
    const surface = resolveNoeuriSurface({
      project: "kuma-studio",
      teamJsonPath: "/nonexistent/team.json",
      registryPath: "/nonexistent/surfaces.json",
    });
    expect(surface).toBe("");
  });

  it("dispatchNoeuriTrigger invokes execFile with a prompt pointing at the canonical dispatch-status command", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-auto-actions-"));
    tempRoots.push(root);

    const taskPath = join(root, "trigger.task.md");
    const taskDir = join(root, "tasks");
    const resultDir = join(root, "results");
    const signalDir = join(root, "signals");
    const userMemoDir = join(root, "user-memo");
    const sendScriptPath = join(root, "kuma-cmux-send.sh");
    const teamJsonPath = join(root, "team.json");
    const registryPath = join(root, "surfaces.json");

    await mkdir(taskDir, { recursive: true });
    await writeFile(sendScriptPath, "#!/bin/bash\nexit 0\n", "utf8");
    await writeTeamJson(teamJsonPath);
    await writeSurfaceRegistry(registryPath);

    const fm = await createTaskFile(taskPath, {
      id: "kuma-task-allowlist-noeuri-phase4",
      plan: join(root, ".kuma", "plans", "kuma-studio", "kuma-cli-unification.md"),
    });
    const task = { id: fm.id, project: fm.project, plan: fm.plan, taskFile: taskPath };

    const calls = [];
    const result = await dispatchNoeuriTrigger({
      task,
      resultFile: fm.result,
      repoRoot: root,
      signalDir,
      resultDir,
      teamJsonPath,
      registryPath,
      sendScriptPath,
      userMemoDir,
      execFile: async (cmd, args) => {
        calls.push({ cmd, args });
        return { stdout: "", stderr: "" };
      },
    });

    expect(result).toMatchObject({
      status: "dispatched",
      surface: "surface:46",
      taskId: "kuma-task-allowlist-noeuri-phase4",
      signal: "noeuri-auto-kuma-task-allowlist-noeuri-phase4-done",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("bash");
    const [scriptPath, surface, prompt] = calls[0].args;
    expect(scriptPath).toBe(sendScriptPath);
    expect(surface).toBe("surface:46");
    expect(prompt).toContain("task: kuma-task-allowlist-noeuri-phase4");
    expect(prompt).toContain(`plan: ${fm.plan}`);
    expect(prompt).toContain(`npm run --silent --prefix ${root} kuma-studio -- dispatch-status --task-file ${taskPath}`);
    expect(prompt).toContain("broker messages as SSOT");
    expect(prompt).toContain("dispatch-log.md is a derived append-only ledger only");
    expect(prompt).toContain(`${root}/skills/noeuri/SKILL.md`);
    expect(prompt).toContain("protected user-memo read-only notebook");
    expect(prompt).toContain(userMemoDir);
    expect(prompt).toContain(`${resultDir}/noeuri-audit-kuma-task-allowlist-noeuri-phase4.result.md`);
    expect(prompt).toContain(`${signalDir}/noeuri-auto-kuma-task-allowlist-noeuri-phase4-done`);
  });

  it("dispatchNoeuriTrigger skips when the send script is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-auto-actions-"));
    tempRoots.push(root);
    const teamJsonPath = join(root, "team.json");
    const registryPath = join(root, "surfaces.json");
    await writeTeamJson(teamJsonPath);
    await writeSurfaceRegistry(registryPath);

    const calls = [];
    const result = await dispatchNoeuriTrigger({
      task: { id: "demo", project: "kuma-studio", plan: "", taskFile: "/tmp/x.task.md" },
      resultFile: "/tmp/x.result.md",
      repoRoot: root,
      signalDir: join(root, "signals"),
      resultDir: join(root, "results"),
      teamJsonPath,
      registryPath,
      sendScriptPath: join(root, "missing.sh"),
      userMemoDir: join(root, "user-memo"),
      execFile: async (...args) => {
        calls.push(args);
        return { stdout: "", stderr: "" };
      },
    });

    expect(result).toEqual({ status: "skipped", reason: "missing-send-script" });
    expect(calls).toHaveLength(0);
  });
});
