import { assert, describe, it } from "vitest";

import {
  buildTeamStatusSnapshot,
  classifySurfaceStatus,
  parseRegistryLabel,
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
            {
              name: "server",
              emoji: "",
              role: "",
              surface: "surface:3",
              status: "dead",
              lastOutput: "Error: invalid_params: Surface is not a terminal",
            },
          ],
        },
      },
    });
  });
});
