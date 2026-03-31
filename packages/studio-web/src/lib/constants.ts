export const COLORS = {
  kumaBrown: "#5C4033",
  kumaOrange: "#FF8C42",
  kumaGreen: "#4CAF50",
  kumaCream: "#FFF8F0",
  kumaWood: "#8B6914",
} as const;

export const TEAM_COLORS: Record<string, string> = {
  management: "#5C4033",
  analytics: "#FF8C42",
  dev: "#4CAF50",
  strategy: "#6366F1",
};

export const STATE_LABELS: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  thinking: "Thinking",
  completed: "Completed",
  error: "Error",
};

export const STATE_COLORS: Record<string, string> = {
  idle: "#9CA3AF",
  working: "#3B82F6",
  thinking: "#F59E0B",
  completed: "#10B981",
  error: "#EF4444",
};
