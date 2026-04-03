import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Memo {
  id: string;
  title: string;
  text?: string;
  images: string[];
  createdAt: string;
}

interface MemoState {
  memos: Memo[];
  addMemo: (memo: Omit<Memo, "id" | "createdAt">) => void;
  deleteMemo: (id: string) => void;
}

export const useMemoStore = create<MemoState>()(
  persist(
    (set) => ({
      memos: [],

      addMemo: (memo) =>
        set((state) => ({
          memos: [
            {
              ...memo,
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
            },
            ...state.memos,
          ],
        })),

      deleteMemo: (id) =>
        set((state) => ({
          memos: state.memos.filter((m) => m.id !== id),
        })),
    }),
    { name: "kuma-memo-store" },
  ),
);
