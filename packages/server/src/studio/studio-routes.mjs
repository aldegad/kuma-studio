/**
 * Studio HTTP routes -- serves the studio-web static files
 * and provides REST API endpoints for stats and office layout state.
 */

import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join, extname, basename, relative, isAbsolute } from "node:path";
import { readJsonBody, sendJson } from "../server-support.mjs";
import { readPlans } from "./plan-store.mjs";
import { listClaudePlans, deleteClaudePlan } from "./claude-plans-store.mjs";
import { filterTeamStatusSnapshot, toStudioTeamStatusSnapshot } from "./team-status-store.mjs";
import { createContentRouteHandler } from "./content-routes.mjs";
import { getMembersById } from "../team-metadata.mjs";
import { createExperimentRouteHandler } from "./experiment-routes.mjs";
import { createTrendRouteHandler } from "./trend-routes.mjs";
import { resolveVaultImagesDir } from "./memo-store.mjs";
import { readExtensionsCatalog } from "./extensions-catalog.mjs";
import { isNightModeEnabled, setNightModeEnabled } from "./nightmode-store.mjs";
import { syncVaultSkills } from "./vault-skill-sync.mjs";
import { execGitSync } from "./git-command.mjs";
import { createTeamConfigRuntime, findMemberStatus } from "./team-config-runtime.mjs";
import { readStudioPlugins, readStudioSkills } from "./studio-skill-catalog.mjs";

export { createTeamConfigRuntime } from "./team-config-runtime.mjs";
export { extractStudioSkillDescription } from "./studio-skill-catalog.mjs";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isPathWithinRoot(rootPath, rootRealPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return false;
  }

  const realCandidatePath = realpathSync(candidatePath);
  const realRelativePath = relative(rootRealPath, realCandidatePath);
  return !(realRelativePath.startsWith("..") || isAbsolute(realRelativePath));
}

// ---------------------------------------------------------------------------
// File-system explorer helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".venv", "__pycache__", ".next", ".turbo", "build", "coverage", ".cache"]);
const fsWorkspaceRoot = resolve(process.env.KUMA_STUDIO_WORKSPACE || join(homedir(), "Documents", "workspace"));
const fsAllowedRoots = [
  fsWorkspaceRoot,
  resolve(join(homedir(), ".claude")),
  resolve(join(homedir(), ".codex")),
  resolve(join(homedir(), ".kuma", "vault")),
  resolve(join(homedir(), ".kuma", "wiki")),
];
function isAllowedPath(candidatePath) {
  const resolved = resolve(candidatePath);
  return fsAllowedRoots.some((root) => resolved.startsWith(root));
}

async function buildFsTree(dirPath, maxDepth, currentDepth) {
  const name = basename(dirPath);
  const hidden = name.startsWith(".");
  const node = { name, path: dirPath, type: "dir", hidden };

  if (SKIP_DIRS.has(name) && currentDepth > 0) {
    node.expandable = false;
    return node;
  }

  if (currentDepth >= maxDepth) {
    node.children = [];
    return node;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const children = [];

    for (const entry of entries) {
      const childPath = join(dirPath, entry.name);
      const childHidden = entry.name.startsWith(".");

      if (entry.isDirectory()) {
        children.push(await buildFsTree(childPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        const s = await stat(childPath).catch(() => null);
        children.push({
          name: entry.name,
          path: childPath,
          type: "file",
          hidden: childHidden,
          size: s ? s.size : undefined,
        });
      }
    }

    // Sort: dirs first, then files, alphabetical within each group
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    node.children = children;
  } catch {
    node.children = [];
  }

  return node;
}

/**
 * @param {object} options
 * @param {string} options.staticDir
 * @param {import("./stats-store.mjs").StatsStore} options.statsStore
 * @param {import("../scene-store.mjs").SceneStore} options.sceneStore
 * @param {import("./agent-state.mjs").AgentStateManager} [options.agentStateManager]
 * @param {import("./team-status-store.mjs").TeamStatusStore} [options.teamStatusStore]
 * @param {import("./content-store.mjs").ContentStore} [options.contentStore]
 * @param {import("./trend-store.mjs").TrendStore} [options.trendStore]
 * @param {import("./experiment-store.mjs").ExperimentStore} [options.experimentStore]
 * @param {ReturnType<import("./experiment-pipeline.mjs").createExperimentPipeline>} [options.experimentPipeline]
 * @param {import("./memo-store.mjs").MemoStore} [options.memoStore]
 * @param {import("./team-config-store.mjs").TeamConfigStore} [options.teamConfigStore]
 * @param {import("./studio-ws-events.mjs").StudioWsEvents} [options.studioWsEvents]
 * @param {import("./agent-history-store.mjs").AgentHistoryStore} [options.agentHistoryStore]
 * @param {(options?: { vaultDir?: string }) => Promise<object>} [options.vaultSkillSyncFn]
 * @param {{
 *   resolveMemberContext?: (memberName: string, emoji?: string) => { project?: string, label?: string, surface?: string } | null,
 *   registerPendingSelfWrite?: (input: { memberId: string, memberConfig: object, ttlMs?: number }) => void,
 *   settlePendingSelfWrite?: (memberId: string, ttlMs?: number) => void,
 *   consumePendingSelfWrite?: (input: { memberId: string, memberConfig: object }) => boolean,
 *   clearPendingSelfWrite?: (memberId: string) => void,
 *   respawnMember?: (input: { memberName: string, memberConfig: object, project: string, currentSurface?: string | null, workspaceRoot: string }) =>
 *     { project: string, surface: string | null, queued?: boolean, cleanupFailed?: boolean, cleanupError?: string | null } |
 *     Promise<{ project: string, surface: string | null, queued?: boolean, cleanupFailed?: boolean, cleanupError?: string | null }>
 * }} [options.teamConfigRuntime]
 * @param {string} [options.workspaceRoot]
 * @param {(req: import("http").IncomingMessage, res: import("http").ServerResponse) => Promise<boolean>} [options.studioDevDelegate]
 * @returns {(req: import("http").IncomingMessage, res: import("http").ServerResponse) => Promise<boolean>}
 */
export function createStudioRouteHandler({
  staticDir,
  statsStore,
  sceneStore,
  agentStateManager,
  teamStatusStore,
  contentStore,
  trendStore,
  experimentStore,
  experimentPipeline,
  memoStore,
  teamConfigStore,
  studioWsEvents,
  agentHistoryStore,
  vaultSkillSyncFn,
  teamConfigRuntime,
  workspaceRoot,
  studioDevDelegate = null,
}) {
  const staticRoot = resolve(staticDir);
  const staticRootReal = existsSync(staticRoot) ? realpathSync(staticRoot) : staticRoot;
  const handleContentRoute = createContentRouteHandler({
    contentStore,
    trendStore,
    experimentStore,
    experimentPipeline,
    workspaceRoot: workspaceRoot ?? resolve(join(staticDir, "..", "..", "..")),
  });
  const handleTrendRoute = createTrendRouteHandler({ trendStore, contentStore, experimentStore, experimentPipeline });
  const handleExperimentRoute = createExperimentRouteHandler({
    experimentStore,
    pipeline: experimentPipeline,
    contentStore,
    trendStore,
  });
  const configRuntime = teamConfigRuntime ?? createTeamConfigRuntime();

  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (await handleContentRoute(req, res, url)) {
      return true;
    }

    if (await handleTrendRoute(req, res, url)) {
      return true;
    }

    if (await handleExperimentRoute(req, res, url)) {
      return true;
    }

    if (url.pathname === "/studio/health" && req.method === "GET") {
      sendJson(res, 200, { ok: true, uptime: process.uptime() });
      return true;
    }

    if (url.pathname === "/studio/stats" && req.method === "GET") {
      sendJson(res, 200, statsStore.getStats());
      return true;
    }

    if (url.pathname === "/studio/team-tree" && req.method === "GET") {
      if (agentStateManager) {
        sendJson(res, 200, agentStateManager.getTreeState("kuma"));
      } else {
        sendJson(res, 200, { id: "kuma", state: "idle", nodeType: "session", children: [] });
      }
      return true;
    }

    if (url.pathname === "/studio/team-status" && req.method === "GET") {
      const projectId = url.searchParams.get("project");
      const snapshot = filterTeamStatusSnapshot(teamStatusStore?.getSnapshot() ?? { projects: {} }, projectId);
      sendJson(res, 200, toStudioTeamStatusSnapshot(snapshot));
      return true;
    }

    // Agent work history
    const agentHistoryMatch = url.pathname.match(/^\/studio\/agent-history\/(.+)$/);
    if (agentHistoryMatch && req.method === "GET") {
      if (!agentHistoryStore) {
        sendJson(res, 200, { history: [] });
        return true;
      }
      const agentId = decodeURIComponent(agentHistoryMatch[1]);
      sendJson(res, 200, { history: agentHistoryStore.getHistory(agentId) });
      return true;
    }

    if (url.pathname === "/studio/team-config" && req.method === "GET") {
      if (!teamConfigStore) {
        sendJson(res, 503, { error: "Team config store is not available." });
        return true;
      }

      const config = teamConfigStore.getConfig();
      const fullMembers = getMembersById();
      const enriched = {};
      for (const [name, member] of Object.entries(config.members)) {
        const full = fullMembers.get(member.id);
        enriched[name] = {
          ...member,
          nameEn: full?.name?.en ?? "",
          animalKo: full?.animal?.ko ?? "",
          animalEn: full?.animal?.en ?? "",
          image: full?.image ?? "",
          skills: full?.skills ?? [],
          parentId: full?.parentId ?? null,
        };
      }
      sendJson(res, 200, { ...config, members: enriched });
      return true;
    }

    const teamConfigMatch = url.pathname.match(/^\/studio\/team-config\/([^/]+)$/u);
    if (teamConfigMatch && req.method === "PATCH") {
      if (!teamConfigStore) {
        sendJson(res, 503, { error: "Team config store is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid team-config payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      const memberRef = decodeURIComponent(teamConfigMatch[1]);
      const currentEntry = teamConfigStore.getMember(memberRef);
      if (!currentEntry) {
        sendJson(res, 404, { error: "Unknown team member." });
        return true;
      }

      const hasPatch =
        typeof body?.type === "string" ||
        typeof body?.modelCatalogId === "string" ||
        typeof body?.model === "string" ||
        typeof body?.options === "string";
      if (!hasPatch) {
        sendJson(res, 400, { error: "Missing team-config changes." });
        return true;
      }

      if (typeof body?.type === "string" && body.type !== "claude" && body.type !== "codex") {
        sendJson(res, 400, { error: "type must be claude or codex." });
        return true;
      }

      const memberName = currentEntry.key;
      const memberStatus = findMemberStatus(teamStatusStore?.getSnapshot() ?? { projects: {} }, memberName);
      if (memberStatus === "working" && body?.force !== true) {
        sendJson(res, 409, {
          error: "Member is busy.",
          requiresForce: true,
          member: memberName,
          status: memberStatus,
          warning: `${memberName} is currently working. Retry with { "force": true } to continue.`,
        });
        return true;
      }

      const previousConfig = currentEntry.config;
      const updatedEntry = teamConfigStore.updateMember(memberRef, {
        type: typeof body?.type === "string" ? body.type : undefined,
        model: typeof body?.model === "string" ? body.model : undefined,
        options: typeof body?.options === "string" ? body.options : undefined,
      });

      if (!updatedEntry) {
        sendJson(res, 404, { error: "Unknown team member." });
        return true;
      }

      const memberContext = configRuntime.resolveMemberContext?.(memberName, updatedEntry.member.emoji) ?? null;
      const project =
        (typeof body?.project === "string" && body.project.trim()) ||
        memberContext?.project ||
        (updatedEntry.member.team === "system" ? "system" : "kuma-studio");
      const memberId = updatedEntry.member.id || memberName;

      try {
        configRuntime.registerPendingSelfWrite?.({
          memberId,
          memberConfig: updatedEntry.member,
        });
        const respawned = await configRuntime.respawnMember({
          memberName,
          memberConfig: updatedEntry.member,
          project,
          currentSurface: memberContext?.surface ?? null,
          workspaceRoot: workspaceRoot ?? resolve(join(staticDir, "..", "..", "..")),
        });
        configRuntime.settlePendingSelfWrite?.(memberId);
        const cleanupFailed = "cleanupFailed" in respawned && respawned.cleanupFailed === true;
        const cleanupError = "cleanupError" in respawned && typeof respawned.cleanupError === "string"
          ? respawned.cleanupError
          : null;

        const payload = {
          member: memberName,
          config: updatedEntry.member,
          project: respawned.project,
          surface: respawned.surface ?? memberContext?.surface ?? null,
          queued: respawned.queued === true,
          cleanupFailed,
          cleanupError,
          forced: body?.force === true,
        };
        studioWsEvents?.broadcastTeamConfigChanged(payload);
        sendJson(res, 200, payload);
      } catch (error) {
        configRuntime.clearPendingSelfWrite?.(memberId);
        teamConfigStore.saveConfig(previousConfig);
        sendJson(res, 500, {
          error: "Failed to respawn member with the updated team config.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/daily-report" && req.method === "GET") {
      sendJson(res, 200, statsStore.getDailyReport());
      return true;
    }

    if (url.pathname === "/studio/skills" && req.method === "GET") {
      sendJson(res, 200, { skills: await readStudioSkills() });
      return true;
    }

    if (url.pathname === "/studio/plugins" && req.method === "GET") {
      sendJson(res, 200, { plugins: await readStudioPlugins() });
      return true;
    }

    if (url.pathname === "/studio/extensions-catalog" && req.method === "GET") {
      sendJson(res, 200, await readExtensionsCatalog());
      return true;
    }

    if (url.pathname === "/studio/plans" && req.method === "GET") {
      try {
        sendJson(res, 200, await readPlans());
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read plans.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/nightmode" && req.method === "GET") {
      sendJson(res, 200, { enabled: isNightModeEnabled() });
      return true;
    }

    if (url.pathname === "/studio/nightmode" && req.method === "POST") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid nightmode payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      if (typeof body?.enabled !== "boolean") {
        sendJson(res, 400, { error: "enabled must be a boolean." });
        return true;
      }

      try {
        await setNightModeEnabled(body.enabled);
        studioWsEvents?.broadcastNightMode(body.enabled);
        sendJson(res, 200, { enabled: body.enabled });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to update nightmode.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/memos" && req.method === "GET") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      try {
        sendJson(res, 200, {
          memos: await memoStore.list(),
        });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read memos.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/vault" && req.method === "GET") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      try {
        sendJson(res, 200, {
          memos: await memoStore.list(),
          inbox: await memoStore.listInbox(),
        });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read vault entries.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/vault/sync-skills" && req.method === "POST") {
      try {
        const syncResult = await (vaultSkillSyncFn ?? syncVaultSkills)({
          vaultDir: memoStore?.getVaultDir?.(),
        });
        sendJson(res, 200, syncResult);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to sync skill documents into the vault.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/vault/inbox" && req.method === "POST") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid memo payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (!text) {
        sendJson(res, 400, { error: "Missing inbox text." });
        return true;
      }

      try {
        const memo = await memoStore.addInbox({
          title: typeof body?.title === "string" ? body.title : "Inbox",
          text,
        });
        sendJson(res, 201, memo);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to create inbox entry.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if ((url.pathname === "/studio/vault" || url.pathname === "/studio/memos") && req.method === "POST") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid memo payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      const title = typeof body?.title === "string" ? body.title.trim() : "";
      if (!title) {
        sendJson(res, 400, { error: "Missing title." });
        return true;
      }

      try {
        const memo = await memoStore.add({
          title,
          text: typeof body?.text === "string" ? body.text : "",
          images: Array.isArray(body?.images) ? body.images : [],
        });
        sendJson(res, 201, memo);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to create memo.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if ((url.pathname.startsWith("/studio/vault/") || url.pathname.startsWith("/studio/memos/")) && req.method === "DELETE") {
      if (!memoStore) {
        sendJson(res, 503, { error: "Memo store is not available." });
        return true;
      }

      const memoId = url.pathname.startsWith("/studio/vault/")
        ? decodeURIComponent(url.pathname.slice("/studio/vault/".length))
        : decodeURIComponent(url.pathname.slice("/studio/memos/".length));
      const result = await memoStore.delete(memoId);
      if (result.success) {
        sendJson(res, 200, { success: true });
      } else {
        sendJson(res, result.status || 500, { error: result.error });
      }
      return true;
    }

    if (url.pathname === "/studio/claude-plans" && req.method === "GET") {
      try {
        sendJson(res, 200, { plans: await listClaudePlans() });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read Claude plans.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname.startsWith("/studio/claude-plans/") && req.method === "DELETE") {
      const filename = decodeURIComponent(url.pathname.split("/studio/claude-plans/")[1]);
      const result = await deleteClaudePlan(filename);
      if (result.success) {
        sendJson(res, 200, { success: true });
      } else {
        sendJson(res, result.status || 500, { error: result.error });
      }
      return true;
    }

    if (url.pathname === "/studio/git-log" && req.method === "GET") {
      try {
        const raw = execGitSync("git log --oneline -10 --no-color", {
          cwd: resolve(join(staticDir, "..", "..", "..")),
          encoding: "utf-8",
          timeout: 3000,
        });
        const commits = raw.trim().split("\n").map((line) => {
          const [hash, ...rest] = line.split(" ");
          return { hash, message: rest.join(" ") };
        });
        sendJson(res, 200, { commits });
      } catch {
        sendJson(res, 200, { commits: [] });
      }
      return true;
    }

    if (url.pathname === "/studio/office-layout" && req.method === "GET") {
      try {
        sendJson(res, 200, sceneStore.readOfficeLayout());
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read office layout.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/office-layout" && req.method === "PUT") {
      try {
        sendJson(res, 200, sceneStore.writeOfficeLayout(await readJsonBody(req)));
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid office layout payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/agent-state" && req.method === "POST") {
      if (!agentStateManager) {
        sendJson(res, 503, { error: "Agent state manager is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid agent state payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
      const status = typeof body?.status === "string" ? body.status.trim() : "";
      const task =
        typeof body?.task === "string"
          ? body.task
          : body?.task == null
            ? null
            : String(body.task);

      if (!agentId) {
        sendJson(res, 400, { error: "Missing agentId." });
        return true;
      }

      if (!status) {
        sendJson(res, 400, { error: "Missing status." });
        return true;
      }

      if (!agentStateManager.setState(agentId, status, task)) {
        sendJson(res, 400, { error: `Invalid agent status: ${status}` });
        return true;
      }

      sendJson(res, 200, {
        agentId,
        status: agentStateManager.getState(agentId),
        task: agentStateManager.getTask(agentId),
      });
      return true;
    }

    // ------------------------------------------------------------------
    // Git status for IDE explorer
    // ------------------------------------------------------------------

    if (url.pathname === "/studio/git/status" && req.method === "GET") {
      const root = url.searchParams.get("root") || workspaceRoot || fsWorkspaceRoot;
      const resolvedRoot = resolve(root);
      if (!isAllowedPath(resolvedRoot)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      try {
        const output = execGitSync("git status --porcelain -u", {
          cwd: resolvedRoot,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 1024 * 1024,
        });

        const files = {};
        for (const line of output.split("\n")) {
          if (!line.trim()) continue;
          const code = line.slice(0, 2).trim();
          const filePath = line.slice(3).trim();
          // Map git status codes to simple labels
          let status = "modified";
          if (code === "??" || code === "A") status = "added";
          else if (code === "D") status = "deleted";
          else if (code === "R") status = "renamed";
          files[filePath] = status;
        }

        sendJson(res, 200, { root: resolvedRoot, files });
      } catch {
        // Not a git repo or git not available
        sendJson(res, 200, { root: resolvedRoot, files: {} });
      }
      return true;
    }

    // ------------------------------------------------------------------
    // File-system endpoints for IDE explorer
    // ------------------------------------------------------------------

    if (url.pathname === "/studio/fs/tree" && req.method === "GET") {
      const root = url.searchParams.get("root") || fsWorkspaceRoot;
      const depth = Math.min(Math.max(parseInt(url.searchParams.get("depth") || "2", 10) || 2, 1), 5);

      const resolvedRoot = resolve(root);
      if (!isAllowedPath(resolvedRoot)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      try {
        const tree = await buildFsTree(resolvedRoot, depth, 0);
        sendJson(res, 200, tree);
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read directory tree.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/fs/read" && req.method === "GET") {
      const filePath = url.searchParams.get("path");
      if (!filePath) {
        sendJson(res, 400, { error: "Missing path parameter." });
        return true;
      }

      const resolved = resolve(filePath);
      if (!isAllowedPath(resolved)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      try {
        const s = await stat(resolved);
        if (!s.isFile()) {
          sendJson(res, 400, { error: "Not a file." });
          return true;
        }

        const ext = extname(resolved).toLowerCase();
        const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
        const imageMimeMap = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp" };

        if (imageExts.has(ext)) {
          const buf = await readFile(resolved);
          sendJson(res, 200, { content: buf.toString("base64"), mimeType: imageMimeMap[ext] || "application/octet-stream" });
          return true;
        }

        // Check if binary by reading first 8KB
        const buf = await readFile(resolved);
        const sample = buf.subarray(0, 8192);
        if (sample.includes(0)) {
          sendJson(res, 200, { binary: true, size: s.size });
          return true;
        }

        const langMap = {
          ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
          ".mjs": "javascript", ".cjs": "javascript", ".json": "json", ".md": "markdown",
          ".html": "html", ".css": "css", ".scss": "scss", ".py": "python", ".sh": "bash",
          ".yml": "yaml", ".yaml": "yaml", ".toml": "toml", ".xml": "xml", ".sql": "sql",
          ".rs": "rust", ".go": "go", ".java": "java", ".rb": "ruby", ".php": "php",
          ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp", ".swift": "swift",
        };

        sendJson(res, 200, { content: buf.toString("utf8"), language: langMap[ext] || "plaintext" });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read file.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/fs/delete" && req.method === "DELETE") {
      const body = await readJsonBody(req);
      const filePath = body?.path;
      if (!filePath) {
        sendJson(res, 400, { error: "Missing path parameter." });
        return true;
      }

      const resolved = resolve(filePath);
      if (!isAllowedPath(resolved)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }

      try {
        const s = await stat(resolved);
        if (!s.isFile()) {
          sendJson(res, 400, { error: "Not a file. Only file deletion is supported." });
          return true;
        }
        await unlink(resolved);
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to delete file.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (url.pathname === "/studio/fs/write" && req.method === "PUT") {
      const body = await readJsonBody(req);
      const filePath = body?.path;
      const fileContent = body?.content;
      if (!filePath || typeof fileContent !== "string") {
        sendJson(res, 400, { error: "Missing path or content." });
        return true;
      }
      const resolved = resolve(filePath);
      if (!isAllowedPath(resolved)) {
        sendJson(res, 403, { error: "Path outside allowed directories." });
        return true;
      }
      try {
        await writeFile(resolved, fileContent, "utf8");
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendJson(res, 500, { error: "Failed to write file.", details: error instanceof Error ? error.message : "Unknown error" });
      }
      return true;
    }

    if (url.pathname.startsWith("/studio/skills/") && req.method === "DELETE") {
      const skillName = decodeURIComponent(url.pathname.split("/studio/skills/")[1]);
      if (!skillName) { sendJson(res, 400, { error: "Missing skill name." }); return true; }
      const skillDir = join(homedir(), ".claude", "skills", skillName);
      try {
        const s = await stat(skillDir);
        if (!s.isDirectory()) { sendJson(res, 400, { error: "Not a skill directory." }); return true; }
        await rm(skillDir, { recursive: true, force: true });
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendJson(res, 500, { error: "Failed to delete skill.", details: error instanceof Error ? error.message : "Unknown error" });
      }
      return true;
    }

    if (url.pathname.startsWith("/studio/memo-images/")) {
      const imageName = basename(decodeURIComponent(url.pathname.split("/studio/memo-images/")[1] ?? ""));
      const resolvedPath = memoStore?.findImagePath?.(imageName);
      const imageDir = memoStore?.getImagesDir?.() ?? resolveVaultImagesDir();
      const fullPath = resolvedPath ?? resolve(join(imageDir, imageName));

      try {
        if (imageName && existsSync(fullPath) && statSync(fullPath).isFile()) {
          const ext = extname(fullPath);
          const mime = MIME_TYPES[ext] ?? "application/octet-stream";
          const content = readFileSync(fullPath);
          res.writeHead(200, { "Content-Type": mime });
          res.end(content);
          return true;
        }
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read memo image.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      res.writeHead(404);
      res.end("Not Found");
      return true;
    }

    if (url.pathname.startsWith("/studio")) {
      if (typeof studioDevDelegate === "function") {
        const handled = await studioDevDelegate(req, res, url);
        if (handled) {
          return true;
        }

        res.writeHead(404);
        res.end("Not Found");
        return true;
      }

      let filePath = url.pathname.replace(/^\/studio\/?/, "");
      if (!filePath || filePath === "") filePath = "index.html";

      const fullPath = resolve(join(staticRoot, filePath));
      const relativePath = relative(staticRoot, fullPath);

      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        res.writeHead(403);
        res.end("Forbidden");
        return true;
      }

      try {
        if (existsSync(fullPath) && statSync(fullPath).isFile()) {
          if (!isPathWithinRoot(staticRoot, staticRootReal, fullPath)) {
            res.writeHead(403);
            res.end("Forbidden");
            return true;
          }

          const ext = extname(fullPath);
          const mime = MIME_TYPES[ext] ?? "application/octet-stream";
          const content = readFileSync(fullPath);
          res.writeHead(200, { "Content-Type": mime });
          res.end(content);
          return true;
        }

        const indexPath = resolve(join(staticRoot, "index.html"));
        if (existsSync(indexPath) && statSync(indexPath).isFile()) {
          if (!isPathWithinRoot(staticRoot, staticRootReal, indexPath)) {
            res.writeHead(403);
            res.end("Forbidden");
            return true;
          }

          const content = readFileSync(indexPath);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(content);
          return true;
        }
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to read studio asset.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      res.writeHead(404);
      res.end("Not Found");
      return true;
    }

    return false;
  };
}
