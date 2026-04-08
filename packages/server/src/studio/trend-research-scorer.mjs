const FEASIBILITY_KEYWORDS = [
  "api",
  "sdk",
  "library",
  "tool",
  "framework",
  "package",
  "cli",
  "release",
  "open source",
  "github",
  "model",
  "agent",
  "workflow",
  "automation",
  "benchmark",
];

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "how",
  "into",
  "its",
  "new",
  "now",
  "of",
  "on",
  "the",
  "this",
  "that",
  "with",
]);

export const TREND_RESEARCH_SUGGESTION_THRESHOLD = 0.6;
export const TREND_RESEARCH_AUTOSTART_THRESHOLD = 0.8;

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numeric));
}

function roundScore(value) {
  return Math.round(clampScore(value) * 1000) / 1000;
}

function tokenizeText(value) {
  return new Set(
    String(value ?? "")
      .toLowerCase()
      .split(/[^a-z0-9가-힣]+/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 2 && !STOPWORDS.has(entry)),
  );
}

function buildTrendTopicTokens(trend) {
  return new Set([
    ...tokenizeText(trend?.title),
    ...tokenizeText(Array.isArray(trend?.tags) ? trend.tags.join(" ") : ""),
  ]);
}

function computeJaccardSimilarity(leftTokens, rightTokens) {
  if (!(leftTokens instanceof Set) || !(rightTokens instanceof Set) || leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function normalizeSourceKey(trend) {
  return normalizeOptionalString(trend?.feedUrl) ?? normalizeOptionalString(trend?.articleUrl) ?? null;
}

function areRelatedTrends(baseTrend, candidateTrend) {
  if (!candidateTrend || candidateTrend === baseTrend) {
    return false;
  }

  const baseTags = new Set(Array.isArray(baseTrend?.tags) ? baseTrend.tags.map((entry) => String(entry).toLowerCase()) : []);
  const candidateTags = new Set(
    Array.isArray(candidateTrend?.tags) ? candidateTrend.tags.map((entry) => String(entry).toLowerCase()) : [],
  );

  for (const tag of baseTags) {
    if (candidateTags.has(tag)) {
      return true;
    }
  }

  return computeJaccardSimilarity(buildTrendTopicTokens(baseTrend), buildTrendTopicTokens(candidateTrend)) >= 0.25;
}

function computeNovelty(trend, existingExperiments = []) {
  const trendTokens = buildTrendTopicTokens(trend);
  const titles = Array.isArray(existingExperiments) ? existingExperiments : [];
  if (titles.length === 0) {
    return { score: 1, maxSimilarity: 0 };
  }

  const maxSimilarity = titles.reduce((currentMax, experiment) => {
    const similarity = computeJaccardSimilarity(trendTokens, tokenizeText(experiment?.title));
    return Math.max(currentMax, similarity);
  }, 0);

  return {
    score: roundScore(1 - maxSimilarity),
    maxSimilarity: roundScore(maxSimilarity),
  };
}

function computeFeasibility(trend) {
  const haystack = [trend?.title, trend?.summary, Array.isArray(trend?.tags) ? trend.tags.join(" ") : ""]
    .filter((entry) => typeof entry === "string" && entry.trim())
    .join(" ")
    .toLowerCase();
  const matchedKeywords = FEASIBILITY_KEYWORDS.filter((keyword) => haystack.includes(keyword));

  return {
    score: roundScore(matchedKeywords.length / 3),
    matchedKeywords,
  };
}

function computeEngagement(trend, allTrends = []) {
  const sourceKeys = new Set();

  const baseSourceKey = normalizeSourceKey(trend);
  if (baseSourceKey) {
    sourceKeys.add(baseSourceKey);
  }

  for (const candidate of Array.isArray(allTrends) ? allTrends : []) {
    if (!areRelatedTrends(trend, candidate)) {
      continue;
    }

    const candidateSourceKey = normalizeSourceKey(candidate);
    if (candidateSourceKey) {
      sourceKeys.add(candidateSourceKey);
    }
  }

  return {
    score: roundScore(sourceKeys.size / 3),
    sourceCount: sourceKeys.size,
  };
}

function computeRecency(trend, now = new Date()) {
  const publishedAt = normalizeOptionalString(trend?.publishedAt);
  if (!publishedAt) {
    return { score: 0, ageHours: null };
  }

  const publishedDate = new Date(publishedAt);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(publishedDate.getTime()) || Number.isNaN(nowDate.getTime())) {
    return { score: 0, ageHours: null };
  }

  const ageHours = Math.max(0, (nowDate.getTime() - publishedDate.getTime()) / 3_600_000);
  if (ageHours <= 24) {
    return { score: 1, ageHours: roundScore(ageHours) };
  }
  if (ageHours <= 72) {
    return { score: 0.6, ageHours: roundScore(ageHours) };
  }
  if (ageHours <= 168) {
    return { score: 0.3, ageHours: roundScore(ageHours) };
  }

  return { score: 0, ageHours: roundScore(ageHours) };
}

export function scoreTrendForResearch({ trend, allTrends = [], existingExperiments = [], now = new Date() } = {}) {
  const novelty = computeNovelty(trend, existingExperiments);
  const feasibility = computeFeasibility(trend);
  const engagement = computeEngagement(trend, allTrends);
  const recency = computeRecency(trend, now);
  const score = roundScore(
    novelty.score * 0.3 +
      feasibility.score * 0.3 +
      engagement.score * 0.2 +
      recency.score * 0.2,
  );

  return {
    score,
    suggestion: score >= TREND_RESEARCH_SUGGESTION_THRESHOLD,
    autoStart: score >= TREND_RESEARCH_AUTOSTART_THRESHOLD,
    breakdown: {
      novelty: novelty.score,
      feasibility: feasibility.score,
      engagement: engagement.score,
      recency: recency.score,
    },
    context: {
      matchedKeywords: feasibility.matchedKeywords,
      relatedSourceCount: engagement.sourceCount,
      closestExperimentSimilarity: novelty.maxSimilarity,
      ageHours: recency.ageHours,
    },
  };
}
