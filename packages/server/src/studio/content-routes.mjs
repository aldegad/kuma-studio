import { readJsonBody, sendJson } from "../server-support.mjs";
import { getMembersById } from "../team-metadata.mjs";
import { generateContentDrafts } from "./content-suggestions.mjs";
import { getContentConstants } from "./content-store.mjs";

function parseContentId(pathname) {
  const match = pathname.match(/^\/studio\/contents?\/([^/]+)$/u);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseContentStatusPath(pathname) {
  const match = pathname.match(/^\/studio\/contents?\/([^/]+)\/status$/u);
  return match ? decodeURIComponent(match[1]) : null;
}

function isContentCollectionPath(pathname) {
  return /^\/studio\/contents?$/u.test(pathname);
}

function isContentMetaPath(pathname) {
  return /^\/studio\/contents?\/meta$/u.test(pathname);
}

function isContentGeneratePath(pathname) {
  return /^\/studio\/contents?\/generate$/u.test(pathname);
}

function normalizeAssigneeQuery(value) {
  if (value == null) {
    return undefined;
  }

  if (value === "" || value === "unassigned") {
    return null;
  }

  return value.trim() || null;
}

export function createContentRouteHandler({ contentStore, workspaceRoot }) {
  const membersById = getMembersById();
  const validAssigneeIds = new Set(
    Array.from(membersById.values())
      .map((member) => (typeof member?.id === "string" ? member.id : ""))
      .filter(Boolean),
  );

  function validateAssignee(value) {
    if (value == null || value === "") {
      return null;
    }

    if (typeof value !== "string") {
      throw new Error("assignee must be a string or null.");
    }

    const assignee = value.trim();
    if (!assignee) {
      return null;
    }

    if (!validAssigneeIds.has(assignee)) {
      throw new Error(`Unknown assignee: ${assignee}`);
    }

    return assignee;
  }

  function validateContentPayload(body, { requireAssigneePresence = false } = {}) {
    if (!body || typeof body !== "object") {
      return body;
    }

    const nextBody = { ...body };
    if (Object.prototype.hasOwnProperty.call(nextBody, "assignee") || requireAssigneePresence) {
      nextBody.assignee = validateAssignee(nextBody.assignee);
    }
    return nextBody;
  }

  return async (req, res, url) => {
    if (!contentStore) {
      return false;
    }

    if (isContentMetaPath(url.pathname) && req.method === "GET") {
      sendJson(res, 200, getContentConstants());
      return true;
    }

    if (isContentCollectionPath(url.pathname) && req.method === "GET") {
      try {
        const assignee = normalizeAssigneeQuery(url.searchParams.get("assignee"));
        if (typeof assignee === "string") {
          validateAssignee(assignee);
        }
        sendJson(res, 200, {
          items: contentStore.list(url.searchParams.get("project"), assignee),
        });
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid content filter.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (isContentCollectionPath(url.pathname) && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        sendJson(res, 201, contentStore.write(validateContentPayload(body, { requireAssigneePresence: true })));
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid content payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (isContentGeneratePath(url.pathname) && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const project =
          typeof body?.project === "string" && body.project.trim()
            ? body.project.trim()
            : "kuma-studio";
        const drafts = await generateContentDrafts({ project, workspaceRoot });
        const persist = body?.persist !== false;
        const items = persist ? drafts.map((draft) => contentStore.write(draft)) : drafts;
        sendJson(res, 200, { items });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to generate content drafts.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    const statusId = parseContentStatusPath(url.pathname);
    if (statusId && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const status = typeof body?.status === "string" ? body.status : "";
        const updated = contentStore.updateStatus(statusId, status, {
          scheduledFor: body?.scheduledFor,
        });
        if (!updated) {
          sendJson(res, 404, { error: "Content item not found." });
          return true;
        }
        sendJson(res, 200, updated);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid content status payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    const contentId = parseContentId(url.pathname);
    if (contentId && req.method === "GET") {
      const item = contentStore.readById(contentId);
      if (!item) {
        sendJson(res, 404, { error: "Content item not found." });
      } else {
        sendJson(res, 200, item);
      }
      return true;
    }

    if (contentId && req.method === "PATCH") {
      try {
        const body = await readJsonBody(req);
        const updated = contentStore.update(contentId, validateContentPayload(body));
        if (!updated) {
          sendJson(res, 404, { error: "Content item not found." });
          return true;
        }
        sendJson(res, 200, updated);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid content update payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (contentId && req.method === "DELETE") {
      const deleted = contentStore.delete(contentId);
      if (!deleted) {
        sendJson(res, 404, { error: "Content item not found." });
      } else {
        sendJson(res, 200, deleted);
      }
      return true;
    }

    return false;
  };
}
