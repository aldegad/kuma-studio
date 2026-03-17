import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const CLI_PATH = path.resolve(process.cwd(), "packages/server/src/cli.mjs");

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
}

describe("agent-pickerd note fallback", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    delete process.env.AGENT_PICKER_STATE_HOME;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes a global picker note when no selection session exists", () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-pickerd-main-"));
    tempRoots.push(root);
    const stateHome = path.join(root, "state");

    const output = runCli(
      ["set-agent-note", "--root", root, "--author", "codex", "--status", "acknowledged", "--message", "hello"],
      root,
      { ...process.env, AGENT_PICKER_STATE_HOME: stateHome },
    );

    const note = JSON.parse(output) as {
      sessionId: string;
      message: string;
    };

    expect(note.sessionId).toBe("global-note");
    expect(note.message).toBe("hello");
    expect(existsSync(path.join(stateHome, "agent-notes", "global-note.json"))).toBe(true);

    const persisted = JSON.parse(
      readFileSync(path.join(stateHome, "agent-notes", "global-note.json"), "utf8"),
    ) as { sessionId: string };
    expect(persisted.sessionId).toBe("global-note");

    const getOutput = runCli(["get-agent-note", "--root", root], root, {
      ...process.env,
      AGENT_PICKER_STATE_HOME: stateHome,
    });
    const fetched = JSON.parse(getOutput) as { sessionId: string; message: string };
    expect(fetched.sessionId).toBe("global-note");
    expect(fetched.message).toBe("hello");
  });
});
