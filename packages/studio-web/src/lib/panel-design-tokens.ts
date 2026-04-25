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
  accentSoft: "rgba(5, 150, 105, 0.14)",
  progressTrack: "rgba(5, 150, 105, 0.12)",
  divider: "rgba(5, 150, 105, 0.22)",
  rowTint: "rgba(5, 150, 105, 0.08)",
} as const;

export const planStatusTokens: Record<string, { dot: string; glow: string; label: string }> = {
  completed: { dot: "#16a34a", glow: "rgba(22, 163, 74, 0.34)", label: "완료" },
  cancelled: { dot: "#64748b", glow: "rgba(100, 116, 139, 0.24)", label: "취소" },
  active: { dot: "#2563eb", glow: "rgba(37, 99, 235, 0.34)", label: "진행 중" },
  in_progress: { dot: "#2563eb", glow: "rgba(37, 99, 235, 0.34)", label: "진행 중" },
  hold: { dot: "#ca8a04", glow: "rgba(202, 138, 4, 0.34)", label: "보류" },
  blocked: { dot: "#ea580c", glow: "rgba(234, 88, 12, 0.34)", label: "컨펌 대기" },
  failed: { dot: "#dc2626", glow: "rgba(220, 38, 38, 0.34)", label: "실패" },
  error: { dot: "#dc2626", glow: "rgba(220, 38, 38, 0.34)", label: "에러" },
  draft: { dot: "#64748b", glow: "rgba(100, 116, 139, 0.22)", label: "초안" },
  archived: { dot: "#64748b", glow: "rgba(100, 116, 139, 0.18)", label: "보관됨" },
};

export const defaultPlanStatusToken = { dot: "#64748b", glow: "rgba(100, 116, 139, 0.18)", label: "" } as const;
