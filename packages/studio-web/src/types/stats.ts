export interface DashboardStats {
  totalJobs: number;
  completedJobs: number;
  inProgressJobs: number;
  errorJobs: number;
  totalTokens: number;
  tokensByModel: Record<string, number>;
  tokensByAgent: Record<string, number>;
  aceAgent: { id: string; name: string; score: number } | null;
}

export interface TokenUsageEntry {
  agentId: string;
  model: string;
  tokens: number;
  recordedAt: string;
}

export interface GitActivityCommit {
  hash: string;
  shortHash?: string;
  message: string;
  author: string;
  timestamp: string;
  parents?: string[];
  parentCount?: number;
  isMerge?: boolean;
  refs?: string[];
}

export interface GitActivityBranchStatus {
  upstream: string | null;
  ahead: number;
  behind: number;
  state: "clean" | "ahead" | "behind" | "diverged" | "no-upstream";
}

export interface GitActivityWorktree {
  projectId: string;
  path: string;
  name: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  isMain: boolean;
}

export interface GitActivityRepo {
  name: string;
  path: string;
  projectId?: string | null;
  projectName?: string | null;
  worktreePath?: string | null;
  worktreeName?: string | null;
  worktreeBranch?: string | null;
  worktreeHead?: string | null;
  isWorktree?: boolean;
  isMainWorktree?: boolean | null;
  branch: string | null;
  branchStatus?: GitActivityBranchStatus;
  mergeCommitsToday?: number;
  commits: GitActivityCommit[];
}

export interface GitActivitySnapshot {
  lastUpdated: string;
  workspace: string;
  repos: GitActivityRepo[];
  projectWorktrees?: Record<string, GitActivityWorktree[]>;
  totalCommitsToday: number;
  totalMergeCommitsToday?: number;
}

export interface DailyReport {
  date: string;
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  tokenConsumption: number;
  mvpAgent: {
    id: string;
    completedTasks: number;
    totalTokens: number;
  } | null;
}
