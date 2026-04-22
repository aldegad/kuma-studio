export interface Memo {
  id: string;
  path?: string;
  title: string;
  text?: string;
  images: string[];
  createdAt: string;
  source?: "vault";
  section?: "memos" | "inbox";
}

export interface MemoListResponse {
  memos: Memo[];
  inbox?: Memo[];
}
