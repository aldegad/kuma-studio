import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createCodexUsagePoller } from "./codex-usage-poll.mjs";

describe("createCodexUsagePoller", () => {
  it("reads the latest Codex rate_limits snapshot from session logs", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-codex-usage-"));
    try {
      const sessionDir = join(root, "2026", "04", "25");
      await mkdir(sessionDir, { recursive: true });
      await writeFile(
        join(sessionDir, "rollout.jsonl"),
        [
          JSON.stringify({ timestamp: "2026-04-25T00:00:00.000Z", type: "event_msg", payload: { type: "other" } }),
          JSON.stringify({
            timestamp: "2026-04-25T01:00:00.000Z",
            type: "event_msg",
            payload: {
              type: "token_count",
              rate_limits: {
                limit_id: "codex",
                primary: { used_percent: 12, window_minutes: 300, resets_at: 1777116400 },
                secondary: { used_percent: 34, window_minutes: 10080, resets_at: 1777427763 },
                credits: null,
                plan_type: "pro",
                rate_limit_reached_type: null,
              },
            },
          }),
        ].join("\n"),
        "utf8",
      );

      const poller = createCodexUsagePoller({ sessionsDir: root });
      const snapshot = await poller.refresh();

      expect(snapshot.status).toBe("ok");
      expect(snapshot.data?.limitId).toBe("codex");
      expect(snapshot.data?.planType).toBe("pro");
      expect(snapshot.data?.fiveHour?.utilization).toBe(12);
      expect(snapshot.data?.fiveHour?.windowMinutes).toBe(300);
      expect(snapshot.data?.sevenDay?.utilization).toBe(34);
      expect(snapshot.data?.sevenDay?.windowMinutes).toBe(10080);
      expect(snapshot.data?.fiveHour?.resetsAt).toBe("2026-04-25T11:26:40.000Z");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

