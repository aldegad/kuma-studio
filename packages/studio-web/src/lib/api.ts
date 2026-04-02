import type { OfficeLayoutSnapshot } from "../types/office";
import type { TeamMetadataResponse } from "../types/agent";
import type {
  DailyReport,
  DashboardStats,
  GitActivitySnapshot,
} from "../types/stats";
import type { Plan, PlanItem, PlanSection, PlanWarning, PlansSnapshot } from "../types/plan";

const KUMA_PORT = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
const BASE_URL = `http://${window.location.hostname}:${KUMA_PORT}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTeamMetadataMember(
  value: unknown,
): value is TeamMetadataResponse["teams"][number]["members"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.emoji === "string" &&
    typeof value.displayName === "string" &&
    typeof value.model === "string" &&
    typeof value.role === "string"
  );
}

function isTeamMetadataResponse(value: unknown): value is TeamMetadataResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.teams) &&
    value.teams.every(
      (team) =>
        isRecord(team) &&
        typeof team.name === "string" &&
        typeof team.emoji === "string" &&
        Array.isArray(team.members) &&
        team.members.every(isTeamMetadataMember),
    )
  );
}

function isGitActivityCommit(
  value: unknown,
): value is GitActivitySnapshot["repos"][number]["commits"][number] {
  return (
    isRecord(value) &&
    typeof value.hash === "string" &&
    typeof value.message === "string" &&
    typeof value.author === "string" &&
    typeof value.timestamp === "string"
  );
}

function isGitActivityRepo(
  value: unknown,
): value is GitActivitySnapshot["repos"][number] {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.path === "string" &&
    (value.branch === null || typeof value.branch === "string") &&
    Array.isArray(value.commits) &&
    value.commits.every(isGitActivityCommit)
  );
}

function isGitActivitySnapshot(value: unknown): value is GitActivitySnapshot {
  return (
    isRecord(value) &&
    typeof value.lastUpdated === "string" &&
    typeof value.workspace === "string" &&
    Array.isArray(value.repos) &&
    value.repos.every(isGitActivityRepo) &&
    isFiniteNumber(value.totalCommitsToday)
  );
}

function isDailyReportMvpAgent(
  value: unknown,
): value is NonNullable<DailyReport["mvpAgent"]> {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isFiniteNumber(value.completedTasks) &&
    isFiniteNumber(value.totalTokens)
  );
}

function isDailyReport(value: unknown): value is DailyReport {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    isFiniteNumber(value.totalTasks) &&
    isFiniteNumber(value.completedTasks) &&
    isFiniteNumber(value.completionRate) &&
    isFiniteNumber(value.tokenConsumption) &&
    (value.mvpAgent === null || isDailyReportMvpAgent(value.mvpAgent))
  );
}

function isPlanWarning(value: unknown): value is PlanWarning {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

function isPlanItem(value: unknown): value is PlanItem {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    typeof value.checked === "boolean" &&
    (value.commitHash === null || typeof value.commitHash === "string")
  );
}

function isPlanSection(value: unknown): value is PlanSection {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    Array.isArray(value.items) &&
    value.items.every(isPlanItem)
  );
}

function isPlan(value: unknown): value is Plan {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "string" &&
    (value.created === null || typeof value.created === "string") &&
    Array.isArray(value.sections) &&
    value.sections.every(isPlanSection) &&
    typeof value.totalItems === "number" &&
    typeof value.checkedItems === "number" &&
    typeof value.completionRate === "number" &&
    Array.isArray(value.warnings) &&
    value.warnings.every(isPlanWarning)
  );
}

function isPlansSnapshot(value: unknown): value is PlansSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.plans) &&
    value.plans.every(isPlan) &&
    typeof value.totalItems === "number" &&
    typeof value.checkedItems === "number" &&
    typeof value.overallCompletionRate === "number"
  );
}

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
  const res = await fetch(`${BASE_URL}/dev-selection`, {
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
  const payload: unknown = await res.json();
  if (!isDailyReport(payload)) {
    throw new Error("Failed to fetch daily report: invalid response payload");
  }
  return payload;
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
  const payload: unknown = await res.json();
  if (!isTeamMetadataResponse(payload)) {
    throw new Error("Failed to fetch team metadata: invalid response payload");
  }
  return payload;
}

export async function fetchGitLog(): Promise<{ commits: { hash: string; message: string }[] }> {
  const res = await fetch(`${BASE_URL}/studio/git-log`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch git log: ${res.statusText}`);
  return res.json();
}

export async function fetchGitActivity(): Promise<GitActivitySnapshot> {
  const res = await fetch(`${BASE_URL}/studio/git-activity`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch git activity: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isGitActivitySnapshot(payload)) {
    throw new Error("Failed to fetch git activity: invalid response payload");
  }
  return payload;
}

export async function fetchPlans(): Promise<PlansSnapshot> {
  const res = await fetch(`${BASE_URL}/studio/plans`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch plans: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isPlansSnapshot(payload)) {
    throw new Error("Failed to fetch plans: invalid response payload");
  }
  return payload;
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
