import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { StudioPage } from "./pages/StudioPage";
import { useOfficeStore } from "./stores/use-office-store";
import { useTeamConfigStore } from "./stores/use-team-config-store";

export default function App() {
  const syncCharactersFromTeam = useOfficeStore((state) => state.syncCharactersFromTeam);
  const fetchTeamConfigFromStore = useTeamConfigStore((state) => state.fetch);

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

  return (
    <Routes>
      <Route path="/" element={<StudioPage />} />
    </Routes>
  );
}
