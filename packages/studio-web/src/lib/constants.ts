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

export const TEAM_LABELS_KO: Record<string, string> = {
  management: "총괄",
  analytics: "분석팀",
  dev: "개발팀",
  strategy: "전략팀",
};

export const STATE_LABELS: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  thinking: "Thinking",
  completed: "Completed",
  error: "Error",
};

export const STATE_LABELS_KO: Record<string, string> = {
  idle: "대기 중",
  working: "작업 중",
  thinking: "생각 중",
  completed: "완료",
  error: "오류",
};

export const STATE_COLORS: Record<string, string> = {
  idle: "#9CA3AF",
  working: "#3B82F6",
  thinking: "#F59E0B",
  completed: "#10B981",
  error: "#EF4444",
};
