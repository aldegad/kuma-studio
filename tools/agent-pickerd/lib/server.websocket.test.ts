import { once } from "node:events";
import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

function waitForOpen(socket) {
  return once(socket, "open");
}

function waitForMessage(socket) {
  return once(socket, "message").then(([raw]) => JSON.parse(raw.toString("utf8")));
}

describe("agent-pickerd websocket control plane", () => {
  const tempRoots = [];

  afterEach(() => {
    delete process.env.AGENT_PICKER_STATE_HOME;
    delete process.env.AGENT_PICKER_TRANSPORT;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts websocket browser/controller connections and routes a command result", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-pickerd-socket-"));
    tempRoots.push(root);
    process.env.AGENT_PICKER_STATE_HOME = path.join(root, "state");

    const { createServer } = await import("./server.mjs");
    const { server } = createServer({
      host: "127.0.0.1",
      port: 0,
      root,
    });

    await new Promise((resolvePromise) => {
      server.listen(0, "127.0.0.1", resolvePromise);
    });

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : null;
    const browserSocket = new WebSocket(`ws://127.0.0.1:${port}/browser-session/socket`);
    const controllerSocket = new WebSocket(`ws://127.0.0.1:${port}/browser-session/socket`);

    await Promise.all([waitForOpen(browserSocket), waitForOpen(controllerSocket)]);

    browserSocket.send(
      JSON.stringify({
        type: "hello",
        role: "browser",
        extensionId: "dnoppcchjalcholnhliibpjbdfhaklmo",
        extensionName: "Agent Picker Bridge",
      }),
    );
    controllerSocket.send(
      JSON.stringify({
        type: "hello",
        role: "controller",
      }),
    );

    await Promise.all([waitForMessage(browserSocket), waitForMessage(controllerSocket)]);

    browserSocket.send(
      JSON.stringify({
        type: "presence.update",
        source: "content-script:page-heartbeat",
        page: {
          url: "https://example.com/dashboard",
          pathname: "/dashboard",
          title: "Dashboard",
        },
        activeTabId: 99,
        visible: true,
        focused: true,
        capabilities: ["context", "click"],
        lastSeenAt: new Date().toISOString(),
      }),
    );

    controllerSocket.send(
      JSON.stringify({
        type: "command.request",
        requestId: "browser-command-test-0003",
        command: {
          type: "context",
          targetTabId: 99,
        },
      }),
    );

    const accepted = await waitForMessage(controllerSocket);
    expect(accepted).toEqual(
      expect.objectContaining({
        type: "command.accepted",
        requestId: "browser-command-test-0003",
      }),
    );

    const commandRequest = await waitForMessage(browserSocket);
    expect(commandRequest).toEqual(
      expect.objectContaining({
        type: "command.request",
        requestId: "browser-command-test-0003",
        command: expect.objectContaining({
          resolvedTargetTabId: 99,
        }),
      }),
    );

    browserSocket.send(
      JSON.stringify({
        type: "command.result",
        requestId: "browser-command-test-0003",
        result: {
          pageContext: {
            page: {
              title: "Dashboard",
            },
          },
        },
      }),
    );

    const result = await waitForMessage(controllerSocket);
    expect(result).toEqual(
      expect.objectContaining({
        type: "command.result",
        requestId: "browser-command-test-0003",
        result: {
          pageContext: {
            page: {
              title: "Dashboard",
            },
          },
        },
      }),
    );

    const browserSession = await fetch(`http://127.0.0.1:${port}/browser-session`).then((response) => response.json());
    expect(browserSession.connected).toBe(true);
    expect(browserSession.activeTabId).toBe(99);
    expect(browserSession.browserTransport).toBe("websocket");
    expect(browserSession.socketConnected).toBe(true);

    browserSocket.close();
    controllerSocket.close();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  });
});
