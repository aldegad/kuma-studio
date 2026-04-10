export type ThreadDocumentStatus = "draft" | "approved" | "posted";

export interface ThreadDocument {
  id: string;
  fileName: string;
  path: string;
  title: string;
  status: ThreadDocumentStatus;
  created: string;
  updated: string;
  body: string;
}

export interface ThreadDocumentListResponse {
  directory: string;
  items: ThreadDocument[];
}
