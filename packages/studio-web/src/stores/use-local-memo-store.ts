import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface LocalMemo {
  id: string;
  title: string;
  text?: string;
  images: string[];
  createdAt: string;
}

interface LocalMemoState {
  memos: LocalMemo[];
  addMemo: (memo: Omit<LocalMemo, "id" | "createdAt">) => void;
  deleteMemo: (id: string) => void;
}

export const useLocalMemoStore = create<LocalMemoState>()(
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
