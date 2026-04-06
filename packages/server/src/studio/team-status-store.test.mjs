import { assert, describe, it } from "vitest";

import {
  buildTeamStatusSnapshot,
  classifySurfaceStatus,
  filterTeamStatusSnapshot,
  mapSurfaceStatusToStudioState,
  parseModelInfo,
  parseRegistryLabel,
  toStudioTeamStatusSnapshot,
} from "./team-status-store.mjs";

describe("team-status-store", () => {
  it("parses registry labels into emoji and display name", () => {
    assert.deepEqual(parseRegistryLabel("🦫 뚝딱이"), {
      name: "뚝딱이",
      emoji: "🦫",
    });
  });

  it("classifies prompt-only output as idle", () => {
    assert.strictEqual(classifySurfaceStatus("작업 끝\n❯"), "idle");
  });

  it("classifies active execution output as working", () => {
    assert.strictEqual(classifySurfaceStatus("Working on packages/server...\nApplying patch"), "working");
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
                lastOutput: "Working on API route\nApplying patch\n❯",
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
