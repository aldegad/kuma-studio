import { create } from "zustand";
import type { AgentState } from "../types/agent";
import type { JobCard } from "../types/job-card";

export const PIPELINE_STAGE_ORDER = ["decompose", "parallel", "gate", "review"] as const;

export type PipelineStageId = (typeof PIPELINE_STAGE_ORDER)[number];
export type PipelineAgentStatus = "idle" | "working" | "done" | "error";

export interface PipelineAgentCard {
  id: string;
  name: string;
  emoji: string;
  status: PipelineAgentStatus;
  currentTask: string;
  sourceAgentId: string | null;
  jobId: string | null;
  updatedAt: string | null;
}

interface PipelineState {
  stages: Record<PipelineStageId, PipelineAgentCard[]>;
  hydrateFromJobs: (jobs: JobCard[]) => void;
  syncJob: (job: JobCard) => void;
  updateAgentState: (agentId: string, state: AgentState) => void;
  reset: () => void;
}

interface PipelineSlotTemplate {
  id: string;
  name: string;
  emoji: string;
  currentTask: string;
}

const SLOT_TEMPLATES: Record<PipelineStageId, readonly PipelineSlotTemplate[]> = {
  decompose: [
    { id: "pm", name: "PM", emoji: "🧭", currentTask: "새 작업 분해를 기다리는 중" },
  ],
  parallel: [
    { id: "worker-1", name: "Worker 1", emoji: "⚙️", currentTask: "병렬 실행 대기" },
    { id: "worker-2", name: "Worker 2", emoji: "🛠️", currentTask: "병렬 실행 대기" },
    { id: "worker-3", name: "Worker 3", emoji: "🔧", currentTask: "병렬 실행 대기" },
  ],
  gate: [
    { id: "bash", name: "Bash", emoji: "🖥️", currentTask: "게이트 검증 대기" },
  ],
  review: [
    { id: "reviewer", name: "Reviewer", emoji: "🔍", currentTask: "최종 리뷰 대기" },
  ],
};

const stageKeys = Object.keys(SLOT_TEMPLATES) as PipelineStageId[];
const decomposeKeywords = ["분해", "decompose", "plan", "planning", "breakdown", "scope", "task list", "todo"];
const gateKeywords = ["게이트", "gate", "bash", "shell", "terminal", "test", "lint", "build", "check", "verify", "validation", "ci"];
const reviewKeywords = ["리뷰", "review", "reviewer", "feedback", "approve", "audit", "critique", "qa"];

function createCardFromTemplate(template: PipelineSlotTemplate): PipelineAgentCard {
  return {
    id: template.id,
    name: template.name,
    emoji: template.emoji,
    status: "idle",
    currentTask: template.currentTask,
    sourceAgentId: null,
    jobId: null,
    updatedAt: null,
  };
}

function buildInitialStages(): Record<PipelineStageId, PipelineAgentCard[]> {
  return {
    decompose: SLOT_TEMPLATES.decompose.map(createCardFromTemplate),
    parallel: SLOT_TEMPLATES.parallel.map(createCardFromTemplate),
    gate: SLOT_TEMPLATES.gate.map(createCardFromTemplate),
    review: SLOT_TEMPLATES.review.map(createCardFromTemplate),
  };
}

function hasKeyword(value: string, keywords: readonly string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

function classifyJob(job: JobCard): PipelineStageId {
  const haystack = `${job.author} ${job.message}`.toLowerCase();

  if (hasKeyword(haystack, reviewKeywords)) {
    return "review";
  }

  if (hasKeyword(haystack, gateKeywords)) {
    return "gate";
  }

  if (hasKeyword(haystack, decomposeKeywords)) {
    return "decompose";
  }

  const status = job.status as string;
  if (status === "queued" || status === "noted") {
    return "decompose";
  }

  return "parallel";
}

function mapJobStatusToPipelineStatus(status: string): PipelineAgentStatus {
  switch (status) {
    case "completed":
      return "done";
    case "error":
      return "error";
    case "in_progress":
    case "queued":
    case "noted":
      return "working";
    default:
      return "idle";
  }
}

function mapAgentStateToPipelineStatus(state: AgentState): PipelineAgentStatus {
  switch (state) {
    case "completed":
      return "done";
    case "error":
      return "error";
    case "working":
    case "thinking":
      return "working";
    default:
      return "idle";
  }
}

function getFallbackTask(stageId: PipelineStageId, index: number): string {
  return SLOT_TEMPLATES[stageId][index]?.currentTask ?? "대기 중";
}

function resetCard(stageId: PipelineStageId, index: number): PipelineAgentCard {
  return createCardFromTemplate(SLOT_TEMPLATES[stageId][index]);
}

function cloneStages(stages: Record<PipelineStageId, PipelineAgentCard[]>): Record<PipelineStageId, PipelineAgentCard[]> {
  return {
    decompose: stages.decompose.map((card) => ({ ...card })),
    parallel: stages.parallel.map((card) => ({ ...card })),
    gate: stages.gate.map((card) => ({ ...card })),
    review: stages.review.map((card) => ({ ...card })),
  };
}

function resolveSlotIndex(stageId: PipelineStageId, cards: PipelineAgentCard[], job: JobCard): number {
  if (stageId !== "parallel") {
    return 0;
  }

  const existingIndex = cards.findIndex((card) => card.sourceAgentId === job.author && card.sourceAgentId !== null);
  if (existingIndex !== -1) {
    return existingIndex;
  }

  const emptyIndex = cards.findIndex((card) => card.sourceAgentId == null);
  if (emptyIndex !== -1) {
    return emptyIndex;
  }

  let oldestIndex = 0;
  let oldestTime = Number.POSITIVE_INFINITY;

  cards.forEach((card, index) => {
    const time = card.updatedAt ? new Date(card.updatedAt).getTime() : Number.NEGATIVE_INFINITY;
    if (time < oldestTime) {
      oldestTime = time;
      oldestIndex = index;
    }
  });

  return oldestIndex;
}

function applyJobUpdate(stages: Record<PipelineStageId, PipelineAgentCard[]>, job: JobCard) {
  const nextStages = cloneStages(stages);
  const stageId = classifyJob(job);

  for (const key of stageKeys) {
    nextStages[key] = nextStages[key].map((card, index) => {
      const sameJob = card.jobId === job.id;
      const sameAuthor = card.sourceAgentId != null && card.sourceAgentId === job.author;
      return sameJob || sameAuthor ? resetCard(key, index) : card;
    });
  }

  const slotIndex = resolveSlotIndex(stageId, nextStages[stageId], job);
  const template = SLOT_TEMPLATES[stageId][slotIndex];

  nextStages[stageId][slotIndex] = {
    id: template.id,
    name: template.name,
    emoji: template.emoji,
    status: mapJobStatusToPipelineStatus(job.status as string),
    currentTask: job.message?.trim() || template.currentTask,
    sourceAgentId: job.author?.trim() || null,
    jobId: job.id,
    updatedAt: job.updatedAt,
  };

  return nextStages;
}

export const usePipelineStore = create<PipelineState>((set) => ({
  stages: buildInitialStages(),

  hydrateFromJobs: (jobs) =>
    set(() => {
      const nextStages = buildInitialStages();
      const sorted = [...jobs].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

      for (const job of sorted) {
        const message = typeof job.message === "string" ? job.message.trim() : "";
        if (!message) {
          continue;
        }

        const updated = applyJobUpdate(nextStages, job);
        nextStages.decompose = updated.decompose;
        nextStages.parallel = updated.parallel;
        nextStages.gate = updated.gate;
        nextStages.review = updated.review;
      }

      return { stages: nextStages };
    }),

  syncJob: (job) =>
    set((state) => ({
      stages: applyJobUpdate(state.stages, job),
    })),

  updateAgentState: (agentId, state) =>
    set((current) => {
      const nextStages = cloneStages(current.stages);
      const nextStatus = mapAgentStateToPipelineStatus(state);

      for (const stageId of stageKeys) {
        nextStages[stageId] = nextStages[stageId].map((card, index) => {
          if (card.sourceAgentId !== agentId) {
            return card;
          }

          if (nextStatus === "idle" && card.jobId == null) {
            return resetCard(stageId, index);
          }

          return {
            ...card,
            status: nextStatus,
            currentTask:
              nextStatus === "idle" && !card.currentTask
                ? getFallbackTask(stageId, index)
                : card.currentTask,
          };
        });
      }

      return { stages: nextStages };
    }),

  reset: () => set({ stages: buildInitialStages() }),
}));
