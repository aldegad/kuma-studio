import { readJsonBody, sendJson } from "../server-support.mjs";
import { startResearchForContent } from "./research-workflow.mjs";
import { scoreTrendForResearch } from "./trend-research-scorer.mjs";

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isTrendCollectionPath(pathname) {
  return /^\/studio\/trends$/u.test(pathname);
}

function isTrendIngestPath(pathname) {
  return /^\/studio\/trends\/ingest$/u.test(pathname);
}

function isTrendSettingsPath(pathname) {
  return /^\/studio\/trends\/settings$/u.test(pathname);
}

function parseIngestPayload(body) {
  const payload = Array.isArray(body) ? { items: body } : body && typeof body === "object" ? body : null;

  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("items must be an array.");
  }

  return {
    project: normalizeOptionalString(payload.project) ?? "kuma-studio",
    items: payload.items,
  };
}

function buildContentDraftFromTrend(trend, project, research = null) {
  const sourceLinks = [...new Set([trend.articleUrl, trend.feedUrl].filter((entry) => typeof entry === "string" && entry.trim()))];

  return {
    project,
    type: "text",
    title: trend.title,
    body: trend.summary || trend.title,
    sourceTrendId: trend.id,
    sourceLinks,
    researchSuggestion: research?.suggestion === true,
    researchScore: research?.score ?? null,
    researchBreakdown: research?.breakdown ?? null,
  };
}

export function createTrendRouteHandler({ trendStore, contentStore, experimentStore, experimentPipeline, nowFn = () => new Date() }) {
  return async (req, res, url) => {
    if (!trendStore) {
      return false;
    }

    if (isTrendCollectionPath(url.pathname) && req.method === "GET") {
      sendJson(res, 200, {
        items: trendStore.list(url.searchParams.get("feedUrl")),
      });
      return true;
    }

    if (isTrendSettingsPath(url.pathname) && req.method === "GET") {
      sendJson(res, 200, trendStore.getSettings());
      return true;
    }

    if (isTrendSettingsPath(url.pathname) && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, trendStore.updateSettings(body));
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid trend settings payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (isTrendIngestPath(url.pathname) && req.method === "POST") {
      if (!contentStore) {
        sendJson(res, 503, {
          error: "Content store is not available.",
        });
        return true;
      }

      try {
        const body = await readJsonBody(req);
        const { items, project } = parseIngestPayload(body);
        const trends = items.map((item) => trendStore.write(item));
        const trendSettings = trendStore.getSettings();
        const allTrends = trendStore.list();
        const existingExperiments = experimentStore?.list?.() ?? [];
        const contentItems = [];
        const experiments = [];

        for (const trend of trends) {
          const research = scoreTrendForResearch({
            trend,
            allTrends,
            existingExperiments: [...existingExperiments, ...experiments],
            now: nowFn(),
          });
          const existingCard = contentStore.readBySourceTrendId(trend.id);
          let contentItem = contentStore.write(buildContentDraftFromTrend(trend, project, research), existingCard ?? {});

          if (trendSettings.autoResearch === true && research.autoStart === true && experimentStore && experimentPipeline) {
            const started = startResearchForContent({
              contentItem,
              contentStore,
              experimentStore,
              experimentPipeline,
              sourceTrend: trend,
            });
            contentItem = started.content ?? contentItem;
            if (started.experiment) {
              experiments.push(started.experiment);
            }
          }

          contentItems.push(contentItem);
        }

        sendJson(res, 200, {
          project,
          settings: trendSettings,
          trends,
          items: contentItems,
          experiments,
        });
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid trend ingest payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    return false;
  };
}
