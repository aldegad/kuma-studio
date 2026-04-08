import { readJsonBody, sendJson } from "../server-support.mjs";
import {
  buildExperimentReportArtifacts,
  buildResearchResultContentDraft,
} from "./experiment-report.mjs";
import { getExperimentConstants } from "./experiment-store.mjs";
import { ingestTrendExperiments } from "./experiment-trends.mjs";

function parseId(pathname) {
  const match = pathname.match(/^\/studio\/experiments\/([^/]+)$/u);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseStatusId(pathname) {
  const match = pathname.match(/^\/studio\/experiments\/([^/]+)\/status$/u);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseReportId(pathname) {
  const match = pathname.match(/^\/studio\/experiments\/([^/]+)\/report$/u);
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRequestedStatus(value) {
  if (value === "completed") {
    return "success";
  }

  return typeof value === "string" ? value : "";
}

function buildExperimentMetadataPatch(body = {}) {
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(body, "researchQuestion")) {
    patch.researchQuestion = normalizeOptionalString(body.researchQuestion);
  }

  if (Object.prototype.hasOwnProperty.call(body, "resultSummary")) {
    patch.resultSummary = normalizeOptionalString(body.resultSummary);
  }

  if (Object.prototype.hasOwnProperty.call(body, "pr_url")) {
    patch.pr_url = normalizeOptionalString(body.pr_url);
  }

  return patch;
}

function readExperimentContext({ current, contentStore, trendStore }) {
  const sourceContent =
    current?.sourceContentId && contentStore?.readById
      ? contentStore.readById(current.sourceContentId)
      : null;
  const sourceTrend =
    current?.sourceTrendId && trendStore?.readById
      ? trendStore.readById(current.sourceTrendId)
      : null;

  return { sourceContent, sourceTrend };
}

function upsertResearchResultContent({ experiment, sourceContent, sourceTrend, contentStore }) {
  if (!contentStore) {
    return null;
  }

  const existing = contentStore.readByExperimentId?.(experiment.id) ?? null;
  const draft = buildResearchResultContentDraft({
    experiment,
    sourceTrend,
    sourceContent,
  });

  return existing
    ? contentStore.update(existing.id, draft)
    : contentStore.write(draft);
}

export function createExperimentRouteHandler({ experimentStore, pipeline, contentStore, trendStore }) {
  return async (req, res, url) => {
    if (!experimentStore) {
      return false;
    }

    if (url.pathname === "/studio/experiments/meta" && req.method === "GET") {
      sendJson(res, 200, getExperimentConstants());
      return true;
    }

    if (url.pathname === "/studio/experiments" && req.method === "GET") {
      sendJson(res, 200, {
        items: experimentStore.list(),
        settings: experimentStore.getSettings(),
      });
      return true;
    }

    if (url.pathname === "/studio/experiments" && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        sendJson(res, 201, experimentStore.write(body));
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid experiment payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/experiments/settings" && req.method === "GET") {
      sendJson(res, 200, experimentStore.getSettings());
      return true;
    }

    if (url.pathname === "/studio/experiments/settings" && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, experimentStore.updateSettings(body));
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid experiment settings payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/experiments/ingest-trends" && req.method === "POST") {
      const settings = experimentStore.getSettings();
      const items = experimentStore.list();
      const candidates = await ingestTrendExperiments({ settings, existingItems: items });
      const created = candidates.map((candidate) => experimentStore.write(candidate));
      experimentStore.updateSettings({ ...settings, lastTrendIngestedAt: new Date().toISOString() });
      sendJson(res, 200, { items: created, settings: experimentStore.getSettings() });
      return true;
    }

    const statusId = parseStatusId(url.pathname);
    if (statusId && req.method === "POST") {
      try {
        const current = experimentStore.readById(statusId);
        if (!current) {
          sendJson(res, 404, { error: "Experiment not found." });
          return true;
        }

        const body = await readJsonBody(req);
        const status = normalizeRequestedStatus(body?.status);
        const metadataPatch = buildExperimentMetadataPatch(body);
        const { sourceContent, sourceTrend } = readExperimentContext({ current, contentStore, trendStore });
        let patch = { status, ...metadataPatch };

        if (status === "in-progress") {
          patch = { ...patch, ...pipeline.start(current) };
        } else if (status === "success") {
          const finalizedExperiment = { ...current, ...metadataPatch, status };
          const finalizedPatch = pipeline.finalize(finalizedExperiment, { sourceContent, sourceTrend });
          const artifacts = buildExperimentReportArtifacts({
            experiment: { ...finalizedExperiment, ...finalizedPatch },
            sourceContent,
            sourceTrend,
          });
          patch = {
            ...patch,
            ...finalizedPatch,
            ...artifacts,
            reportGeneratedAt: new Date().toISOString(),
          };
        } else if (status === "failed" || status === "abandoned") {
          patch = { ...patch, ...pipeline.cleanup(current) };
        }

        const updated = experimentStore.update(statusId, patch);
        if (!updated) {
          sendJson(res, 404, { error: "Experiment not found." });
          return true;
        }

        if (status === "success" && contentStore) {
          const researchResult = upsertResearchResultContent({
            experiment: updated,
            sourceContent,
            sourceTrend,
            contentStore,
          });

          if (researchResult && updated.resultContentId !== researchResult.id) {
            const patched = experimentStore.update(statusId, { resultContentId: researchResult.id });
            sendJson(res, 200, patched ?? updated);
            return true;
          }
        }

        sendJson(res, 200, updated);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid experiment status payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    const reportId = parseReportId(url.pathname);
    if (reportId && req.method === "POST") {
      try {
        const current = experimentStore.readById(reportId);
        if (!current) {
          sendJson(res, 404, { error: "Experiment not found." });
          return true;
        }

        const body = await readJsonBody(req);
        const metadataPatch = buildExperimentMetadataPatch(body);
        const { sourceContent, sourceTrend } = readExperimentContext({ current, contentStore, trendStore });
        const artifacts = buildExperimentReportArtifacts({
          experiment: { ...current, ...metadataPatch },
          sourceContent,
          sourceTrend,
        });
        const updated = experimentStore.update(reportId, {
          ...metadataPatch,
          ...artifacts,
          reportGeneratedAt: new Date().toISOString(),
        });

        if (!updated) {
          sendJson(res, 404, { error: "Experiment not found." });
          return true;
        }

        if (updated.status === "success" && contentStore) {
          const researchResult = upsertResearchResultContent({
            experiment: updated,
            sourceContent,
            sourceTrend,
            contentStore,
          });

          if (researchResult && updated.resultContentId !== researchResult.id) {
            const patched = experimentStore.update(reportId, { resultContentId: researchResult.id });
            sendJson(res, 200, {
              experiment: patched ?? updated,
              reportSummary: updated.reportSummary,
              reportMarkdown: updated.reportMarkdown,
            });
            return true;
          }
        }

        sendJson(res, 200, {
          experiment: updated,
          reportSummary: updated.reportSummary,
          reportMarkdown: updated.reportMarkdown,
        });
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid experiment report payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    const id = parseId(url.pathname);
    if (id && req.method === "GET") {
      const item = experimentStore.readById(id);
      sendJson(res, item ? 200 : 404, item ?? { error: "Experiment not found." });
      return true;
    }

    if (id && req.method === "PATCH") {
      try {
        const updated = experimentStore.update(id, await readJsonBody(req));
        sendJson(res, updated ? 200 : 404, updated ?? { error: "Experiment not found." });
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid experiment update payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (id && req.method === "DELETE") {
      const current = experimentStore.readById(id);
      if (current && (current.worktree || current.branch)) {
        pipeline.cleanup(current);
      }
      const deleted = experimentStore.delete(id);
      sendJson(res, deleted ? 200 : 404, deleted ?? { error: "Experiment not found." });
      return true;
    }

    return false;
  };
}
