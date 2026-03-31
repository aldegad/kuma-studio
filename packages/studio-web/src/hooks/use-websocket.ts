import { useEffect } from "react";
import { useWsStore } from "../stores/use-ws-store";
import { useDashboardStore } from "../stores/use-dashboard-store";
import { useOfficeStore } from "../stores/use-office-store";

interface StudioEvent {
  type: "kuma-studio:event";
  event:
    | { kind: "job-card-update"; card: import("../types/job-card").JobCard }
    | { kind: "agent-state-change"; agentId: string; state: import("../types/agent").AgentState }
    | { kind: "token-usage"; agentId: string; tokens: number; model: string }
    | { kind: "stats-snapshot"; stats: import("../types/stats").DashboardStats }
    | { kind: "office-scene-update"; scene: import("../types/office").OfficeScene };
}

export function useWebSocket() {
  const { connect, ws, status } = useWsStore();
  const { addJob, updateJob, setStats, addTokenUsage } = useDashboardStore();
  const { updateCharacterState, setScene } = useOfficeStore();

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data: StudioEvent = JSON.parse(event.data);
        if (data.type !== "kuma-studio:event") return;

        const evt = data.event;
        switch (evt.kind) {
          case "job-card-update":
            updateJob(evt.card);
            break;
          case "agent-state-change":
            updateCharacterState(evt.agentId, evt.state);
            break;
          case "token-usage":
            addTokenUsage({
              agentId: evt.agentId,
              model: evt.model,
              tokens: evt.tokens,
              recordedAt: new Date().toISOString(),
            });
            break;
          case "stats-snapshot":
            setStats(evt.stats);
            break;
          case "office-scene-update":
            setScene(evt.scene);
            break;
        }
      } catch {
        // ignore non-JSON or unknown messages
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws, addJob, updateJob, setStats, addTokenUsage, updateCharacterState, setScene]);

  return { status };
}
