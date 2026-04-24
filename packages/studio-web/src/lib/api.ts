import type { OfficeLayoutSnapshot } from "../types/office";
import type { TeamMetadataResponse, TeamConfigResponse, TeamPromptResponse } from "../types/agent";
import type {
  ContentListResponse,
  ContentPostStatus,
} from "../types/content";
import type { ExperimentItem, ExperimentListResponse, ExperimentSettings, ExperimentSource, ExperimentStatus } from "../types/experiment";
import type { Memo, MemoListResponse } from "../types/memo";
import type { ExtensionsCatalogResponse, StudioPluginEntry, StudioSkillEntry } from "../types/extensions";
import type {
  DailyReport,
  DashboardStats,
  GitActivitySnapshot,
} from "../types/stats";
import type { Plan, PlanItem, PlanSection, PlanWarning, PlansSnapshot } from "../types/plan";
import type { ThreadDocument, ThreadDocumentListResponse, ThreadDocumentStatus } from "../types/thread-document";
import { normalizeTeamStatusSnapshot, type TeamStatusSnapshot } from "../stores/use-team-status-store";

const KUMA_PORT = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
const BASE_URL = `http://${window.location.hostname}:${KUMA_PORT}`;

export interface ExplorerRootsResponse {
  workspaceRoot: string;
  systemRoot: string;
  projectRoots: Record<string, string>;
  worktreeRoots?: Record<string, { path: string; name: string; branch: string | null; isMain: boolean }[]>;
  globalRoots: Partial<Record<"vault" | "claude" | "codex", string>>;
}

export interface StudioViewerScrollPosition {
  top: number;
  left: number;
}

export interface StudioExplorerProjectState {
  selectedPath: string | null;
  sidebarTab: "files" | "vault";
  expandedPaths: string[];
  scrollTop: number;
  globalExpanded: Record<string, boolean>;
  vaultExpanded: Record<string, boolean>;
  viewerScrollByPath: Record<string, StudioViewerScrollPosition>;
}

export interface StudioUiState {
  version: 1;
  updatedAt: string;
  hud: {
    pinnedProjectIds: string[];
  };
  explorer: {
    open: boolean;
    projects: Record<string, StudioExplorerProjectState>;
  };
}

export type StudioUiStatePatch = {
  hud?: {
    pinnedProjectIds?: string[];
  };
  explorer?: {
    open?: boolean;
    projects?: Record<string, Partial<StudioExplorerProjectState>>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "boolean");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isViewerScrollPosition(value: unknown): value is StudioViewerScrollPosition {
  return isRecord(value) && isFiniteNumber(value.top) && isFiniteNumber(value.left);
}

function isViewerScrollRecord(value: unknown): value is Record<string, StudioViewerScrollPosition> {
  return isRecord(value) && Object.values(value).every(isViewerScrollPosition);
}

function isStudioExplorerProjectState(value: unknown): value is StudioExplorerProjectState {
  return (
    isRecord(value) &&
    (value.selectedPath === null || typeof value.selectedPath === "string") &&
    (value.sidebarTab === "files" || value.sidebarTab === "vault") &&
    Array.isArray(value.expandedPaths) &&
    value.expandedPaths.every((entry) => typeof entry === "string") &&
    isFiniteNumber(value.scrollTop) &&
    isBooleanRecord(value.globalExpanded) &&
    isBooleanRecord(value.vaultExpanded) &&
    isViewerScrollRecord(value.viewerScrollByPath)
  );
}

function isStudioUiState(value: unknown): value is StudioUiState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.updatedAt === "string" &&
    isRecord(value.hud) &&
    Array.isArray(value.hud.pinnedProjectIds) &&
    value.hud.pinnedProjectIds.every((entry) => typeof entry === "string") &&
    isRecord(value.explorer) &&
    typeof value.explorer.open === "boolean" &&
    isRecord(value.explorer.projects) &&
    Object.values(value.explorer.projects).every(isStudioExplorerProjectState)
  );
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
    typeof value.filePath === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "string" &&
    typeof value.statusColor === "string" &&
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

function isMemo(value: unknown): value is Memo {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.path === undefined || typeof value.path === "string") &&
    typeof value.title === "string" &&
    (value.text === undefined || typeof value.text === "string") &&
    Array.isArray(value.images) &&
    value.images.every((image) => typeof image === "string") &&
    typeof value.createdAt === "string" &&
    (
      value.source === undefined ||
      value.source === "vault"
    ) &&
    (
      value.section === undefined ||
      value.section === "memos" ||
      value.section === "inbox"
    )
  );
}

function isMemoListResponse(value: unknown): value is MemoListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.memos) &&
    value.memos.every(isMemo) &&
    (value.inbox === undefined || (Array.isArray(value.inbox) && value.inbox.every(isMemo)))
  );
}

function isThreadDocumentStatus(value: unknown): value is ThreadDocumentStatus {
  return value === "draft" || value === "approved" || value === "posted";
}

function isThreadDocument(value: unknown): value is ThreadDocument {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.fileName === "string" &&
    typeof value.path === "string" &&
    typeof value.title === "string" &&
    isThreadDocumentStatus(value.status) &&
    typeof value.created === "string" &&
    typeof value.updated === "string" &&
    typeof value.body === "string"
  );
}

function isThreadDocumentListResponse(value: unknown): value is ThreadDocumentListResponse {
  return (
    isRecord(value) &&
    typeof value.directory === "string" &&
    Array.isArray(value.items) &&
    value.items.every(isThreadDocument)
  );
}

function isStudioSkillEntry(value: unknown): value is StudioSkillEntry {
  return (
    isRecord(value) &&
    (value.ecosystem === "claude" || value.ecosystem === "codex") &&
    typeof value.ecosystemLabel === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.file === "string" &&
    typeof value.content === "string" &&
    typeof value.path === "string"
  );
}

function isStudioPluginEntry(value: unknown): value is StudioPluginEntry {
  return (
    isRecord(value) &&
    (value.ecosystem === "claude" || value.ecosystem === "codex") &&
    typeof value.ecosystemLabel === "string" &&
    typeof value.name === "string" &&
    typeof value.displayName === "string" &&
    typeof value.description === "string" &&
    typeof value.sourcePath === "string"
  );
}

function isExtensionsCatalogCategory(value: unknown): value is ExtensionsCatalogResponse["ecosystems"][number]["categories"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.markdown === "string"
  );
}

function isExtensionsCatalogResponse(value: unknown): value is ExtensionsCatalogResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.ecosystems) &&
    value.ecosystems.every((ecosystem) =>
      isRecord(ecosystem) &&
      typeof ecosystem.id === "string" &&
      typeof ecosystem.label === "string" &&
      typeof ecosystem.sourcePath === "string" &&
      typeof ecosystem.available === "boolean" &&
      Array.isArray(ecosystem.categories) &&
      ecosystem.categories.every(isExtensionsCatalogCategory),
    )
  );
}

function isExplorerRootsResponse(value: unknown): value is ExplorerRootsResponse {
  return (
    isRecord(value) &&
    typeof value.workspaceRoot === "string" &&
    typeof value.systemRoot === "string" &&
    isStringRecord(value.projectRoots) &&
    isRecord(value.globalRoots) &&
    Object.values(value.globalRoots).every((entry) => typeof entry === "string")
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

export async function fetchTeamConfig(): Promise<TeamConfigResponse> {
  const res = await fetch(`${BASE_URL}/studio/team-config`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch team config: ${res.statusText}`);
  return res.json();
}

export async function fetchTeamMemberPrompt(memberId: string, projectId?: string | null): Promise<TeamPromptResponse> {
  const search = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`${BASE_URL}/studio/team-prompts/${encodeURIComponent(memberId)}${search}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch team member prompt: ${res.statusText}`);
  return res.json();
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

export async function fetchMemos(): Promise<MemoListResponse> {
  const res = await fetch(`${BASE_URL}/studio/memos`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch memos: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isMemoListResponse(payload)) {
    throw new Error("Failed to fetch memos: invalid response payload");
  }
  return payload;
}

export async function createMemo(input: {
  title: string;
  text?: string;
  images: string[];
}): Promise<Memo> {
  const res = await fetch(`${BASE_URL}/studio/memos`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create memo: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isMemo(payload)) {
    throw new Error("Failed to create memo: invalid response payload");
  }
  return payload;
}

export async function deleteMemo(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/studio/memos/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to delete memo: ${res.statusText}`);
}

export async function createInboxMemo(input: {
  title?: string;
  text: string;
}): Promise<Memo> {
  const res = await fetch(`${BASE_URL}/studio/vault/inbox`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create inbox entry: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isMemo(payload)) {
    throw new Error("Failed to create inbox entry: invalid response payload");
  }
  return payload;
}

export async function fetchStudioSkills(): Promise<StudioSkillEntry[]> {
  const res = await fetch(`${BASE_URL}/studio/skills`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch skills: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isRecord(payload) || !Array.isArray(payload.skills) || !payload.skills.every(isStudioSkillEntry)) {
    throw new Error("Failed to fetch skills: invalid response payload");
  }
  return payload.skills;
}

export async function fetchStudioPlugins(): Promise<StudioPluginEntry[]> {
  const res = await fetch(`${BASE_URL}/studio/plugins`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch plugins: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isRecord(payload) || !Array.isArray(payload.plugins) || !payload.plugins.every(isStudioPluginEntry)) {
    throw new Error("Failed to fetch plugins: invalid response payload");
  }
  return payload.plugins;
}

export async function fetchExtensionsCatalog(): Promise<ExtensionsCatalogResponse> {
  const res = await fetch(`${BASE_URL}/studio/extensions-catalog`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch extensions catalog: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isExtensionsCatalogResponse(payload)) {
    throw new Error("Failed to fetch extensions catalog: invalid response payload");
  }
  return payload;
}

export async function deleteStudioSkill(skillName: string, ecosystem: "claude" | "codex" = "claude"): Promise<void> {
  const res = await fetch(`${BASE_URL}/studio/skills/${encodeURIComponent(skillName)}?ecosystem=${encodeURIComponent(ecosystem)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  const payload: unknown = await res.json();
  if (!res.ok) throw new Error(`Failed to delete skill: ${res.statusText}`);
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error("Failed to delete skill: invalid response payload");
  }
}

export async function writeStudioFile(path: string, content: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/studio/fs/write`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, content }),
  });
  const payload: unknown = await res.json();
  if (!res.ok) throw new Error(`Failed to save file: ${res.statusText}`);
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error("Failed to save file: invalid response payload");
  }
}

export async function writeStudioBinaryFile(path: string, content: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/studio/fs/write-binary`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, content }),
  });
  const payload: unknown = await res.json();
  if (!res.ok) throw new Error(`Failed to save binary file: ${res.statusText}`);
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error("Failed to save binary file: invalid response payload");
  }
}

export async function fetchStudioUiState(): Promise<StudioUiState> {
  const res = await fetch(`${BASE_URL}/studio/ui-state`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch studio UI state: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isStudioUiState(payload)) {
    throw new Error("Failed to fetch studio UI state: invalid response payload");
  }
  return payload;
}

export async function patchStudioUiState(patch: StudioUiStatePatch): Promise<StudioUiState> {
  const res = await fetch(`${BASE_URL}/studio/ui-state`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update studio UI state: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isStudioUiState(payload)) {
    throw new Error("Failed to update studio UI state: invalid response payload");
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

export async function fetchTeamStatus(project?: string | null): Promise<TeamStatusSnapshot> {
  const normalizedProject = typeof project === "string" ? project.trim() : "";
  const search = normalizedProject ? `?project=${encodeURIComponent(normalizedProject)}` : "";
  const res = await fetch(`${BASE_URL}/studio/team-status${search}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch team status: ${res.statusText}`);
  const payload: unknown = await res.json();
  const snapshot = normalizeTeamStatusSnapshot(payload);
  if (!snapshot) {
    throw new Error("Failed to fetch team status: invalid response payload");
  }
  return snapshot;
}

export async function fetchExplorerRoots(): Promise<ExplorerRootsResponse> {
  const res = await fetch(`${BASE_URL}/studio/fs/roots`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch explorer roots: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isExplorerRootsResponse(payload)) {
    throw new Error("Failed to fetch explorer roots: invalid response payload");
  }
  return payload;
}

export async function fetchContentItems(project?: string, assignee?: string | null, postStatus?: ContentPostStatus): Promise<ContentListResponse> {
  const params = new URLSearchParams();
  if (project) {
    params.set("project", project);
  }
  if (assignee !== undefined) {
    params.set("assignee", assignee ?? "unassigned");
  }
  if (postStatus) {
    params.set("postStatus", postStatus);
  }
  const search = params.size > 0 ? `?${params.toString()}` : "";
  const res = await fetch(`${BASE_URL}/studio/content${search}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch content items: ${res.statusText}`);
  return res.json();
}

export async function fetchThreadDocuments(): Promise<ThreadDocumentListResponse> {
  const res = await fetch(`${BASE_URL}/studio/vault/threads-content`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch thread documents: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isThreadDocumentListResponse(payload)) {
    throw new Error("Failed to fetch thread documents: invalid response payload");
  }
  return payload;
}

export async function createThreadDocument(input: {
  title?: string;
  body?: string;
  status?: ThreadDocumentStatus;
} = {}): Promise<ThreadDocument> {
  const res = await fetch(`${BASE_URL}/studio/vault/threads-content`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create thread document: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isThreadDocument(payload)) {
    throw new Error("Failed to create thread document: invalid response payload");
  }
  return payload;
}

export async function updateThreadDocument(
  id: string,
  patch: Partial<Pick<ThreadDocument, "title" | "body" | "status">>,
): Promise<ThreadDocument> {
  const res = await fetch(`${BASE_URL}/studio/vault/threads-content/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update thread document: ${res.statusText}`);
  const payload: unknown = await res.json();
  if (!isThreadDocument(payload)) {
    throw new Error("Failed to update thread document: invalid response payload");
  }
  return payload;
}

export async function fetchExperiments(): Promise<ExperimentListResponse> {
  const res = await fetch(`${BASE_URL}/studio/experiments`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch experiments: ${res.statusText}`);
  return res.json();
}

export async function createExperiment(input: {
  title: string;
  source: ExperimentSource;
}): Promise<ExperimentItem> {
  const res = await fetch(`${BASE_URL}/studio/experiments`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create experiment: ${res.statusText}`);
  return res.json();
}

export async function updateExperimentStatus(id: string, status: ExperimentStatus): Promise<ExperimentItem> {
  const res = await fetch(`${BASE_URL}/studio/experiments/${encodeURIComponent(id)}/status`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`Failed to update experiment status: ${res.statusText}`);
  return res.json();
}

export async function deleteExperiment(id: string): Promise<ExperimentItem> {
  const res = await fetch(`${BASE_URL}/studio/experiments/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to delete experiment: ${res.statusText}`);
  return res.json();
}

export async function updateExperimentSettings(
  settings: Partial<ExperimentSettings>,
): Promise<ExperimentSettings> {
  const res = await fetch(`${BASE_URL}/studio/experiments/settings`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Failed to update experiment settings: ${res.statusText}`);
  return res.json();
}

export async function ingestTrendExperiments(): Promise<ExperimentListResponse> {
  const res = await fetch(`${BASE_URL}/studio/experiments/ingest-trends`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to ingest trend experiments: ${res.statusText}`);
  return res.json();
}
