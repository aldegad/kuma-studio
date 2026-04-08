export type ContentType = "text" | "image" | "video" | "research-result";
export type ContentStatus = "draft" | "ready" | "posted" | "hold";
export type ContentPostStatus = "draft" | "preview" | "approved" | "ready";
export type ThreadPostFormat = "thread" | "single";

export interface ContentThreadPost {
  hook: string;
  bodyLines: string[];
  cta: string;
  format: ThreadPostFormat;
}

export interface ContentResearchBreakdown {
  novelty: number;
  feasibility: number;
  engagement: number;
  recency: number;
}

export interface ContentItem {
  id: string;
  project: string;
  type: ContentType;
  title: string;
  body: string;
  status: ContentStatus;
  assignee: string | null;
  postStatus: ContentPostStatus;
  threadPosts: ContentThreadPost[];
  sourceTrendId: string | null;
  sourceLinks: string[];
  researchSuggestion: boolean;
  researchScore: number | null;
  researchBreakdown: ContentResearchBreakdown | null;
  experimentId: string | null;
  createdAt: string;
  updatedAt: string;
  scheduledFor: string | null;
}

export interface ContentListResponse {
  items: ContentItem[];
}

export interface ContentResearchStartResponse {
  created: boolean;
  content: ContentItem | null;
  experiment: {
    id: string;
    status: string;
    branch: string | null;
    worktree: string | null;
  } | null;
}
