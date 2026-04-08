import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

import { afterEach, assert, describe, it } from "vitest";

import { buildCmuxEnv, resolveCmuxSocketPath } from "./cmux-env.mjs";

function createUnixSocket(socketPath) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}

describe("cmux-env", () => {
  const tempDirs = [];
  const servers = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      await new Promise((resolve) => server.close(resolve));
    }

    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("prefers the canonical socket and strips volatile cmux caller env", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-cmux-env-"));
    tempDirs.push(root);

    const preferredSocketPath = join(root, "preferred.sock");
    const explicitSocketPath = join(root, "explicit.sock");
    servers.push(await createUnixSocket(preferredSocketPath));
    servers.push(await createUnixSocket(explicitSocketPath));

    const env = buildCmuxEnv(
      {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CMUX_SOCKET: explicitSocketPath,
        CMUX_SOCKET_PATH: explicitSocketPath,
        CMUX_PANEL_ID: "panel-1",
        CMUX_SURFACE_ID: "surface-1",
        CMUX_TAB_ID: "tab-1",
        CMUX_WORKSPACE_ID: "workspace-1",
      },
      { preferredSocketPath },
    );

    assert.strictEqual(env.CMUX_SOCKET, preferredSocketPath);
    assert.strictEqual(env.CMUX_SOCKET_PATH, preferredSocketPath);
    assert.ok(!("CMUX_PANEL_ID" in env));
    assert.ok(!("CMUX_SURFACE_ID" in env));
    assert.ok(!("CMUX_TAB_ID" in env));
    assert.ok(!("CMUX_WORKSPACE_ID" in env));
  });

  it("falls back to an explicit valid socket when the canonical path is unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "kuma-cmux-env-"));
    tempDirs.push(root);

    const explicitSocketPath = join(root, "explicit.sock");
    servers.push(await createUnixSocket(explicitSocketPath));

    const socketPath = resolveCmuxSocketPath(
      {
        CMUX_SOCKET: explicitSocketPath,
      },
      {
        preferredSocketPath: join(root, "missing.sock"),
      },
    );

    assert.strictEqual(socketPath, explicitSocketPath);
  });

  it("clears socket env when neither canonical nor explicit sockets are usable", () => {
    const env = buildCmuxEnv(
      {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CMUX_SOCKET: "/tmp/does-not-exist.sock",
        CMUX_SOCKET_PATH: "/tmp/does-not-exist.sock",
      },
      {
        preferredSocketPath: "/tmp/also-missing.sock",
      },
    );

    assert.ok(!("CMUX_SOCKET" in env));
    assert.ok(!("CMUX_SOCKET_PATH" in env));
  });
});
