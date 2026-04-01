import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { StudioPage } from "./pages/StudioPage";
import { fetchTeamMetadata } from "./lib/api";
import { useOfficeStore } from "./stores/use-office-store";
import { applyTeamMetadata } from "./types/agent";

export default function App() {
  const syncCharactersFromTeam = useOfficeStore((state) => state.syncCharactersFromTeam);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const metadata = await fetchTeamMetadata();
        if (cancelled) return;
        const nextTeam = applyTeamMetadata(metadata);
        syncCharactersFromTeam(nextTeam);
      } catch {
        // Keep the hardcoded fallback when the API is unavailable.
      }
    })();

    return () => { cancelled = true; };
  }, [syncCharactersFromTeam]);

  return (
    <Routes>
      <Route path="/" element={<StudioPage />} />
    </Routes>
  );
}
