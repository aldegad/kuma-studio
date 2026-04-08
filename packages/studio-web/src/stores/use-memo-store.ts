import { create } from "zustand";
import { createInboxMemo, createMemo, deleteMemo as deleteMemoRequest, fetchMemos } from "../lib/api";
import type { Memo } from "../types/memo";

interface MemoState {
  memos: Memo[];
  inbox: Memo[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  loadMemos: () => Promise<void>;
  addMemo: (memo: Omit<Memo, "id" | "createdAt">) => Promise<void>;
  addInbox: (entry: { title?: string; text: string }) => Promise<void>;
  deleteMemo: (id: string) => Promise<void>;
}

export function sortMemosNewestFirst(memos: Memo[]): Memo[] {
  return [...memos].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export const useMemoStore = create<MemoState>((set) => ({
  memos: [],
  inbox: [],
  loading: false,
  initialized: false,
  error: null,

  loadMemos: async () => {
    set((state) => ({
      loading: true,
      error: null,
      initialized: state.initialized,
    }));

    try {
      const { memos, inbox = [] } = await fetchMemos();
      set({
        memos: sortMemosNewestFirst(memos),
        inbox: sortMemosNewestFirst(inbox),
        loading: false,
        initialized: true,
        error: null,
      });
    } catch (error) {
      set({
        loading: false,
        initialized: true,
        error: error instanceof Error ? error.message : "Failed to load memos.",
      });
    }
  },

  addMemo: async (memo) => {
    set({ loading: true, error: null });
    try {
      const created = await createMemo(memo);
      set((state) => ({
        memos: sortMemosNewestFirst([created, ...state.memos]),
        loading: false,
        initialized: true,
        error: null,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to create memo.",
      });
      throw error;
    }
  },

  addInbox: async (entry) => {
    set({ loading: true, error: null });
    try {
      const created = await createInboxMemo(entry);
      set((state) => ({
        inbox: sortMemosNewestFirst([created, ...state.inbox]),
        loading: false,
        initialized: true,
        error: null,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to create inbox entry.",
      });
      throw error;
    }
  },

  deleteMemo: async (id) => {
    set({ loading: true, error: null });
    try {
      await deleteMemoRequest(id);
      set((state) => ({
        memos: state.memos.filter((memo) => memo.id !== id),
        inbox: state.inbox.filter((memo) => memo.id !== id),
        loading: false,
        initialized: true,
        error: null,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to delete memo.",
      });
      throw error;
    }
  },
}));
