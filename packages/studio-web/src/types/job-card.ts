export type JobStatus = "queued" | "in_progress" | "completed" | "error";

export interface JobCard {
  id: string;
  sessionId: string | null;
  status: JobStatus;
  message: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  tokensUsed: number;
  model: string | null;
  target: {
    tabId: number | null;
    url: string | null;
    urlContains: string | null;
  } | null;
  anchor: {
    selector: string | null;
    selectorPath: string | null;
    rect: { x: number; y: number; width: number; height: number } | null;
  } | null;
}
