import { create } from "zustand";
import {
  fetchGitActivity as fetchGitActivitySnapshot,
  fetchPlans as fetchPlansSnapshot,
} from "../lib/api";
import type { DailyReport, DashboardStats, GitActivitySnapshot, TokenUsageEntry } from "../types/stats";
import type { JobCard } from "../types/job-card";
import type { PlansSnapshot } from "../types/plan";

interface DashboardState {
  stats: DashboardStats;
  dailyReport: DailyReport | null;
  jobs: JobCard[];
  tokenHistory: TokenUsageEntry[];
  gitActivity: GitActivitySnapshot;
  plans: PlansSnapshot | null;
  plansLoading: boolean;
  plansError: string | null;

  setStats: (stats: DashboardStats) => void;
  setDailyReport: (report: DailyReport) => void;
  addJob: (job: JobCard) => void;
  upsertJob: (job: JobCard) => void;
  updateJob: (job: JobCard) => void;
  setJobs: (jobs: JobCard[]) => void;
  addTokenUsage: (entry: TokenUsageEntry) => void;
  setGitActivity: (activity: GitActivitySnapshot) => void;
  fetchGitActivity: () => Promise<void>;
  fetchPlans: () => Promise<void>;
}

const initialStats: DashboardStats = {
  totalJobs: 0,
  completedJobs: 0,
  inProgressJobs: 0,
  errorJobs: 0,
  totalTokens: 0,
  tokensByModel: {},
  tokensByAgent: {},
  aceAgent: null,
};

const initialGitActivity: GitActivitySnapshot = {
  lastUpdated: "",
  workspace: "",
  repos: [],
  totalCommitsToday: 0,
};

export const useDashboardStore = create<DashboardState>((set) => ({
  stats: initialStats,
  dailyReport: null,
  jobs: [],
  tokenHistory: [],
  gitActivity: initialGitActivity,
  plans: null,
  plansLoading: false,
  plansError: null,

  setStats: (stats) => set({ stats }),

  setDailyReport: (dailyReport) => set({ dailyReport }),

  addJob: (job) =>
    set((state) => ({
      jobs: [job, ...state.jobs].slice(0, 100),
    })),

  upsertJob: (job) =>
    set((state) => {
      const existingIndex = state.jobs.findIndex((entry) => entry.id === job.id);

      if (existingIndex === -1) {
        return {
          jobs: [job, ...state.jobs].slice(0, 100),
        };
      }

      return {
        jobs: state.jobs.map((entry) => (entry.id === job.id ? job : entry)),
      };
    }),

  updateJob: (job) =>
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === job.id ? job : j)),
    })),

  setJobs: (jobs) => set({ jobs }),

  addTokenUsage: (entry) =>
    set((state) => ({
      tokenHistory: [...state.tokenHistory, entry].slice(-500),
    })),

  setGitActivity: (gitActivity) => set({ gitActivity }),

  fetchGitActivity: async () => {
    const gitActivity = await fetchGitActivitySnapshot();
    set({ gitActivity });
  },

  fetchPlans: async () => {
    set({ plansLoading: true, plansError: null });

    try {
      const plans = await fetchPlansSnapshot();
      set({ plans, plansError: null });
    } catch (error) {
      set({
        plansError: error instanceof Error ? error.message : "Failed to fetch plans.",
      });
    } finally {
      set({ plansLoading: false });
    }
  },
}));
