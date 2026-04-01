import type { OfficeLayoutSnapshot } from "../types/office";
import type { TeamMetadataResponse } from "../types/agent";
import type { DailyReport, DashboardStats } from "../types/stats";

const BASE_URL = `http://${window.location.hostname}:4312`;

export async function fetchJobCards(sessionId?: string): Promise<unknown> {
  const search = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const res = await fetch(`${BASE_URL}/job-card${search}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Failed to fetch job cards: ${res.statusText}`);
  return res.json();
}

export async function fetchSelection(): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/selection`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Failed to fetch selection: ${res.statusText}`);
  return res.json();
}

export async function fetchStats(): Promise<DashboardStats> {
  const res = await fetch(`${BASE_URL}/studio/stats`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.statusText}`);
  return res.json();
}

export async function fetchDailyReport(): Promise<DailyReport> {
  const res = await fetch(`${BASE_URL}/studio/daily-report`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch daily report: ${res.statusText}`);
  return res.json();
}

export async function fetchOfficeLayout(): Promise<OfficeLayoutSnapshot> {
  const res = await fetch(`${BASE_URL}/studio/office-layout`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch office layout: ${res.statusText}`);
  return res.json();
}

export async function fetchTeamMetadata(): Promise<TeamMetadataResponse> {
  const res = await fetch(`${BASE_URL}/api/team-metadata`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch team metadata: ${res.statusText}`);
  return res.json();
}

export async function fetchGitLog(): Promise<{ commits: { hash: string; message: string }[] }> {
  const res = await fetch(`${BASE_URL}/studio/git-log`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch git log: ${res.statusText}`);
  return res.json();
}

export async function saveOfficeLayout(layout: OfficeLayoutSnapshot): Promise<OfficeLayoutSnapshot> {
  const res = await fetch(`${BASE_URL}/studio/office-layout`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(layout),
  });
  if (!res.ok) throw new Error(`Failed to save office layout: ${res.statusText}`);
  return res.json();
}
