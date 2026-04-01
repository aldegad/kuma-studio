import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { DashboardPage } from "./components/dashboard/DashboardPage";
import { OfficePage } from "./components/office/OfficePage";
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
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/office" element={<OfficePage />} />
      </Route>
    </Routes>
  );
}
