import { create } from "zustand";
import type { DailyReport, DashboardStats, TokenUsageEntry } from "../types/stats";
import type { JobCard } from "../types/job-card";

interface DashboardState {
  stats: DashboardStats;
  dailyReport: DailyReport | null;
  jobs: JobCard[];
  tokenHistory: TokenUsageEntry[];

  setStats: (stats: DashboardStats) => void;
  setDailyReport: (report: DailyReport) => void;
  addJob: (job: JobCard) => void;
  upsertJob: (job: JobCard) => void;
  updateJob: (job: JobCard) => void;
  setJobs: (jobs: JobCard[]) => void;
  addTokenUsage: (entry: TokenUsageEntry) => void;
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

export const useDashboardStore = create<DashboardState>((set) => ({
  stats: initialStats,
  dailyReport: null,
  jobs: [],
  tokenHistory: [],

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
}));
