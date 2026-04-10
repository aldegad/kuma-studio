import { teamData } from "./team-schema";

export const COLORS = {
  kumaBrown: "#5C4033",
  kumaOrange: "#FF8C42",
  kumaGreen: "#4CAF50",
  kumaCream: "#FFF8F0",
  kumaWood: "#8B6914",
} as const;

export const TEAM_COLORS: Record<string, string> = {
  system: "#5C4033",
  analytics: "#FF8C42",
  dev: "#4CAF50",
  strategy: "#6366F1",
};

export const TEAM_LABELS_KO: Record<string, string> = Object.fromEntries(
  teamData.teams.map((team) => [team.id, team.name.ko] as const),
);

export const STATE_LABELS: Record<string, string> = {
  idle: "Idle",
  offline: "Offline",
  working: "Working",
  thinking: "Thinking",
  completed: "Completed",
  error: "Error",
};

export const STATE_LABELS_KO: Record<string, string> = {
  idle: "대기 중",
  offline: "오프라인",
  working: "작업 중",
  thinking: "생각 중",
  completed: "완료",
  error: "오류",
};

export const STATE_COLORS: Record<string, string> = {
  idle: "#9CA3AF",
  offline: "#94A3B8",
  working: "#3B82F6",
  thinking: "#F59E0B",
  completed: "#10B981",
  error: "#EF4444",
};

/** Human-readable skill display names */
export const SKILL_DISPLAY_NAMES: Record<string, string> = {
  "kuma": "쿠마 총괄",
  "dev-team": "개발팀 운영",
  "analytics-team": "분석팀 운영",
  "strategy-team": "전략팀 운영",
  "frontend-design": "프론트엔드 디자인",
  "gateproof-full-security-check": "보안 감사",
  "security-threat-intel": "위협 인텔리전스",
  "kuma-picker": "브라우저 피커",
  "nano-banana": "이미지 생성",
  "imagegen": "이미지 생성",
  "codex-autoresearch": "자율 탐색",
  "codex-autoresearch:fix": "자동 수정",
  "codex-autoresearch:debug": "자동 디버깅",
  "codex-autoresearch:learn": "코드 학습",
  "codex-autoresearch:ship": "배포 워크플로",
  "codex-autoresearch:security": "보안 감사",
  "codex-autoresearch:plan": "계획 수립",
  "codex-autoresearch:reason": "추론 엔진",
  "codex-autoresearch:scenario": "시나리오 분석",
  "codex-autoresearch:predict": "예측 분석",
};

/** Get display name for a skill ID */
export function getSkillDisplayName(skillId: string): string {
  return SKILL_DISPLAY_NAMES[skillId] ?? skillId.replace(/^codex-autoresearch:/, "").replace(/-/g, " ");
}

/** Format model name for display */
export function formatModelName(model: string | undefined): string | null {
  if (!model) return null;
  if (model.includes("opus")) return "Claude Opus 4.6";
  if (model.includes("sonnet")) return "Claude Sonnet 4.6";
  if (model.startsWith("gpt-5")) {
    if (model.includes("mini")) return "GPT-5.4 mini";
    if (model.includes("nano")) return "GPT-5.4 nano";
    return "GPT-5.4";
  }
  if (model.includes("o4-mini")) return "o4-mini";
  return model;
}

/** Default effort/speed per model family (used when no live data) */
export function getModelDefaults(model: string | undefined): { effort: string | null; speed: string | null } {
  if (!model) return { effort: null, speed: null };
  if (model.includes("opus") || model.includes("sonnet") || model.includes("haiku")) {
    return { effort: "high", speed: null };
  }
  if (model.startsWith("gpt-5") || model.includes("codex")) {
    return { effort: "xhigh", speed: "fast" };
  }
  return { effort: null, speed: null };
}

/** Full model detail: "Claude Opus 4.6 · high" or "GPT-5.4 · xhigh · fast" */
export function formatModelDetail(
  model: string | undefined,
  runtime?: { effort?: string | null; speed?: string | null },
): string | null {
  const name = formatModelName(model);
  if (!name) return null;
  const defaults = getModelDefaults(model);
  const effort = runtime?.effort ?? defaults.effort;
  const speed = runtime?.speed ?? defaults.speed;
  const parts = [name];
  if (effort) parts.push(effort);
  if (speed) parts.push(speed);
  return parts.join(" · ");
}

export function modelBadgeClass(model: string | undefined): string {
  if (!model) return "bg-stone-100 text-stone-400";
  if (model.includes("opus")) return "bg-indigo-100 text-indigo-600";
  if (model.includes("sonnet")) return "bg-blue-100 text-blue-600";
  if (model.startsWith("gpt-5") || model.includes("codex")) return "bg-emerald-100 text-emerald-700";
  return "bg-stone-100 text-stone-400";
}

/** Effort display labels (compact) */
const EFFORT_LABELS: Record<string, string> = {
  low: "lo",
  medium: "med",
  high: "hi",
  xhigh: "xhigh",
};

/** Format effort for compact display */
export function formatEffort(effort: string | null | undefined): string | null {
  if (!effort) return null;
  return EFFORT_LABELS[effort.toLowerCase()] ?? effort;
}

/** Effort badge color class */
export function effortColorClass(effort: string | null | undefined): string {
  if (!effort) return "";
  switch (effort.toLowerCase()) {
    case "xhigh": return "text-amber-500";
    case "high": return "text-orange-500";
    case "medium": return "text-yellow-600";
    case "low": return "text-stone-400";
    default: return "text-stone-400";
  }
}

/** Context remaining color: green > 50%, amber > 20%, red <= 20% */
export function contextBarColor(percent: number): string {
  if (percent > 50) return "#22c55e";
  if (percent > 20) return "#f59e0b";
  return "#ef4444";
}
