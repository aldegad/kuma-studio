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

const STEPS = [1, 2, 4];
const CFGS = [0.5, 1, 1.5, 2];
const gridImages = (sampler: string) =>
  STEPS.flatMap((s) => CFGS.map((c) => `/studio/memo-images/${sampler}-s${s}-cfg${c}.png`));

const INITIAL_MEMOS: Memo[] = [
  {
    id: "bench-sdxl-vs-hyper",
    title: "SDXL vs Hyper-SD 벤치마크",
    text: "동일 모델(amanatsu v11) 640×960\nLightning(4step,euler_a,cfg1.5): 웜 22.1s\nHyper-SD(2step,euler,cfg1.0): 웜 6.0s → 73% 빠름",
    images: [
      "/studio/memo-images/lightning-warm.png",
      "/studio/memo-images/hyper-warm.png",
    ],
    createdAt: "2026-04-03T01:50:00.000Z",
  },
  {
    id: "bench-euler-grid",
    title: "Hyper-SD euler 그리드 (12장)",
    text: "step(1,2,4) × cfg(0.5,1.0,1.5,2.0)\n모델: amanatsu v11, 640×960, seed=42",
    images: gridImages("euler"),
    createdAt: "2026-04-03T01:52:00.000Z",
  },
  {
    id: "bench-euler_a-grid",
    title: "Hyper-SD euler_a 그리드 (12장)",
    text: "step(1,2,4) × cfg(0.5,1.0,1.5,2.0)\n최종 선택: euler_a / 4step / cfg1.5",
    images: gridImages("euler_a"),
    createdAt: "2026-04-03T01:55:00.000Z",
  },
];

export const useMemoStore = create<MemoState>()(
  persist(
    (set) => ({
      memos: INITIAL_MEMOS,

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
    {
      name: "kuma-memo-store",
      version: 1,
      migrate: (persisted: any, version: number) => {
        if (version === 0) return { ...persisted, memos: INITIAL_MEMOS };
        return persisted as MemoState;
      },
    },
  ),
);
