import { assert, describe, it } from "vitest";

import {
  buildExperimentReportArtifacts,
  buildExperimentThreadDraft,
  buildResearchResultContentDraft,
} from "./experiment-report.mjs";

describe("experiment-report", () => {
  it("builds report, thread draft, and research-result content from experiment context", () => {
    const experiment = {
      id: "exp-1234",
      title: "Agent SDK rollout",
      source: "ai-trend",
      branch: "exp/agent-sdk",
      worktree: "/tmp/agent-sdk",
      pr_url: "https://github.com/example/repo/pull/12",
      researchQuestion: "이 SDK를 kuma-studio 자동화 루프에 바로 연결할 수 있을까?",
      resultSummary: "실험 결과 CLI 기반 orchestration path를 바로 붙일 수 있었고, 작업 전환 latency가 줄었다.",
      researchScore: 0.87,
      sourceTrendId: "trend-1",
    };
    const sourceTrend = {
      title: "OpenAI Agent SDK ships",
      articleUrl: "https://example.com/agent-sdk",
      feedUrl: "https://example.com/feed.xml",
      summary: "New SDK release",
    };
    const sourceContent = {
      project: "kuma-studio",
      assignee: "darami",
      sourceLinks: ["https://example.com/agent-sdk"],
      researchScore: 0.84,
    };

    const artifacts = buildExperimentReportArtifacts({ experiment, sourceTrend, sourceContent });
    assert.include(artifacts.reportMarkdown, "## 트렌드 원본");
    assert.include(artifacts.reportMarkdown, "https://example.com/agent-sdk");
    assert.include(artifacts.reportMarkdown, "## 실험 결과");
    assert.include(artifacts.reportSummary, "PR 링크: https://github.com/example/repo/pull/12");

    const threadDraft = buildExperimentThreadDraft({ experiment, sourceTrend, sourceContent });
    assert.include(threadDraft, "## Result Summary");
    assert.include(threadDraft, experiment.resultSummary);
    assert.include(threadDraft, "https://example.com/agent-sdk");

    const contentDraft = buildResearchResultContentDraft({ experiment, sourceTrend, sourceContent });
    assert.strictEqual(contentDraft.type, "research-result");
    assert.strictEqual(contentDraft.project, "kuma-studio");
    assert.strictEqual(contentDraft.assignee, "darami");
    assert.strictEqual(contentDraft.experimentId, experiment.id);
    assert.strictEqual(contentDraft.sourceTrendId, experiment.sourceTrendId);
    assert.include(contentDraft.body, experiment.resultSummary);
    assert.include(contentDraft.body, experiment.pr_url);
  });
});
