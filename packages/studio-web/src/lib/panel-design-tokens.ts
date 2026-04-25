export const usageProviderAccents = {
  claude: {
    label: "Claude",
    color: "#d97706",
    soft: "rgba(217, 119, 6, 0.14)",
    track: "rgba(217, 119, 6, 0.12)",
    border: "rgba(217, 119, 6, 0.26)",
  },
  codex: {
    label: "Codex",
    color: "#0284c7",
    soft: "rgba(2, 132, 199, 0.14)",
    track: "rgba(2, 132, 199, 0.12)",
    border: "rgba(2, 132, 199, 0.26)",
  },
} as const;

export type UsageProviderAccent = keyof typeof usageProviderAccents;

export const planPanelTokens = {
  accent: "#059669",
  progressTrack: "rgba(5, 150, 105, 0.12)",
  divider: "rgba(5, 150, 105, 0.22)",
} as const;

export const planStatusTokens: Record<string, { dot: string; label: string }> = {
  completed: { dot: "#16a34a", label: "완료" },
  cancelled: { dot: "#64748b", label: "취소" },
  active: { dot: "#2563eb", label: "진행 중" },
  in_progress: { dot: "#2563eb", label: "진행 중" },
  hold: { dot: "#ca8a04", label: "보류" },
  blocked: { dot: "#ea580c", label: "컨펌 대기" },
  failed: { dot: "#dc2626", label: "실패" },
  error: { dot: "#dc2626", label: "에러" },
  draft: { dot: "#64748b", label: "초안" },
  archived: { dot: "#64748b", label: "보관됨" },
};

export const defaultPlanStatusToken = { dot: "#64748b", label: "" } as const;
