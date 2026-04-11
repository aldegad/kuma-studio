import { getConfiguredDefaultProjectId } from "./project-defaults.mjs";

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((entry) => normalizeOptionalString(entry))
      .filter((entry) => typeof entry === "string"),
  )];
}

function clampSentence(value, fallback) {
  const normalized = normalizeOptionalString(value) ?? fallback;
  return normalized.replace(/\s+/gu, " ").trim();
}

function buildSourceLinks(sourceTrend, sourceContent) {
  return normalizeStringArray([
    ...(Array.isArray(sourceContent?.sourceLinks) ? sourceContent.sourceLinks : []),
    sourceTrend?.articleUrl,
    sourceTrend?.feedUrl,
  ]);
}

function inferTrendTitle(experiment, sourceTrend, sourceContent) {
  return (
    normalizeOptionalString(sourceTrend?.title) ??
    normalizeOptionalString(sourceContent?.title) ??
    normalizeOptionalString(experiment?.title) ??
    "원본 트렌드 미상"
  );
}

function inferResearchQuestion(experiment, sourceTrend, sourceContent) {
  const explicitQuestion = normalizeOptionalString(experiment?.researchQuestion);
  if (explicitQuestion) {
    return explicitQuestion;
  }

  const trendTitle = inferTrendTitle(experiment, sourceTrend, sourceContent);
  return `이 트렌드가 실제 제품과 워크플로에 주는 변화를 어떻게 검증할까? (${trendTitle})`;
}

function inferResultSummary(experiment, sourceTrend, sourceContent) {
  const explicitSummary = normalizeOptionalString(experiment?.resultSummary);
  if (explicitSummary) {
    return explicitSummary;
  }

  const sourceSummary =
    normalizeOptionalString(sourceContent?.body) ??
    normalizeOptionalString(sourceTrend?.summary) ??
    normalizeOptionalString(experiment?.thread_draft);

  if (sourceSummary) {
    return clampSentence(sourceSummary, "실험이 완료되었습니다.");
  }

  return "실험이 완료되었습니다. 구현 diff와 검증 결과를 PR에서 확인할 수 있습니다.";
}

export function buildExperimentReportArtifacts({ experiment, sourceTrend = null, sourceContent = null } = {}) {
  if (!experiment) {
    throw new Error("experiment is required.");
  }

  const trendTitle = inferTrendTitle(experiment, sourceTrend, sourceContent);
  const sourceLinks = buildSourceLinks(sourceTrend, sourceContent);
  const researchQuestion = inferResearchQuestion(experiment, sourceTrend, sourceContent);
  const resultSummary = inferResultSummary(experiment, sourceTrend, sourceContent);
  const prUrl = normalizeOptionalString(experiment.pr_url);
  const prLabel = prUrl ?? "미생성";
  const reportSummary = [
    `트렌드 원본: ${trendTitle}`,
    `연구 질문: ${researchQuestion}`,
    `실험 결과: ${resultSummary}`,
    `PR 링크: ${prLabel}`,
  ].join("\n");
  const reportMarkdownLines = [
    `# ${normalizeOptionalString(experiment.title) ?? "연구 결과 보고"}`,
    "",
    "## 트렌드 원본",
    `- 제목: ${trendTitle}`,
    ...(sourceLinks.length > 0 ? sourceLinks.map((link) => `- ${link}`) : ["- 링크 없음"]),
    "",
    "## 연구 질문",
    researchQuestion,
    "",
    "## 실험 결과",
    resultSummary,
    "",
    "## PR 링크",
    prLabel,
  ];

  return {
    trendTitle,
    sourceLinks,
    researchQuestion,
    resultSummary,
    reportSummary,
    reportMarkdown: reportMarkdownLines.join("\n"),
  };
}

export function buildExperimentThreadDraft({ experiment, sourceTrend = null, sourceContent = null } = {}) {
  const artifacts = buildExperimentReportArtifacts({ experiment, sourceTrend, sourceContent });

  return [
    `# ${normalizeOptionalString(experiment?.title) ?? "Experiment"}`,
    "",
    "## Result Summary",
    artifacts.resultSummary,
    "",
    "## Research Question",
    artifacts.researchQuestion,
    "",
    "## Original Trend",
    `- 제목: ${artifacts.trendTitle}`,
    ...(artifacts.sourceLinks.length > 0 ? artifacts.sourceLinks.map((link) => `- ${link}`) : ["- 링크 없음"]),
    "",
    "## Execution",
    `- 출처: ${normalizeOptionalString(experiment?.source) ?? "unknown"}`,
    `- 브랜치: ${normalizeOptionalString(experiment?.branch) ?? "미생성"}`,
    `- 워크트리: ${normalizeOptionalString(experiment?.worktree) ?? "미생성"}`,
  ].join("\n");
}

export function buildResearchResultContentDraft({ experiment, sourceTrend = null, sourceContent = null } = {}) {
  const artifacts = buildExperimentReportArtifacts({ experiment, sourceTrend, sourceContent });
  const project = normalizeOptionalString(sourceContent?.project) ?? getConfiguredDefaultProjectId({ fallback: "workspace" });
  const title = `${normalizeOptionalString(experiment?.title) ?? artifacts.trendTitle} 연구 결과`;
  const bodyLines = [
    `트렌드 원본: ${artifacts.trendTitle}`,
    `연구 질문: ${artifacts.researchQuestion}`,
    `실험 결과: ${artifacts.resultSummary}`,
    `PR 링크: ${normalizeOptionalString(experiment?.pr_url) ?? "미생성"}`,
  ];

  return {
    project,
    type: "research-result",
    title,
    body: bodyLines.join("\n"),
    status: "draft",
    assignee: sourceContent?.assignee ?? null,
    experimentId: normalizeOptionalString(experiment?.id),
    sourceTrendId: normalizeOptionalString(experiment?.sourceTrendId),
    sourceLinks: artifacts.sourceLinks,
    researchSuggestion: false,
    researchScore:
      typeof experiment?.researchScore === "number"
        ? experiment.researchScore
        : typeof sourceContent?.researchScore === "number"
          ? sourceContent.researchScore
          : null,
  };
}
