import { create } from "zustand";

export interface ActivityEvent {
  id: string;
  agentId: string;
  agentName: string;
  emoji: string;
  type: "state-change" | "task-start" | "task-complete" | "error";
  message: string;
  timestamp: number;
}

interface ActivityState {
  events: ActivityEvent[];
  maxEvents: number;
  push: (event: Omit<ActivityEvent, "id" | "timestamp">) => void;
  clear: () => void;
}

let eventCounter = 0;

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  maxEvents: 50,

  push: (event) =>
    set((prev) => {
      const newEvent: ActivityEvent = {
        ...event,
        id: `evt-${++eventCounter}`,
        timestamp: Date.now(),
      };
      const events = [newEvent, ...prev.events].slice(0, prev.maxEvents);
      return { events };
    }),

  clear: () => set({ events: [] }),
}));
