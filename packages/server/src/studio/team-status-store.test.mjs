import { assert, describe, it } from "vitest";

import {
  buildTeamStatusSnapshot,
  classifySurfaceStatus,
  filterTeamStatusSnapshot,
  mapSurfaceStatusToStudioState,
  parseModelInfo,
  parseRegistryLabel,
  toStudioTeamStatusSnapshot,
  withImplicitRegistryMembers,
} from "./team-status-store.mjs";

describe("team-status-store", () => {
  it("parses registry labels into emoji and display name", () => {
    assert.deepEqual(parseRegistryLabel("🦫 뚝딱이"), {
      name: "뚝딱이",
      emoji: "🦫",
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

  it("classifies cmux failures as dead", () => {
    assert.strictEqual(
      classifySurfaceStatus("Error: invalid_params: Surface is not a terminal"),
      "dead",
    );
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

  it("adds implicit system surfaces when the registry is otherwise populated", () => {
    const registry = withImplicitRegistryMembers({
      "kuma-studio": {
        "🦫 뚝딱이": "surface:7",
      },
    });

    assert.strictEqual(registry.system["🐻 쿠마"], "surface:1");
    assert.strictEqual(registry.system["🐝 쭈니"], "surface:2");
  });

  it("keeps an empty registry empty when no surfaces have been registered yet", () => {
    assert.deepEqual(withImplicitRegistryMembers({}), {});
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

  it("converts the raw snapshot to the studio API shape", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      {
        projects: {
          "kuma-studio": {
            members: [
              {
                name: "뚝딱이",
                emoji: "🦫",
                role: "구현. 코드 구현, 버그 수정, 리팩토링",
                surface: "surface:7",
                status: "working",
                lastOutput: "Working on API route\nApplying patch",
              },
            ],
          },
        },
      },
      "2026-04-05T00:00:00.000Z",
    );

    assert.deepEqual(snapshot, {
      projects: [
        {
          projectId: "kuma-studio",
          projectName: "kuma-studio",
          members: [
            {
              id: "tookdaki",
              surface: "surface:7",
              state: "working",
              lastOutputLines: ["Working on API route", "Applying patch"],
              task: "Applying patch",
              modelInfo: null,
              updatedAt: "2026-04-05T00:00:00.000Z",
            },
          ],
        },
      ],
    });
  });

  it("drops stale output lines when the surface is back at a prompt or suggestion", () => {
    const promptSnapshot = toStudioTeamStatusSnapshot(
      {
        projects: {
          "kuma-studio": {
            members: [
              {
                name: "뚝딱이",
                emoji: "🦫",
                role: "",
                surface: "surface:7",
                status: "idle",
                lastOutput: "Applying patch\n❯",
              },
            ],
          },
        },
      },
      "2026-04-08T00:00:00.000Z",
    );

    const suggestionSnapshot = toStudioTeamStatusSnapshot(
      {
        projects: {
          "kuma-studio": {
            members: [
              {
                name: "뚝딱이",
                emoji: "🦫",
                role: "",
                surface: "surface:7",
                status: "idle",
                lastOutput: "Applying patch\n› Write tests",
              },
            ],
          },
        },
      },
      "2026-04-08T00:00:00.000Z",
    );

    assert.deepEqual(promptSnapshot.projects[0].members[0].lastOutputLines, []);
    assert.deepEqual(suggestionSnapshot.projects[0].members[0].lastOutputLines, []);
    assert.strictEqual(promptSnapshot.projects[0].members[0].task, null);
    assert.strictEqual(suggestionSnapshot.projects[0].members[0].task, null);
  });

  it("drops stale output lines when the surface ends with idle footer hints", () => {
    const footerSnapshot = toStudioTeamStatusSnapshot(
      {
        projects: {
          "kuma-studio": {
            members: [
              {
                name: "뚝딱이",
                emoji: "🦫",
                role: "",
                surface: "surface:7",
                status: "idle",
                lastOutput: "Applying patch\ngpt-5.4 xhig…",
              },
              {
                name: "새미",
                emoji: "🦅",
                role: "",
                surface: "surface:5",
                status: "idle",
                lastOutput: "Review complete\nnew task? /clear to save 149k tokens",
              },
              {
                name: "쿤",
                emoji: "🦝",
                role: "",
                surface: "surface:16",
                status: "idle",
                lastOutput: "Draft ready\n1% until auto-compact",
              },
            ],
          },
        },
      },
      "2026-04-08T00:00:00.000Z",
    );

    for (const member of footerSnapshot.projects[0].members) {
      assert.deepEqual(member.lastOutputLines, []);
      assert.strictEqual(member.task, null);
    }
  });

  it("keeps working lines and task text when active work is followed by idle hints", () => {
    const snapshot = toStudioTeamStatusSnapshot(
      {
        projects: {
          "kuma-studio": {
            members: [
              {
                name: "뚝딱이",
                emoji: "🦫",
                role: "",
                surface: "surface:4",
                status: "working",
                lastOutput: "• Working (34s • esc to interr…)\n› Summarize recent commits\ngpt-5.4 xhigh fast · 46% left",
              },
              {
                name: "새미",
                emoji: "🦅",
                role: "",
                surface: "surface:5",
                status: "working",
                lastOutput: "• Creating branch…\n1% until auto-compact",
              },
            ],
          },
        },
      },
      "2026-04-08T00:00:00.000Z",
    );

    assert.deepEqual(snapshot.projects[0].members[0].lastOutputLines, ["• Working (34s • esc to interr…)"]);
    assert.strictEqual(snapshot.projects[0].members[0].task, "• Working (34s • esc to interr…)");
    assert.deepEqual(snapshot.projects[0].members[1].lastOutputLines, ["• Creating branch…"]);
    assert.strictEqual(snapshot.projects[0].members[1].task, "• Creating branch…");
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
      {
        projects: {
          "kuma-studio": {
            members: [
              {
                name: "뚝딱이",
                emoji: "🦫",
                role: "구현. 코드 구현, 버그 수정, 리팩토링",
                surface: "surface:7",
                status: "working",
                lastOutput: "Working on parser fix\nCompacting conversation...\n⎿ Tip: Use /statusline off to disable the status line",
              },
            ],
          },
        },
      },
      "2026-04-08T00:00:00.000Z",
    );

    assert.deepEqual(snapshot.projects[0].members[0], {
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
      {
        projects: {
          "kuma-studio": {
            members: [
              {
                name: "밤토리",
                emoji: "🦔",
                role: "",
                surface: "surface:7",
                status: "working",
                lastOutput: "QA in progress",
              },
            ],
          },
        },
      },
      "2026-04-05T00:00:00.000Z",
    );

    assert.strictEqual(snapshot.projects[0].members[0].id, "bamdori");
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
      {
        projects: {
          "test-proj": {
            members: [
              {
                name: "뚝딱이",
                emoji: "🦫",
                role: "구현",
                surface: "surface:7",
                status: "idle",
                lastOutput: "gpt-5.4 high fast · 88% left\n❯",
              },
            ],
          },
        },
      },
      "2026-04-06T00:00:00.000Z",
    );
    const member = snapshot.projects[0].members[0];
    assert.deepEqual(member.modelInfo, { model: "gpt-5.4", effort: "high", speed: "fast", contextRemaining: 88 });
  });

  it("filters snapshots by project id", () => {
    const snapshot = filterTeamStatusSnapshot(
      {
        projects: {
          "kuma-studio": { members: [{ name: "뚝딱이", emoji: "🦫", role: "", surface: "surface:5", status: "idle", lastOutput: "❯" }] },
          other-project: { members: [{ name: "쿤", emoji: "🦝", role: "", surface: "surface:22", status: "working", lastOutput: "Reviewing mockup" }] },
        },
      },
      "kuma-studio",
    );

    assert.deepEqual(Object.keys(snapshot.projects), ["kuma-studio"]);
  });
});
