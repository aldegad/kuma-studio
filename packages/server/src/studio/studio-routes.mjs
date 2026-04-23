/**
 * Studio HTTP routes -- serves the studio-web static files
 * and provides REST API endpoints for stats and office layout state.
 */

import { rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readJsonBody, sendJson } from "../server-support.mjs";
import { readPlans } from "./plan-store.mjs";
import { listClaudePlans, deleteClaudePlan } from "./claude-plans-store.mjs";
import { toStudioTeamStatusSnapshot } from "./team-status-store.mjs";
import { createContentRouteHandler } from "./content-routes.mjs";
import { getMembersById } from "../team-metadata.mjs";
import { createExperimentRouteHandler } from "./experiment-routes.mjs";
import { createTrendRouteHandler } from "./trend-routes.mjs";
import { readExtensionsCatalog } from "./extensions-catalog.mjs";
import { isNightModeEnabled, setNightModeEnabled } from "./nightmode-store.mjs";
import { execGitSync } from "./git-command.mjs";
import { createTeamConfigRuntime, findMemberStatus } from "./team-config-runtime.mjs";
import { createStudioExplorerRouteHandler } from "./studio-explorer-routes.mjs";
import { createStudioMemoRouteHandler } from "./studio-memo-routes.mjs";
import { getDefaultProjectIdForTeam } from "./project-defaults.mjs";
import { readStudioPlugins, readStudioSkills } from "./studio-skill-catalog.mjs";
import { createStudioStaticRouteHandler } from "./studio-static-routes.mjs";
import { createStudioHwpFontRouteHandler } from "./studio-hwp-font-routes.mjs";
import { createStudioHwpEditorRouteHandler } from "./studio-hwp-editor-routes.mjs";
import { createStudioMarkdownPdfRouteHandler } from "./studio-markdown-pdf-routes.mjs";
import { renderTeamMemberPrompt } from "./team-prompt-renderer.mjs";

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
 * @param {import("./dispatch-broker.mjs").DispatchBroker} [options.dispatchBroker]
 * @param {import("./studio-ui-state-store.mjs").StudioUiStateStore} [options.studioUiStateStore]
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
  dispatchBroker,
  studioUiStateStore,
  teamConfigRuntime,
  workspaceRoot,
  explorerGlobalRoots,
  studioDevDelegate = null,
}) {
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
  const handleExplorerRoute = createStudioExplorerRouteHandler({
    workspaceRoot,
    globalRoots: explorerGlobalRoots,
    systemRoot: process.cwd(),
    studioWsEvents,
  });
  const handleMemoRoute = createStudioMemoRouteHandler({
    memoStore,
    studioWsEvents,
  });
  const handleHwpFontRoute = createStudioHwpFontRouteHandler();
  const handleHwpEditorRoute = createStudioHwpEditorRouteHandler();
  const handleMarkdownPdfRoute = createStudioMarkdownPdfRouteHandler({
    workspaceRoot,
    globalRoots: explorerGlobalRoots,
    systemRoot: process.cwd(),
  });
  const handleStaticRoute = createStudioStaticRouteHandler({
    staticDir,
    studioDevDelegate,
  });

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

    if (await handleExplorerRoute(req, res, url)) {
      return true;
    }

    if (await handleHwpFontRoute(req, res, url)) {
      return true;
    }

    if (await handleHwpEditorRoute(req, res, url)) {
      return true;
    }

    if (await handleMarkdownPdfRoute(req, res, url)) {
      return true;
    }

    if (url.pathname === "/studio/ui-state" && req.method === "GET") {
      if (!studioUiStateStore) {
        sendJson(res, 503, { error: "Studio UI state store is not available." });
        return true;
      }
      sendJson(res, 200, await studioUiStateStore.read());
      return true;
    }

    if (url.pathname === "/studio/ui-state" && req.method === "PATCH") {
      if (!studioUiStateStore) {
        sendJson(res, 503, { error: "Studio UI state store is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid UI state payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      try {
        sendJson(res, 200, await studioUiStateStore.patch(body));
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to persist UI state.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    if (await handleMemoRoute(req, res, url)) {
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
      const projectId = url.searchParams.get("project") ?? "";
      sendJson(res, 200, toStudioTeamStatusSnapshot(
        teamStatusStore?.getSurfaceStates() ?? new Map(),
        {
          projectId,
          registry: teamStatusStore?.getRegistry?.(),
        },
      ));
      return true;
    }

    if (url.pathname === "/studio/dispatches" && req.method === "GET") {
      if (!dispatchBroker) {
        sendJson(res, 503, { error: "Dispatch broker is not available." });
        return true;
      }

      const status = url.searchParams.get("status") ?? "";
      sendJson(res, 200, { dispatches: dispatchBroker.listDispatches({ status }) });
      return true;
    }

    if (url.pathname === "/studio/dispatches" && req.method === "POST") {
      if (!dispatchBroker) {
        sendJson(res, 503, { error: "Dispatch broker is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid dispatch payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      try {
        sendJson(res, 200, { dispatch: await dispatchBroker.registerDispatch(body) });
      } catch (error) {
        sendJson(res, 400, {
          error: "Failed to register dispatch.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
      return true;
    }

    const dispatchMatch = url.pathname.match(/^\/studio\/dispatches\/([^/]+)$/u);
    if (dispatchMatch && req.method === "GET") {
      if (!dispatchBroker) {
        sendJson(res, 503, { error: "Dispatch broker is not available." });
        return true;
      }

      const taskId = decodeURIComponent(dispatchMatch[1]);
      const dispatch = dispatchBroker.getDispatch(taskId);
      if (!dispatch) {
        sendJson(res, 404, { error: "Unknown dispatch." });
        return true;
      }

      sendJson(res, 200, { dispatch });
      return true;
    }

    const dispatchEventMatch = url.pathname.match(/^\/studio\/dispatches\/([^/]+)\/events$/u);
    if (dispatchEventMatch && req.method === "POST") {
      if (!dispatchBroker) {
        sendJson(res, 503, { error: "Dispatch broker is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid dispatch event payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      const taskId = decodeURIComponent(dispatchEventMatch[1]);
      try {
        const eventResult = typeof dispatchBroker.reportEventWithMetadata === "function"
          ? await dispatchBroker.reportEventWithMetadata(taskId, body)
          : { dispatch: await dispatchBroker.reportEvent(taskId, body), applied: true, ignoredReason: "" };
        sendJson(res, 200, eventResult);
      } catch (error) {
        const details = error instanceof Error ? error.message : "Unknown error";
        sendJson(res, details.startsWith("Unknown dispatch:") ? 404 : 400, {
          error: "Failed to report dispatch event.",
          details,
        });
      }
      return true;
    }

    const dispatchMessagesMatch = url.pathname.match(/^\/studio\/dispatches\/([^/]+)\/messages$/u);
    if (dispatchMessagesMatch && req.method === "GET") {
      if (!dispatchBroker) {
        sendJson(res, 503, { error: "Dispatch broker is not available." });
        return true;
      }

      const taskId = decodeURIComponent(dispatchMessagesMatch[1]);
      const messages = dispatchBroker.listMessages(taskId);
      if (!messages) {
        sendJson(res, 404, { error: "Unknown dispatch." });
        return true;
      }

      sendJson(res, 200, { messages });
      return true;
    }

    if (dispatchMessagesMatch && req.method === "POST") {
      if (!dispatchBroker) {
        sendJson(res, 503, { error: "Dispatch broker is not available." });
        return true;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          error: "Invalid dispatch message payload.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return true;
      }

      const taskId = decodeURIComponent(dispatchMessagesMatch[1]);
      try {
        sendJson(res, 200, { dispatch: await dispatchBroker.appendMessage(taskId, body) });
      } catch (error) {
        const details = error instanceof Error ? error.message : "Unknown error";
        sendJson(res, details.startsWith("Unknown dispatch:") ? 404 : 400, {
          error: "Failed to append dispatch message.",
          details,
        });
      }
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

    const teamPromptMatch = url.pathname.match(/^\/studio\/team-prompts\/([^/]+)$/u);
    if (teamPromptMatch && req.method === "GET") {
      if (!teamConfigStore) {
        sendJson(res, 503, { error: "Team config store is not available." });
        return true;
      }

      const memberRef = decodeURIComponent(teamPromptMatch[1]);
      const currentEntry = teamConfigStore.getMember(memberRef);
      if (!currentEntry) {
        sendJson(res, 404, { error: "Unknown team member." });
        return true;
      }

      try {
        const rendered = renderTeamMemberPrompt({
          memberName: currentEntry.key,
          requestedProject: url.searchParams.get("project") ?? "",
          workspaceRoot: workspaceRoot ?? resolve(join(staticDir, "..", "..", "..")),
          teamConfigPath: teamConfigStore.configPath,
        });

        sendJson(res, 200, {
          member: currentEntry.key,
          memberId: currentEntry.member.id,
          role: currentEntry.member.role,
          project: rendered.projectName,
          type: rendered.type,
          model: rendered.model,
          options: rendered.options,
          nodeType: rendered.nodeType,
          builder: rendered.builder,
          prompt: rendered.prompt,
        });
      } catch (error) {
        sendJson(res, 500, {
          error: "Failed to render team member prompt.",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
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
        modelCatalogId: typeof body?.modelCatalogId === "string" ? body.modelCatalogId : undefined,
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
        getDefaultProjectIdForTeam(updatedEntry.member.team, {
          workspaceRoot: workspaceRoot ?? resolve(join(staticDir, "..", "..", "..")),
        });
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
          deferIfWorking: body?.force !== true,
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

    if (await handleStaticRoute(req, res, url)) {
      return true;
    }

    return false;
  };
}
