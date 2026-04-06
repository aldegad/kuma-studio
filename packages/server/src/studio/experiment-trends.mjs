import { getExperimentConstants } from "./experiment-store.mjs";

function stripXml(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gisu, "$1")
    .replace(/<[^>]+>/gisu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .trim();
}

async function readFeedTitles(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "kuma-studio-experiment-bot/1.0" },
    });
    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    return [...xml.matchAll(/<title>([\s\S]*?)<\/title>/giu)]
      .map((match) => stripXml(match[1]))
      .filter(Boolean)
      .filter((title) => !/^rss|atom$/iu.test(title))
      .slice(0, 4);
  } catch {
    return [];
  }
}

export async function ingestTrendExperiments({ settings, existingItems }) {
  const fallbackSources = getExperimentConstants().defaultTrendSources;
  const trendSources =
    Array.isArray(settings?.trendSources) && settings.trendSources.length > 0
      ? settings.trendSources
      : fallbackSources;
  const existingTitles = new Set((existingItems ?? []).map((item) => item.title));
  const titles = (await Promise.all(trendSources.map((source) => readFeedTitles(source)))).flat();
  const seen = new Set();

  return titles
    .filter((title) => {
      if (existingTitles.has(title) || seen.has(title)) {
        return false;
      }
      seen.add(title);
      return true;
    })
    .map((title) => ({
      title,
      source: "ai-trend",
      status: "proposed",
      branch: null,
      worktree: null,
      pr_url: null,
      thread_draft: "",
    }));
}
