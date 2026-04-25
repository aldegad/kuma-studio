import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createCodexUsagePoller } from "./codex-usage-poll.mjs";

describe("createCodexUsagePoller", () => {
  it("reads Codex limits and credits from the OAuth-backed usage API", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-codex-usage-"));
    try {
      const authPath = join(root, "auth.json");
      await writeFile(authPath, JSON.stringify({ tokens: { access_token: "test-token" } }), "utf8");

      const poller = createCodexUsagePoller({
        authPath,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            plan_type: "pro",
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1777116400 },
              secondary_window: { used_percent: 34, limit_window_seconds: 604800, reset_at: 1777427763 },
            },
            credits: {
              has_credits: true,
              unlimited: false,
              overage_limit_reached: false,
              balance: "1000",
              approx_local_messages: [250, 1300],
              approx_cloud_messages: [40, 250],
            },
            spend_control: { reached: false },
          }),
        }),
      });
      const snapshot = await poller.refresh();

      expect(snapshot.status).toBe("ok");
      expect(snapshot.data?.limitId).toBe("codex");
      expect(snapshot.data?.planType).toBe("pro");
      expect(snapshot.data?.fiveHour?.utilization).toBe(12);
      expect(snapshot.data?.fiveHour?.windowMinutes).toBe(300);
      expect(snapshot.data?.sevenDay?.utilization).toBe(34);
      expect(snapshot.data?.sevenDay?.windowMinutes).toBe(10080);
      expect(snapshot.data?.credits?.hasCredits).toBe(true);
      expect(snapshot.data?.credits?.balance).toBe("1000");
      expect(snapshot.data?.credits?.approxLocalMessages).toEqual([250, 1300]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks stale session-log snapshots when the usage API fails", async () => {
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

      const poller = createCodexUsagePoller({
        sessionsDir: root,
        authPath: join(root, "missing-auth.json"),
        fetchImpl: async () => {
          throw new Error("should not be reached");
        },
      });
      const snapshot = await poller.refresh();

      expect(snapshot.status).toBe("error");
      expect(snapshot.error).toContain("missing-auth.json");
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
