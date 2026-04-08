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

function hashText(value) {
  const text = String(value ?? "");
  let hash = 0;

  for (const char of text) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function clampText(value, maxLength) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function stripSiteSuffix(value) {
  const text = normalizeOptionalString(value) ?? "";
  const primary = text.split(/\s+\|\s+/u)[0] ?? text;
  return primary.split(/\s+[-:]\s+(?=[A-Z][A-Za-z0-9 .]{1,30}$)/u)[0] ?? primary;
}

function minimizeAiLabel(value) {
  const original = normalizeOptionalString(value) ?? "";
  const compact = original
    .replace(/\bartificial intelligence\b/giu, "")
    .replace(/\bAI\b/gu, "")
    .replace(/\s{2,}/gu, " ")
    .replace(/^[,:\-\s]+|[,:\-\s]+$/gu, "")
    .trim();

  return compact.length >= Math.min(original.length, 12) ? compact : original;
}

function splitSummary(summary) {
  const text = String(summary ?? "")
    .replace(/\r?\n+/gu, "\n")
    .trim();

  if (!text) {
    return [];
  }

  return text
    .split(/\n|(?<=[.!?])\s+/u)
    .map((line) => normalizeOptionalString(line))
    .filter((line) => typeof line === "string")
    .map((line) => clampText(minimizeAiLabel(line), 120))
    .filter(Boolean);
}

function toSourceLabel(link) {
  const text = normalizeOptionalString(link);
  if (!text) {
    return null;
  }

  try {
    return new URL(text).hostname.replace(/^www\./u, "");
  } catch {
    return text;
  }
}

function inferCategory(tags, title = "", summary = "") {
  const bag = `${normalizeStringArray(tags).join(" ")} ${title} ${summary}`.toLowerCase();

  if (/\b(agent|agents|workflow|automation|orchestr)/u.test(bag)) {
    return "agents";
  }

  if (/\b(security|threat|privacy|compliance|vulnerability)\b/u.test(bag)) {
    return "security";
  }

  if (/\b(image|video|vision|multimodal|creative|design)\b/u.test(bag)) {
    return "creative";
  }

  if (/\b(infra|cloud|latency|deployment|cost|benchmark|runtime)\b/u.test(bag)) {
    return "infra";
  }

  return "general";
}

function buildHook(title, tags) {
  const base = clampText(minimizeAiLabel(stripSiteSuffix(title)) || "이 흐름", 72);
  const category = inferCategory(tags, base, "");
  const suffixTable = {
    agents: [
      "이건 모델 얘기보다 스택 얘기다.",
      "이제 승부처는 orchestration이다.",
    ],
    security: [
      "이건 기능보다 리스크 얘기다.",
      "이 흐름은 보안팀이 먼저 본다.",
    ],
    creative: [
      "툴 경쟁보다 워크플로 경쟁에 가깝다.",
      "생성보다 편집 루프가 더 중요해졌다.",
    ],
    infra: [
      "진짜 차이는 성능표보다 운영비다.",
      "이제 benchmark보다 deployment가 중요하다.",
    ],
    general: [
      "그냥 뉴스로 넘기기엔 세다.",
      "흐름이 바뀌는 신호다.",
    ],
  };
  const suffixes = suffixTable[category] ?? suffixTable.general;
  const suffix = suffixes[hashText(base) % suffixes.length];

  if (/[?!]$/u.test(base)) {
    return base;
  }

  return clampText(`${base} ${suffix}`, 96);
}

function buildInsight(tags, title, summary) {
  const category = inferCategory(tags, title, summary);
  const insightTable = {
    agents: "포인트는 모델 성능보다 workflow latency와 orchestration 구조다.",
    security: "진짜 변수는 성능보다 검증 가능성과 운영 통제다.",
    creative: "핵심은 결과물 품질보다 편집 속도와 반복 비용이다.",
    infra: "결국 adoption은 성능표보다 배포 단가와 latency가 가른다.",
    general: "관건은 데모 자체보다 실제 워크플로에 어떻게 꽂히는지다.",
  };

  return insightTable[category] ?? insightTable.general;
}

function buildCta(tags, title, summary) {
  const category = inferCategory(tags, title, summary);
  const ctaTable = {
    agents: "여기서 남는 해자는 모델일까, orchestration일까?",
    security: "이걸 실제 제품에 넣는다면 어디서 먼저 막힐까?",
    creative: "이 흐름, 툴 경쟁일까 아니면 워크플로 경쟁일까?",
    infra: "진짜 차이는 성능일까, 운영비일까?",
    general: "이 흐름이 실사용으로 번지는 지점은 어디일까?",
  };

  return ctaTable[category] ?? ctaTable.general;
}

function buildBodyLines({ summary, title, sourceLinks, tags }) {
  const lines = [];
  const summaryLines = splitSummary(summary).slice(0, 3);

  lines.push(...summaryLines);

  const insight = clampText(buildInsight(tags, title, summary), 110);
  if (insight && !lines.some((line) => line === insight)) {
    lines.push(insight);
  }

  const sources = [...new Set(sourceLinks.map((link) => toSourceLabel(link)).filter((link) => typeof link === "string"))];
  if (sources.length > 0) {
    lines.push(clampText(`출처: ${sources.join(", ")}`, 110));
  }

  return [...new Set(lines.filter(Boolean))].slice(0, 5);
}

function splitIntoPosts({ hook, bodyLines, cta }) {
  if (bodyLines.length <= 3) {
    return [
      {
        hook,
        bodyLines,
        cta,
        format: "single",
      },
    ];
  }

  const firstChunk = bodyLines.slice(0, 2);
  const rest = bodyLines.slice(2);
  const posts = [
    {
      hook,
      bodyLines: firstChunk,
      cta: "",
      format: "thread",
    },
  ];

  while (rest.length > 0) {
    posts.push({
      hook: posts.length === 1 ? "진짜 포인트는 여기다." : "한 줄로 더 정리하면 이렇다.",
      bodyLines: rest.splice(0, 2),
      cta: rest.length === 0 ? cta : "",
      format: "thread",
    });
  }

  return posts;
}

export function generateThreadPosts({ title, summary, sourceLinks = [], tags = [] }) {
  const normalizedTitle = normalizeOptionalString(title) ?? "이 흐름";
  const normalizedSummary = normalizeOptionalString(summary) ?? normalizedTitle;
  const normalizedSourceLinks = normalizeStringArray(sourceLinks);
  const normalizedTags = normalizeStringArray(tags);
  const hook = buildHook(normalizedTitle, normalizedTags);
  const bodyLines = buildBodyLines({
    title: normalizedTitle,
    summary: normalizedSummary,
    sourceLinks: normalizedSourceLinks,
    tags: normalizedTags,
  });
  const cta = clampText(buildCta(normalizedTags, normalizedTitle, normalizedSummary), 96);

  return splitIntoPosts({ hook, bodyLines, cta });
}

export function formatThreadPostsForClipboard(threadPosts) {
  if (!Array.isArray(threadPosts) || threadPosts.length === 0) {
    return "";
  }

  return threadPosts
    .map((post) =>
      [
        normalizeOptionalString(post?.hook),
        ...(Array.isArray(post?.bodyLines) ? post.bodyLines.map((line) => normalizeOptionalString(line)) : []),
        normalizeOptionalString(post?.cta),
      ]
        .filter((line) => typeof line === "string")
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");
}
