import { readJsonBody, sendJson } from "../server-support.mjs";
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

export function createExperimentRouteHandler({ experimentStore, pipeline }) {
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
        const status = typeof body?.status === "string" ? body.status : "";
        let patch = { status };

        if (status === "in-progress") {
          patch = { ...patch, ...pipeline.start(current) };
        } else if (status === "success") {
          patch = { ...patch, ...pipeline.finalize(current) };
        } else if (status === "failed" || status === "abandoned") {
          patch = { ...patch, ...pipeline.cleanup(current) };
        }

        const updated = experimentStore.update(statusId, patch);
        sendJson(res, 200, updated);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid experiment status payload.",
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
