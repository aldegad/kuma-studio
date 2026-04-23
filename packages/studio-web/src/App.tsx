import { useEffect, useRef } from "react";
import { Routes, Route } from "react-router-dom";
import { StudioPage } from "./pages/StudioPage";
import { MarkdownPrintPage } from "./pages/MarkdownPrintPage";
import { useOfficeStore } from "./stores/use-office-store";
import { useTeamConfigStore } from "./stores/use-team-config-store";
import { useWsStore } from "./stores/use-ws-store";

export default function App() {
  const syncCharactersFromTeam = useOfficeStore((state) => state.syncCharactersFromTeam);
  const fetchTeamConfigFromStore = useTeamConfigStore((state) => state.fetch);
  const wsStatus = useWsStore((state) => state.status);
  const prevWsStatus = useRef(wsStatus);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const agents = await fetchTeamConfigFromStore();
        if (cancelled) return;
        syncCharactersFromTeam(agents);
      } catch {
        // Keep the build-time fallback when the API is unavailable.
      }
    })();

    return () => { cancelled = true; };
  }, [syncCharactersFromTeam, fetchTeamConfigFromStore]);

  // Re-fetch team config when WebSocket reconnects (e.g. after server restart)
  useEffect(() => {
    const prev = prevWsStatus.current;
    prevWsStatus.current = wsStatus;

    if (prev !== "connected" && wsStatus === "connected") {
      void (async () => {
        try {
          const agents = await fetchTeamConfigFromStore();
          syncCharactersFromTeam(agents);
        } catch {
          // Ignore — existing team data stays.
        }
      })();
    }
  }, [wsStatus, fetchTeamConfigFromStore, syncCharactersFromTeam]);

  return (
    <Routes>
      <Route path="/" element={<StudioPage />} />
      <Route path="/markdown-print" element={<MarkdownPrintPage />} />
    </Routes>
  );
}
