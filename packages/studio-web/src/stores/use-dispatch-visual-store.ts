import { create } from "zustand";

const DEFAULT_BUBBLE_DURATION_MS = 5_000;
const MAX_BUBBLE_LINES = 3;
const MAX_LINE_LENGTH = 24;
const bubbleTimers = new Map<string, ReturnType<typeof setTimeout>>();

export type DispatchBubbleKind = "instruction" | "question" | "answer" | "status" | "note" | "blocker";

interface DispatchVisualState {
  bubbles: Record<string, string[]>;
  showBubble: (memberId: string, text: string, kind?: DispatchBubbleKind, durationMs?: number) => void;
  clearBubble: (memberId: string) => void;
}

function clearBubbleTimer(memberId: string) {
  const timer = bubbleTimers.get(memberId);
  if (timer) {
    clearTimeout(timer);
    bubbleTimers.delete(memberId);
  }
}

function wrapBubbleText(text: string): string[] {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= MAX_LINE_LENGTH) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (word.length <= MAX_LINE_LENGTH) {
      current = word;
      continue;
    }

    let remaining = word;
    while (remaining.length > MAX_LINE_LENGTH && lines.length < MAX_BUBBLE_LINES) {
      lines.push(remaining.slice(0, MAX_LINE_LENGTH));
      remaining = remaining.slice(MAX_LINE_LENGTH);
    }
    current = remaining;
  }

  if (current && lines.length < MAX_BUBBLE_LINES) {
    lines.push(current);
  }

  if (lines.length === 0) {
    lines.push(normalized.slice(0, MAX_LINE_LENGTH));
  }

  if (lines.length > MAX_BUBBLE_LINES) {
    return lines.slice(0, MAX_BUBBLE_LINES);
  }

  return lines;
}

export function formatDispatchBubbleLines(text: string, kind: DispatchBubbleKind = "note"): string[] {
  const prefix = kind === "question"
    ? "? "
    : kind === "answer"
      ? "↩ "
      : kind === "status"
        ? "… "
        : kind === "blocker"
          ? "! "
          : "";
  const normalized = `${prefix}${String(text ?? "").trim()}`.trim();
  const lines = wrapBubbleText(normalized);
  if (lines.length === 0) {
    return [];
  }

  const truncatedSource = normalized.replace(/\s+/gu, " ").trim();
  const visibleLength = lines.join("").length;
  if (truncatedSource.length > visibleLength && lines.length > 0) {
    const next = [...lines];
    const lastIndex = next.length - 1;
    const trimmed = next[lastIndex].slice(0, Math.max(0, MAX_LINE_LENGTH - 1)).trimEnd();
    next[lastIndex] = trimmed ? `${trimmed}…` : "…";
    return next;
  }

  return lines;
}

export const useDispatchVisualStore = create<DispatchVisualState>((set) => ({
  bubbles: {},

  showBubble: (memberId, text, kind = "note", durationMs = DEFAULT_BUBBLE_DURATION_MS) => {
    const normalizedMemberId = String(memberId ?? "").trim();
    if (!normalizedMemberId) {
      return;
    }

    const lines = formatDispatchBubbleLines(text, kind);
    if (lines.length === 0) {
      return;
    }

    clearBubbleTimer(normalizedMemberId);
    set((state) => ({
      bubbles: {
        ...state.bubbles,
        [normalizedMemberId]: lines,
      },
    }));

    const timer = setTimeout(() => {
      bubbleTimers.delete(normalizedMemberId);
      set((state) => {
        if (!(normalizedMemberId in state.bubbles)) {
          return state;
        }
        const next = { ...state.bubbles };
        delete next[normalizedMemberId];
        return { bubbles: next };
      });
    }, durationMs);

    bubbleTimers.set(normalizedMemberId, timer);
  },

  clearBubble: (memberId) => {
    const normalizedMemberId = String(memberId ?? "").trim();
    if (!normalizedMemberId) {
      return;
    }

    clearBubbleTimer(normalizedMemberId);
    set((state) => {
      if (!(normalizedMemberId in state.bubbles)) {
        return state;
      }
      const next = { ...state.bubbles };
      delete next[normalizedMemberId];
      return { bubbles: next };
    });
  },
}));
