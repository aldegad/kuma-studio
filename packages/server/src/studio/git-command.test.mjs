import { assert, describe, it } from "vitest";

import { buildGitExecOptions, execGitSync } from "./git-command.mjs";

describe("git-command", () => {
  it("forces stderr/stdout to stay piped back to the caller", () => {
    const options = buildGitExecOptions({
      cwd: "/tmp/workspace",
      encoding: "utf8",
      timeout: 4000,
      maxBuffer: 8192,
      stdio: "inherit",
    });

    assert.deepStrictEqual(options.stdio, ["ignore", "pipe", "pipe"]);
    assert.strictEqual(options.cwd, "/tmp/workspace");
    assert.strictEqual(options.encoding, "utf8");
    assert.strictEqual(options.timeout, 4000);
    assert.strictEqual(options.maxBuffer, 8192);
  });

  it("delegates to execSync with piped stdio", () => {
    const calls = [];
    const output = execGitSync("git status --porcelain -u", {
      cwd: "/tmp/repo",
      encoding: "utf8",
      timeout: 5000,
      execSyncImpl(command, options) {
        calls.push({ command, options });
        return " M file.txt\n";
      },
    });

    assert.strictEqual(output, " M file.txt\n");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, "git status --porcelain -u");
    assert.deepStrictEqual(calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
    assert.strictEqual(calls[0].options.cwd, "/tmp/repo");
    assert.strictEqual(calls[0].options.encoding, "utf8");
    assert.strictEqual(calls[0].options.timeout, 5000);
  });
});
