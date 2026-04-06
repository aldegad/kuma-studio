export type ContentType = "text" | "image" | "video";
export type ContentStatus = "draft" | "ready" | "posted" | "hold";

export interface ContentItem {
  id: string;
  project: string;
  type: ContentType;
  title: string;
  body: string;
  status: ContentStatus;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  scheduledFor: string | null;
}

export interface ContentListResponse {
  items: ContentItem[];
}
