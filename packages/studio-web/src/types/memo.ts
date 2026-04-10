export interface Memo {
  id: string;
  path?: string;
  title: string;
  text?: string;
  images: string[];
  createdAt: string;
  source?: "vault" | "legacy-memo" | "user-memo";
  section?: "vault" | "inbox" | "user-memo";
}

export interface MemoListResponse {
  memos: Memo[];
  inbox?: Memo[];
}
