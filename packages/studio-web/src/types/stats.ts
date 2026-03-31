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
