import { assert, describe, it } from "vitest";

import { classifySurfaceStatus } from "../../../shared/surface-classifier.mjs";
import {
  buildTeamStatusSnapshot,
  isRetryableCmuxSocketFailure,
  isSurfaceNotFoundOutput,
  mapSurfaceStatusToStudioState,
  parseModelInfo,
  parseLiveSurfacesFromCmuxTree,
  parseRegistryLabel,
  readSurfaceWithHealing,
  reconcileRegistryWithCmuxTree,
  TeamStatusStore,
  toStudioTeamStatusSnapshot,
} from "./team-status-store.mjs";

async function waitFor(assertion, timeoutMs = 1_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function getStudioProject(snapshot, projectId) {
  return snapshot.projects.find((project) => project.projectId === projectId);
}

function getStudioProjectMember(snapshot, projectId, memberId) {
  return getStudioProject(snapshot, projectId)?.members.find((member) => member.id === memberId);
}

describe("team-status-store", () => {
  it("parses registry labels into emoji and display name", () => {
    assert.deepEqual(parseRegistryLabel("🦫 뚝딱이"), {
      name: "뚝딱이",
      emoji: "🦫",
      text: "🦫 뚝딱이",
    });
  });

  it("classifies prompt-only output as idle", () => {
    assert.strictEqual(classifySurfaceStatus("❯"), "idle");
  });

  it("classifies active execution output as working", () => {
    assert.strictEqual(classifySurfaceStatus("Working on packages/server...\nApplying patch"), "working");
    assert.strictEqual(classifySurfaceStatus("Working on packages/server...\nApplying patch\n❯"), "idle");
  });

  it("classifies completion banners as idle", () => {
    assert.strictEqual(classifySurfaceStatus("✻ Baked for 6m 35s\n❯"), "idle");
    assert.strictEqual(classifySurfaceStatus("✻ Brewed for 45s"), "idle");
  });

  it("keeps active spinner lines as working only while no prompt is visible", () => {
    assert.strictEqual(classifySurfaceStatus("✻ Concocting..."), "working");
    assert.strictEqual(classifySurfaceStatus("✻ Thinking...\nReading file.ts"), "working");
    assert.strictEqual(classifySurfaceStatus("✻ Concocting...\n❯"), "working");
    assert.strictEqual(
      classifySurfaceStatus("· Concocting… (1m 31s)\n──────────────────────────\n❯\n──────────────────────────\n⏵⏵ bypass           ·"),
      "working",
    );
  });

  it("classifies Codex working lines and keeps them working even with trailing idle hints", () => {
    assert.strictEqual(classifySurfaceStatus("• Working (34s • esc to interr…)"), "working");
    assert.strictEqual(classifySurfaceStatus("• Working (34s • esc to interr…)\n›"), "working");
    assert.strictEqual(classifySurfaceStatus("• Working (34s • esc to interr…)\n› Write tests"), "working");
    assert.strictEqual(classifySurfaceStatus("• Working (34s • esc to interr…)\ngpt-5.4 xhigh fast · 46% left"), "working");
    assert.strictEqual(classifySurfaceStatus("• Creating branch…\n1% until auto-compact"), "working");
    assert.strictEqual(classifySurfaceStatus("• Cultivating patch set…\nnew task? /clear to save 149k tokens"), "working");
    assert.strictEqual(classifySurfaceStatus("• Thinking…"), "working");
  });

  it("ignores Claude status bar lines while finding prompts", () => {
    assert.strictEqual(
      classifySurfaceStatus("───────────────────────────\n❯\n───────────────────────────\n  ⏵⏵ bypass permissions\n  Now using extra usage"),
      "idle",
    );
    assert.strictEqual(
      classifySurfaceStatus("✻ Concocting...\n  ⏵⏵ bypass permissions"),
      "working",
    );
    assert.strictEqual(classifySurfaceStatus("Compacting conversation...\n⎿ Tip: Use /statusline off to disable the status line\n❯"), "idle");
  });

  it("treats prior text as idle when the interactive prompt is already visible", () => {
    assert.strictEqual(classifySurfaceStatus("작업 결과 정리 중\n❯"), "idle");
    assert.strictEqual(
      classifySurfaceStatus("⏺ result text\n───────────────────────────\n❯\n───────────────────────────\n  ⏵⏵ bypass permissions on"),
      "idle",
    );
  });

  it("ignores Codex suggestion lines and keeps them idle", () => {
    assert.strictEqual(classifySurfaceStatus("› Write tests"), "idle");
    assert.strictEqual(classifySurfaceStatus("작업 결과 정리 완료\n› Write tests"), "idle");
    assert.strictEqual(classifySurfaceStatus("› Summarize\n› Run /review"), "idle");
  });

  it("treats trailing Codex and Claude idle footer hints as idle", () => {
    assert.strictEqual(
      classifySurfaceStatus("Working on parser fix\ngpt-5.4 xhigh fast · 46% left"),
      "idle",
    );
    assert.strictEqual(
      classifySurfaceStatus("Working on parser fix\ngpt-5.4 xhig…"),
      "idle",
    );
    assert.strictEqual(
      classifySurfaceStatus("작업 결과 정리 완료\nnew task? /clear to save 149k tokens"),
      "idle",
    );
    assert.strictEqual(
      classifySurfaceStatus("작업 결과 정리 완료\n1% until auto-compact"),
      "idle",
    );
    assert.strictEqual(
      classifySurfaceStatus('작업 결과 정리 완료\n8% until auto-compact · /model opus[1m]'),
      "idle",
    );
    assert.strictEqual(
      classifySurfaceStatus("완료\n✻ Cogitated for 1m 5s\n❯\n~53k uncached · /clear to start…"),
      "idle",
    );
    assert.strictEqual(
      classifySurfaceStatus("⚠ MCP startup incomplete\n(failed: mcp-arena)\n› Implement {feature}\ngpt-5.4-mini xhigh …"),
      "idle",
    );
  });

  it("classifies prompt and footer-only output as idle", () => {
    assert.strictEqual(
      classifySurfaceStatus("⏵⏵ bypass permissions on /tmp\nPress up to edit queued messages\n❯"),
      "idle",
    );
    assert.strictEqual(
      classifySurfaceStatus("─────────────────────────────❯"),
      "idle",
    );
    assert.strictEqual(
      classifySurfaceStatus("gpt-5.4 high fast\nesc to interrupt\ntab to queue"),
      "idle",
    );
    assert.strictEqual(
      classifySurfaceStatus("──────────────\n  ⏵⏵      ·"),
      "idle",
    );
  });

  it("treats Claude thinking-only spinners plus bypass footers as idle", () => {
    const sample = [
      "… +19 lines (ctrl+o to expand)",
      "✻ Scurrying… (thinking with high effort)",
      "⏵⏵ bypa · permissions on   1 shell · esc…",
    ].join("\n");

    assert.strictEqual(classifySurfaceStatus(sample), "idle");

    const snapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:1", { status: "idle", lastOutput: sample }]]),
      {
        updatedAt: "2026-04-08T00:00:00.000Z",
        registry: { system: { "🐻 쿠마": "surface:1" } },
      },
    );

    const kuma = getStudioProjectMember(snapshot, "system", "kuma");
    assert.deepEqual(kuma?.lastOutputLines, []);
    assert.strictEqual(kuma?.task, null);
  });

  it("treats the live kuma whisking prompt sample as idle with no bubble fallback", () => {
    const sample = [
      "← discord · kimsuhong3759: 그래 노을이 모델",
      "왜 Gpt 5.4 xhigh fast 로 보이냐? 쭈니도. …",
      "* Whisking… (thinking with high effort)",
      "❯",
      "⏵⏵ bypa · permissions on   1 shell · esc…",
      "6% until auto-compact · /model opus[1m]",
    ].join("\n");

    assert.strictEqual(classifySurfaceStatus(sample), "idle");

    const snapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:1", { status: "idle", lastOutput: sample }]]),
      {
        updatedAt: "2026-04-08T00:00:00.000Z",
        registry: { system: { "🐻 쿠마": "surface:1" } },
      },
    );

    const kuma = getStudioProjectMember(snapshot, "system", "kuma");
    assert.deepEqual(kuma?.lastOutputLines, []);
    assert.strictEqual(kuma?.task, null);
  });

  it("classifies cmux failures as dead", () => {
    assert.strictEqual(
      classifySurfaceStatus("Error: invalid_params: Surface is not a terminal"),
      "dead",
    );
  });

  it("detects retryable cmux socket transport failures", () => {
    assert.strictEqual(isRetryableCmuxSocketFailure("Error: Failed to write to socket"), true);
    assert.strictEqual(isRetryableCmuxSocketFailure("connect ECONNREFUSED /tmp/cmux.sock"), true);
    assert.strictEqual(
      isRetryableCmuxSocketFailure("Error: invalid_params: Surface is not a terminal"),
      false,
    );
  });

  it("detects explicit surface-not-found outputs for registry cleanup", () => {
    assert.strictEqual(isSurfaceNotFoundOutput("Error: surface:85 not found"), true);
    assert.strictEqual(isSurfaceNotFoundOutput("no such surface: surface:86"), true);
    assert.strictEqual(isSurfaceNotFoundOutput("Error: invalid_params: Surface is not a terminal"), false);
  });

  it("parses live surfaces from cmux tree output", () => {
    assert.deepEqual(
      parseLiveSurfacesFromCmuxTree([
        "workspace workspace:2",
        "│   ├── surface surface:54 [terminal] \"🦔 밤토리\" tty=ttys007",
        "│   ├── surface surface:63 [terminal] \"🐝 쭈니\" tty=ttys008",
        "│   ├── surface surface:54 [terminal] duplicate sample",
      ].join("\n")),
      ["surface:54", "surface:63"],
    );
  });

  it("reconciles the registry to live cmux surfaces only", () => {
    const registry = {
      "kuma-studio": {
        쿤: "surface:24",
        "🦝 쿤": "surface:22",
        "🦦 슉슉이": "surface:86",
      },
    };

    const reconciled = reconcileRegistryWithCmuxTree(
      registry,
      [
        "workspace workspace:2",
        "│   ├── surface surface:24 [terminal] \"🦝 쿤\" tty=ttys008",
      ].join("\n"),
    );

    assert.deepEqual(reconciled, {
      "kuma-studio": {
        쿤: "surface:24",
      },
    });
  });

  it("retries socket failures with strict cmux env and reports a healed read", async () => {
    const calls = [];
    const result = await readSurfaceWithHealing(
      "surface:7",
      async (_surface, options = {}) => {
        calls.push(options.strictCmuxEnv === true);
        if (calls.length === 1) {
          return { ok: false, output: "Error: Failed to write to socket" };
        }

        return { ok: true, output: "❯" };
      },
      {
        retryDelaysMs: [0],
      },
    );

    assert.deepEqual(calls, [false, true]);
    assert.deepEqual(result, {
      ok: true,
      output: "❯",
      healed: true,
      strictCmuxEnvUsed: true,
    });
  });

  it("starts in strict cmux env when the caller has already entered heal mode", async () => {
    const calls = [];
    const result = await readSurfaceWithHealing(
      "surface:7",
      async (_surface, options = {}) => {
        calls.push(options.strictCmuxEnv === true);
        return { ok: true, output: "❯" };
      },
      {
        strictFirst: true,
        retryDelaysMs: [0],
      },
    );

    assert.deepEqual(calls, [true]);
    assert.deepEqual(result, {
      ok: true,
      output: "❯",
      healed: false,
      strictCmuxEnvUsed: true,
    });
  });

  it("builds a project snapshot with metadata and fallback labels", () => {
    const snapshot = buildTeamStatusSnapshot(
      {
        "kuma-studio": {
          "🦫 뚝딱이": "surface:7",
          server: "surface:3",
        },
      },
      new Map([
        ["surface:7", { status: "working", lastOutput: "Working on API route" }],
        ["surface:3", { status: "dead", lastOutput: "Error: invalid_params: Surface is not a terminal" }],
      ]),
      new Map([
        ["뚝딱이", { emoji: "🔨", role: "구현. 코드 구현, 버그 수정, 리팩토링" }],
      ]),
    );

    assert.deepEqual(snapshot, {
      projects: {
        "kuma-studio": {
          members: [
            {
              name: "뚝딱이",
              emoji: "🦫",
              role: "구현. 코드 구현, 버그 수정, 리팩토링",
              surface: "surface:7",
              status: "working",
              lastOutput: "Working on API route",
            },
          ],
        },
      },
    });
  });

  it("marks system members offline when they have no live surface", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:7", { status: "working", lastOutput: "Working on API route" }]]),
      {
        updatedAt: "2026-04-10T00:00:00.000Z",
        registry: { "kuma-studio": { "🦫 뚝딱이": "surface:7" } },
      },
    );

    assert.deepEqual(getStudioProjectMember(snapshot, "system", "kuma"), {
      id: "kuma",
      surface: null,
      state: "offline",
      lastOutputLines: [],
      task: null,
      modelInfo: null,
      updatedAt: "2026-04-10T00:00:00.000Z",
    });
  });

  it("keeps the latest registry surface when the same member is registered twice", () => {
    const snapshot = buildTeamStatusSnapshot(
      {
        "kuma-studio": {
          "🦝 쿤": "surface:22",
          쿤: "surface:24",
        },
      },
      new Map([
        ["surface:22", { status: "dead", lastOutput: "Error: surface:22 not found" }],
        ["surface:24", { status: "working", lastOutput: "Reviewing dashboard sync" }],
      ]),
      new Map([
        ["쿤", { emoji: "🦝", role: "분석" }],
      ]),
    );

    assert.deepEqual(snapshot, {
      projects: {
        "kuma-studio": {
          members: [
            {
              name: "쿤",
              emoji: "🦝",
              role: "분석",
              surface: "surface:24",
              status: "working",
              lastOutput: "Reviewing dashboard sync",
            },
          ],
        },
      },
    });
  });

  it("maps surface dead status to studio error state", () => {
    assert.strictEqual(mapSurfaceStatusToStudioState("dead"), "error");
  });

  it("converts surface states to the studio API shape", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:7", { status: "working", lastOutput: "Working on API route\nApplying patch" }]]),
      {
        updatedAt: "2026-04-05T00:00:00.000Z",
        registry: { "kuma-studio": { "🦫 뚝딱이": "surface:7" } },
      },
    );

    const kumaStudioProject = getStudioProject(snapshot, "kuma-studio");
    const tookdaki = getStudioProjectMember(snapshot, "kuma-studio", "tookdaki");

    assert.ok(kumaStudioProject);
    assert.deepEqual(tookdaki, {
      id: "tookdaki",
      surface: "surface:7",
      state: "working",
      lastOutputLines: ["Working on API route", "Applying patch"],
      task: "Applying patch",
      modelInfo: null,
      updatedAt: "2026-04-05T00:00:00.000Z",
    });
    assert.strictEqual(
      kumaStudioProject.members.some((member) => member.id === "moongchi"),
      true,
    );
  });

  it("builds the studio roster from team.json even when the live registry is partial", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:18", { status: "working", lastOutput: "Reviewing analytics panel" }]]),
      {
        updatedAt: "2026-04-10T00:00:00.000Z",
        registry: { "kuma-studio": { "🦉 부리": "surface:18" } },
      },
    );

    const kumaStudioProject = getStudioProject(snapshot, "kuma-studio");
    const moongchi = getStudioProjectMember(snapshot, "kuma-studio", "moongchi");
    const shuksshuki = getStudioProjectMember(snapshot, "kuma-studio", "shuksshuki");
    const jjooni = getStudioProjectMember(snapshot, "system", "jjooni");

    assert.ok(kumaStudioProject);
    assert.deepEqual(moongchi, {
      id: "moongchi",
      surface: null,
      state: "offline",
      lastOutputLines: [],
      task: null,
      modelInfo: null,
      updatedAt: "2026-04-10T00:00:00.000Z",
    });
    assert.deepEqual(shuksshuki, {
      id: "shuksshuki",
      surface: null,
      state: "offline",
      lastOutputLines: [],
      task: null,
      modelInfo: null,
      updatedAt: "2026-04-10T00:00:00.000Z",
    });
    assert.deepEqual(jjooni, {
      id: "jjooni",
      surface: null,
      state: "offline",
      lastOutputLines: [],
      task: null,
      modelInfo: null,
      updatedAt: "2026-04-10T00:00:00.000Z",
    });
  });

  it("marks roster members without a live surface state as offline", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      new Map(),
      {
        updatedAt: "2026-04-10T00:00:00.000Z",
        registry: { "kuma-studio": { "🦫 뚝딱이": "surface:18" } },
      },
    );

    assert.deepEqual(getStudioProjectMember(snapshot, "kuma-studio", "tookdaki"), {
      id: "tookdaki",
      surface: "surface:18",
      state: "offline",
      lastOutputLines: [],
      task: null,
      modelInfo: null,
      updatedAt: "2026-04-10T00:00:00.000Z",
    });
  });

  it("uses live project membership as an overlay while keeping team.json as the roster source", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:18", { status: "working", lastOutput: "Reviewing mobile playback" }]]),
      {
        updatedAt: "2026-04-10T00:00:00.000Z",
        registry: { other-project: { "🦉 부리": "surface:18" } },
      },
    );

    const kumaStudioProject = getStudioProject(snapshot, "kuma-studio");

    assert.deepEqual(getStudioProjectMember(snapshot, "other-project", "buri"), {
      id: "buri",
      surface: "surface:18",
      state: "working",
      lastOutputLines: ["Reviewing mobile playback"],
      task: "Reviewing mobile playback",
      modelInfo: null,
      updatedAt: "2026-04-10T00:00:00.000Z",
    });
    assert.strictEqual(
      kumaStudioProject?.members.some((member) => member.id === "buri"),
      false,
    );
  });

  it("drops stale output lines when the surface is back at a prompt or suggestion", () => {
    const reg = { "kuma-studio": { "🦫 뚝딱이": "surface:7" } };
    const promptSnapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:7", { status: "idle", lastOutput: "Applying patch\n❯" }]]),
      { updatedAt: "2026-04-08T00:00:00.000Z", registry: reg },
    );

    const suggestionSnapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:7", { status: "idle", lastOutput: "Applying patch\n› Write tests" }]]),
      { updatedAt: "2026-04-08T00:00:00.000Z", registry: reg },
    );

    assert.deepEqual(getStudioProjectMember(promptSnapshot, "kuma-studio", "tookdaki")?.lastOutputLines, []);
    assert.deepEqual(getStudioProjectMember(suggestionSnapshot, "kuma-studio", "tookdaki")?.lastOutputLines, []);
    assert.strictEqual(getStudioProjectMember(promptSnapshot, "kuma-studio", "tookdaki")?.task, null);
    assert.strictEqual(getStudioProjectMember(suggestionSnapshot, "kuma-studio", "tookdaki")?.task, null);
  });

  it("drops stale output lines when the surface ends with idle footer hints", () => {
    const footerSnapshot = toStudioTeamStatusSnapshot(
      new Map([
        ["surface:7", { status: "idle", lastOutput: "Applying patch\ngpt-5.4 xhig…" }],
        ["surface:5", { status: "idle", lastOutput: "Review complete\nnew task? /clear to save 149k tokens" }],
        ["surface:16", { status: "idle", lastOutput: "완료\n✻ Cogitated for 1m 5s\n❯\n~53k uncached · /clear to start…" }],
        ["surface:26", { status: "idle", lastOutput: "⚠ MCP startup incomplete\n(failed: mcp-arena)\n› Implement {feature}\ngpt-5.4-mini xhigh …" }],
      ]),
      {
        updatedAt: "2026-04-08T00:00:00.000Z",
        registry: {
          "kuma-studio": {
            "🦫 뚝딱이": "surface:7",
            "🦅 새미": "surface:5",
            "🦝 쿤": "surface:16",
          },
          system: {
            "🦌 노을이": "surface:26",
          },
        },
      },
    );

    for (const project of footerSnapshot.projects) {
      for (const member of project.members) {
        if (member.surface) {
          assert.deepEqual(member.lastOutputLines, [], `${member.id} should have empty lastOutputLines`);
          assert.strictEqual(member.task, null, `${member.id} should have null task`);
        }
      }
    }
  });

  it("keeps working lines and task text when active work is followed by idle hints", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      new Map([
        ["surface:4", { status: "working", lastOutput: "• Working (34s • esc to interr…)\n› Summarize recent commits\ngpt-5.4 xhigh fast · 46% left" }],
        ["surface:5", { status: "working", lastOutput: "• Creating branch…\n1% until auto-compact" }],
      ]),
      {
        updatedAt: "2026-04-08T00:00:00.000Z",
        registry: { "kuma-studio": { "🦫 뚝딱이": "surface:4", "🦅 새미": "surface:5" } },
      },
    );

    assert.deepEqual(getStudioProjectMember(snapshot, "kuma-studio", "tookdaki")?.lastOutputLines, ["• Working (34s • esc to interr…)"]);
    assert.strictEqual(getStudioProjectMember(snapshot, "kuma-studio", "tookdaki")?.task, "• Working (34s • esc to interr…)");
    assert.deepEqual(getStudioProjectMember(snapshot, "kuma-studio", "saemi")?.lastOutputLines, ["• Creating branch…"]);
    assert.strictEqual(getStudioProjectMember(snapshot, "kuma-studio", "saemi")?.task, "• Creating branch…");
  });

  it("keeps Claude tool activity as working even when a prompt and bypass footer are visible", () => {
    const output = [
      "⏺ Bash(npm test -- packages/server/src/studio/team-status-store.test.mjs 2>&1 | tail -8)",
      "✻ Scurrying… (thinking with high effort)",
      "❯",
      "⏵⏵ bypa · permissions on   1 shell · esc…",
    ].join("\n");

    assert.strictEqual(classifySurfaceStatus(output), "working");

    const snapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:1", { status: "working", lastOutput: output }]]),
      {
        updatedAt: "2026-04-08T00:00:00.000Z",
        registry: { system: { "🐻 쿠마": "surface:1" } },
      },
    );

    assert.deepEqual(getStudioProjectMember(snapshot, "system", "kuma")?.lastOutputLines, [
      "⏺ Bash(npm test -- packages/server/src/studio/team-status-store.test.mjs 2>&1 | tail -8)",
    ]);
    assert.strictEqual(
      getStudioProjectMember(snapshot, "system", "kuma")?.task,
      "⏺ Bash(npm test -- packages/server/src/studio/team-status-store.test.mjs 2>&1 | tail -8)",
    );
  });

  it("treats the actual jjooni surface footer pattern as idle", () => {
    assert.strictEqual(
      classifySurfaceStatus(
        [
          "Scene path reported by",
          "the server:",
          "~/.kuma-picker/projects/110b4d7cf23f/scene.json",
          "",
          "› Write tests",
          "",
          "gpt-5.4 xhig…",
        ].join("\n"),
      ),
      "idle",
    );
  });

  it("filters Claude Code system messages from task lines", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:7", { status: "working", lastOutput: "Working on parser fix\nCompacting conversation...\n⎿ Tip: Use /statusline off to disable the status line" }]]),
      {
        updatedAt: "2026-04-08T00:00:00.000Z",
        registry: { "kuma-studio": { "🦫 뚝딱이": "surface:7" } },
      },
    );

    assert.deepEqual(getStudioProjectMember(snapshot, "kuma-studio", "tookdaki"), {
      id: "tookdaki",
      surface: "surface:7",
      state: "working",
      lastOutputLines: ["Working on parser fix"],
      task: "Working on parser fix",
      modelInfo: null,
      updatedAt: "2026-04-08T00:00:00.000Z",
    });
  });

  it("maps 밤토리 directly to the canonical member id from team.json", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:7", { status: "working", lastOutput: "QA in progress" }]]),
      {
        updatedAt: "2026-04-05T00:00:00.000Z",
        registry: { "kuma-studio": { "🦔 밤토리": "surface:7" } },
      },
    );

    assert.strictEqual(getStudioProjectMember(snapshot, "kuma-studio", "bamdori")?.id, "bamdori");
  });

  // -------------------------------------------------------------------------
  // parseModelInfo
  // -------------------------------------------------------------------------

  it("parses Codex model footer with effort, speed, and context", () => {
    const info = parseModelInfo("gpt-5.4 high fast · 46% left\nesc to interrupt\n❯");
    assert.deepEqual(info, { model: "gpt-5.4", effort: "high", speed: "fast", contextRemaining: 46 });
  });

  it("parses Codex model footer without speed or context", () => {
    const info = parseModelInfo("gpt-5.4 high\nesc to interrupt\n❯");
    assert.deepEqual(info, { model: "gpt-5.4", effort: "high", speed: null, contextRemaining: null });
  });

  it("parses truncated Codex mini footer into the canonical model name", () => {
    const info = parseModelInfo("gpt-5.4-min… xhigh fast · 100% left\n❯");
    assert.deepEqual(info, { model: "gpt-5.4-mini", effort: "xhigh", speed: "fast", contextRemaining: 100 });
  });

  it("parses Claude /model command with context bracket", () => {
    const info = parseModelInfo("esc to interrupt · /model opus[1m]\n❯");
    assert.deepEqual(info, { model: "opus", effort: null, speed: null, contextRemaining: null });
  });

  it("parses standalone Claude model identifier", () => {
    const info = parseModelInfo("claude-opus-4-6\n❯");
    assert.deepEqual(info, { model: "claude-opus-4-6", effort: null, speed: null, contextRemaining: null });
  });

  it("returns null when no model info is found", () => {
    assert.strictEqual(parseModelInfo("Working on file.ts\nApplying changes"), null);
    assert.strictEqual(parseModelInfo("❯"), null);
    assert.strictEqual(parseModelInfo(""), null);
  });

  it("parses context remaining without model", () => {
    const info = parseModelInfo("some output\n42% left");
    assert.deepEqual(info, { model: null, effort: null, speed: null, contextRemaining: 42 });
  });

  it("includes modelInfo in toStudioTeamStatusSnapshot output", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      new Map([["surface:7", { status: "idle", lastOutput: "gpt-5.4 high fast · 88% left\n❯" }]]),
      {
        updatedAt: "2026-04-06T00:00:00.000Z",
        registry: { "test-proj": { "🦫 뚝딱이": "surface:7" } },
      },
    );
    const member = getStudioProjectMember(snapshot, "test-proj", "tookdaki");
    assert.deepEqual(member.modelInfo, { model: "gpt-5.4", effort: "high", speed: "fast", contextRemaining: 88 });
  });

  it("filters snapshots by project id via options.projectId", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      new Map([
        ["surface:5", { status: "idle", lastOutput: "❯" }],
        ["surface:22", { status: "working", lastOutput: "Reviewing mockup" }],
      ]),
      {
        projectId: "kuma-studio",
        registry: { "kuma-studio": { "🦫 뚝딱이": "surface:5" }, other-project: { "🦝 쿤": "surface:22" } },
      },
    );

    assert.strictEqual(snapshot.projects.length, 1);
    assert.strictEqual(snapshot.projects[0].projectId, "kuma-studio");
  });

  it("removes stale registry entries when a surface read returns not found", async () => {
    let registry = {
      "kuma-studio": {
        쿤: "surface:24",
        "🦝 쿤": "surface:22",
      },
    };
    const writes = [];

    const store = new TeamStatusStore({
      registryPath: "/tmp/team-status-store-stale-registry.json",
      readRegistryFn: async () => registry,
      writeRegistryFn: async (_registryPath, nextRegistry) => {
        registry = JSON.parse(JSON.stringify(nextRegistry));
        writes.push(registry);
      },
      readCmuxTreeFn: async () => ({
        ok: false,
        output: "Error: Failed to connect to socket",
      }),
      readSurfaceFn: async (surface) => {
        if (surface === "surface:22") {
          return { ok: false, output: "Error: surface:22 not found" };
        }

        return { ok: true, output: "Reviewing dashboard sync" };
      },
    });

    await store.refreshRegistry();
    await waitFor(() => writes.length === 1);
    const snapshot = store.getSnapshot();

    assert.strictEqual(writes.length, 1);
    assert.deepEqual(registry, {
      "kuma-studio": {
        쿤: "surface:24",
      },
    });
    assert.deepEqual(snapshot.projects["kuma-studio"].members.map(({ name, surface, status }) => ({
      name,
      surface,
      status,
    })), [
      {
        name: "쿤",
        surface: "surface:24",
        status: "working",
      },
    ]);
  });

  it("reconciles stale dead+live duplicates from cmux tree before polling", async () => {
    let registry = {
      "kuma-studio": {
        쿤: "surface:24",
        "🦝 쿤": "surface:22",
        "🦦 슉슉이": "surface:86",
      },
    };
    const writes = [];

    const store = new TeamStatusStore({
      registryPath: "/tmp/team-status-store-reconcile.json",
      readRegistryFn: async () => registry,
      writeRegistryFn: async (_registryPath, nextRegistry) => {
        registry = JSON.parse(JSON.stringify(nextRegistry));
        writes.push(registry);
      },
      readCmuxTreeFn: async () => ({
        ok: true,
        output: [
          "workspace workspace:2",
          "│   ├── surface surface:24 [terminal] \"🦝 쿤\" tty=ttys008",
        ].join("\n"),
      }),
      readSurfaceFn: async () => ({ ok: true, output: "❯" }),
    });

    await store.refreshRegistry();
    await waitFor(() => {
      const project = store.getSnapshot().projects["kuma-studio"];
      return project?.members?.[0]?.status === "idle";
    });
    const snapshot = store.getSnapshot();

    assert.strictEqual(writes.length, 1);
    assert.deepEqual(registry, {
      "kuma-studio": {
        쿤: "surface:24",
      },
    });
    assert.deepEqual(snapshot.projects["kuma-studio"].members.map(({ name, surface, status }) => ({
      name,
      surface,
      status,
    })), [
      {
        name: "쿤",
        surface: "surface:24",
        status: "idle",
      },
    ]);
  });
});
