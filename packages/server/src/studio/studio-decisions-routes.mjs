import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { readJsonBody, sendJson } from "../server-support.mjs";

const DEFAULT_VAULT_DIR = resolve(process.env.KUMA_VAULT_DIR || join(homedir(), ".kuma", "vault"));

function normalizeVaultDir(candidatePath, fallbackPath = DEFAULT_VAULT_DIR) {
  if (typeof candidatePath !== "string" || !candidatePath.trim()) {
    return fallbackPath;
  }

  return resolve(candidatePath.trim());
}

function normalizeEntryPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  if (body.entry && typeof body.entry === "object" && !Array.isArray(body.entry)) {
    const entry = { ...body.entry };
    if (typeof body.layer === "string" && body.layer.trim() && typeof entry.layer !== "string") {
      entry.layer = body.layer.trim();
    }
    return entry;
  }

  const { vaultDir: _ignoredVaultDir, ...entry } = body;
  return Object.keys(entry).length > 0 ? entry : null;
}

function normalizePromotePayload(body) {
  const inboxId = typeof body?.inboxId === "string" ? body.inboxId.trim() : "";
  const resolvedText = typeof body?.resolvedText === "string" ? body.resolvedText.trim() : "";
  const writer = typeof body?.writer === "string" && body.writer.trim() ? body.writer.trim() : undefined;
  const contextRef = typeof body?.contextRef === "string" && body.contextRef.trim() ? body.contextRef.trim() : undefined;
  return { inboxId, resolvedText, writer, contextRef };
}

function describeError(error) {
  return error instanceof Error ? error.message : "Unknown error";
}

function validateDecisionRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") {
    throw new Error("Decision runtime did not load.");
  }

  for (const method of ["appendDecision", "listOpenDecisions", "resolveDecision"]) {
    if (typeof runtime[method] !== "function") {
      throw new Error(`Decision runtime is missing ${method}().`);
    }
  }

  return runtime;
}

async function loadDefaultDecisionRuntime() {
  return validateDecisionRuntime(await import("./decisions-store.mjs"));
}

export function createStudioDecisionsRouteHandler({
  vaultDir = DEFAULT_VAULT_DIR,
  decisionRuntime = null,
  loadDecisionRuntime = null,
} = {}) {
  let runtimePromise = null;

  async function resolveDecisionRuntime() {
    if (decisionRuntime) {
      return validateDecisionRuntime(decisionRuntime);
    }

    if (!runtimePromise) {
      runtimePromise = Promise.resolve(
        typeof loadDecisionRuntime === "function" ? loadDecisionRuntime() : loadDefaultDecisionRuntime(),
      ).then((runtime) => validateDecisionRuntime(runtime));
    }

    return runtimePromise;
  }

  return async (req, res, url) => {
    if (url.pathname !== "/studio/decisions/open" &&
        url.pathname !== "/studio/decisions/append" &&
        url.pathname !== "/studio/decisions/resolve" &&
        url.pathname !== "/studio/decisions/promote") {
      return false;
    }

    let runtime;
    try {
      runtime = await resolveDecisionRuntime();
    } catch (error) {
      sendJson(res, 503, {
        error: "Decision runtime is not available.",
        details: describeError(error),
      });
      return true;
    }

    if (url.pathname === "/studio/decisions/open" && req.method === "GET") {
      try {
        const decisions = await runtime.listOpenDecisions({
          vaultDir: normalizeVaultDir(url.searchParams.get("vaultDir"), vaultDir),
        });
        sendJson(res, 200, { decisions });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read open decisions.",
          details: describeError(error),
        });
      }
      return true;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        error: "Invalid decision payload.",
        details: describeError(error),
      });
      return true;
    }

    if (url.pathname === "/studio/decisions/append" && req.method === "POST") {
      const entry = normalizeEntryPayload(body);
      if (!entry) {
        sendJson(res, 400, { error: "Missing decision entry." });
        return true;
      }

      try {
        const result = await runtime.appendDecision({
          vaultDir: normalizeVaultDir(body?.vaultDir, vaultDir),
          entry,
        });
        sendJson(res, 201, result);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to append decision.",
          details: describeError(error),
        });
      }
      return true;
    }

    if (url.pathname === "/studio/decisions/resolve" && req.method === "POST") {
      const id = typeof body?.id === "string" ? body.id.trim() : "";
      if (!id) {
        sendJson(res, 400, { error: "Missing decision id." });
        return true;
      }

      try {
        const result = await runtime.resolveDecision({
          vaultDir: normalizeVaultDir(body?.vaultDir, vaultDir),
          id,
        });
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to resolve decision.",
          details: describeError(error),
        });
      }
      return true;
    }

    if (url.pathname === "/studio/decisions/promote" && req.method === "POST") {
      if (typeof runtime.promoteToLedger !== "function") {
        sendJson(res, 503, { error: "Decision runtime cannot promote inbox entries." });
        return true;
      }

      const { inboxId, resolvedText, writer, contextRef } = normalizePromotePayload(body);
      if (!inboxId) {
        sendJson(res, 400, { error: "Missing inboxId." });
        return true;
      }
      if (!resolvedText) {
        sendJson(res, 400, { error: "Missing resolvedText." });
        return true;
      }

      try {
        const result = await runtime.promoteToLedger({
          vaultDir: normalizeVaultDir(body?.vaultDir, vaultDir),
          inboxId,
          resolvedText,
          writer,
          contextRef,
        });
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to promote decision.",
          details: describeError(error),
        });
      }
      return true;
    }

    return false;
  };
}
