export type ExperimentSource = "ai-trend" | "user-idea";
export type ExperimentStatus = "proposed" | "in-progress" | "success" | "failed" | "abandoned";

export interface ExperimentItem {
  id: string;
  title: string;
  source: ExperimentSource;
  status: ExperimentStatus;
  sourceContentId: string | null;
  sourceTrendId: string | null;
  researchScore: number | null;
  researchQuestion: string | null;
  resultSummary: string | null;
  reportSummary: string | null;
  reportMarkdown: string | null;
  reportGeneratedAt: string | null;
  resultContentId: string | null;
  branch: string | null;
  worktree: string | null;
  pr_url: string | null;
  thread_draft: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExperimentSettings {
  trendSources: string[];
  trendFetchIntervalMinutes: number;
  autoProposeTime: string;
  lastTrendIngestedAt: string | null;
}

export interface ExperimentListResponse {
  items: ExperimentItem[];
  settings: ExperimentSettings;
}
