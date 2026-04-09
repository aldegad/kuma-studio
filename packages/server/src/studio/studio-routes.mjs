/**
 * Studio HTTP routes -- serves the studio-web static files
 * and provides REST API endpoints for stats and office layout state.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { execFileSync, execSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve, join, extname, basename, relative, isAbsolute, dirname } from "node:path";
import { withCmuxEnv } from "../cmux-env.mjs";
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

function parseFrontmatter(content) {
  const text = String(content ?? "");
  if (!text.startsWith("---\n")) {
    return null;
  }

  const endIndex = text.indexOf("\n---", 4);
  if (endIndex === -1) {
    return null;
  }

  const block = text.slice(4, endIndex).trim();
  const fields = new Map();

  for (const line of block.split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/u);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    fields.set(key, rawValue.trim().replace(/^['"]|['"]$/gu, ""));
  }

  return {
    fields,
    body: text.slice(endIndex + 4).trim(),
  };
}

export function extractStudioSkillDescription(content) {
  const frontmatter = parseFrontmatter(content);
  const frontmatterDescription = frontmatter?.fields.get("description");
  if (frontmatterDescription) {
    return frontmatterDescription;
  }

  const body = frontmatter?.body ?? String(content ?? "");
  const lines = body.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => /^#\s+/u.test(line.trim()));
  const candidateLines = (headingIndex >= 0 ? lines.slice(headingIndex + 1) : lines)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#+\s+/u.test(line));

  const firstSentence = candidateLines[0]?.match(/^(.+?[.!?])(?:\s|$)/u)?.[1] ?? candidateLines[0] ?? "";
  return firstSentence.trim();
}

async function readStudioSkills() {
  try {
    const skillsDir = join(homedir(), ".claude", "skills");
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      // Verify symlink target is a directory
      if (entry.isSymbolicLink()) {
        try {
          const s = await stat(join(skillsDir, entry.name));
          if (!s.isDirectory()) continue;
        } catch { continue; }
      }

      try {
        const skillDir = join(skillsDir, entry.name);
        const files = await readdir(skillDir);
        const skillFile = files.find((file) => file.toLowerCase() === "skill.md");

        if (!skillFile) continue;

        const content = await readFile(join(skillDir, skillFile), "utf8");

        skills.push({
          name: entry.name,
          description: extractStudioSkillDescription(content),
          file: skillFile,
          content,
          path: join(skillDir, skillFile),
        });
      } catch {
        continue;
      }
    }

    return skills;
  } catch {
    return [];
  }
}

async function readStudioPlugins() {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const content = await readFile(settingsPath, "utf8");
    const settings = JSON.parse(content);
    const plugins = settings.enabledPlugins;
    if (Array.isArray(plugins)) return plugins;
    if (plugins && typeof plugins === "object") return Object.keys(plugins).filter((k) => plugins[k]);
    return [];
  } catch {
    return [];
  }
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
const DEFAULT_SURFACE_REGISTRY_PATH = "/tmp/kuma-surfaces.json";
const DEFAULT_CMUX_SPAWN_SCRIPT = join(homedir(), ".kuma", "cmux", "kuma-cmux-spawn.sh");
const DEFAULT_CMUX_KILL_SCRIPT = join(homedir(), ".kuma", "cmux", "kuma-cmux-kill.sh");
const DEFAULT_TEAM_RESPAWN_QUEUE_PATH = "/tmp/kuma-team-respawn-queue.json";
const DEFAULT_TEAM_WATCHER_LOG_PATH = "/tmp/kuma-team-watcher.log";
const DEFAULT_TEAM_RESPAWN_QUEUE_POLL_MS = 5_000;

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

function readSurfaceRegistry(registryPath = DEFAULT_SURFACE_REGISTRY_PATH) {
  try {
    return JSON.parse(readFileSync(registryPath, "utf8"));
  } catch {
    return {};
  }
}

function writeSurfaceRegistry(registry, registryPath = DEFAULT_SURFACE_REGISTRY_PATH) {
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function buildRegistryLabel(name, emoji = "") {
  return emoji ? `${emoji} ${name}` : name;
}

function resolveRegistryMemberContext(registry, memberName, emoji = "") {
  const canonicalLabel = buildRegistryLabel(memberName, emoji);
  const labels = [canonicalLabel, memberName];

  for (const [project, entries] of Object.entries(registry ?? {})) {
    for (const label of labels) {
      const surface = entries?.[label];
      if (typeof surface === "string" && surface) {
        return {
          project,
          label,
          surface,
        };
      }
    }
  }

  return null;
}

function updateRegistryMemberSurface(registry, project, memberName, emoji, surface) {
  const next = { ...(registry ?? {}) };
  const canonicalLabel = buildRegistryLabel(memberName, emoji);

  for (const [projectId, entries] of Object.entries(next)) {
    if (!entries || typeof entries !== "object") {
      continue;
    }
    delete entries[memberName];
    delete entries[canonicalLabel];
    if (Object.keys(entries).length === 0) {
      delete next[projectId];
    }
  }

  next[project] = {
    ...(next[project] ?? {}),
    [canonicalLabel]: surface,
  };

  return next;
}

function removeRegistryMemberSurface(registry, memberName, emoji = "") {
  const next = { ...(registry ?? {}) };
  const canonicalLabel = buildRegistryLabel(memberName, emoji);

  for (const [projectId, entries] of Object.entries(next)) {
    if (!entries || typeof entries !== "object") {
      continue;
    }

    delete entries[memberName];
    delete entries[canonicalLabel];

    if (Object.keys(entries).length === 0) {
      delete next[projectId];
    }
  }

  return next;
}

function resolveWorkspaceForSurface(surface) {
  if (!/^surface:\d+$/u.test(surface)) {
    return null;
  }

  try {
    const escaped = surface.replace(/'/gu, "'\\''");
    const output = execSync(
      `cmux tree 2>&1 | awk -v target='${escaped}' '{ if (match($0, /workspace:[0-9]+/)) { current_ws = substr($0, RSTART, RLENGTH) } if (index($0, target) > 0) { print current_ws; exit } }'`,
      withCmuxEnv({ encoding: "utf8" }),
    ).trim();

    return output || null;
  } catch {
    return null;
  }
}

function resolvePaneForSurface(surface) {
  if (!/^surface:\d+$/u.test(surface)) {
    return null;
  }

  try {
    const escaped = surface.replace(/'/gu, "'\\''");
    const output = execSync(
      `cmux tree 2>&1 | grep -B5 '${escaped}' | grep -oE 'pane:[0-9]+' | tail -1`,
      withCmuxEnv({ encoding: "utf8" }),
    ).trim();

    return output || null;
  } catch {
    return null;
  }
}

function findMemberStatus(snapshot, memberName) {
  for (const project of Object.values(snapshot?.projects ?? {})) {
    for (const member of project?.members ?? []) {
      if (member?.name === memberName) {
        return member.status ?? null;
      }
    }
  }

  return null;
}

function readRespawnQueue(queuePath) {
  try {
    const parsed = JSON.parse(readFileSync(queuePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeRespawnQueue(queuePath, queue) {
  mkdirSync(dirname(queuePath), { recursive: true });
  writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
}

function appendTeamWatcherLog(logPath, message) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function resolveProjectId(project, memberConfig, memberContext) {
  if (typeof project === "string" && project.trim()) {
    return project.trim();
  }

  if (typeof memberContext?.project === "string" && memberContext.project) {
    return memberContext.project;
  }

  return memberConfig?.team === "system" ? "system" : "kuma-studio";
}

export function createTeamConfigRuntime(options = {}) {
  const {
    teamStatusStore = null,
    teamConfigStore = null,
    queuePath = DEFAULT_TEAM_RESPAWN_QUEUE_PATH,
    logPath = DEFAULT_TEAM_WATCHER_LOG_PATH,
    queuePollMs = DEFAULT_TEAM_RESPAWN_QUEUE_POLL_MS,
  } = options;
  let queue = readRespawnQueue(queuePath);
  let queueTimer = null;

  const persistQueue = () => {
    writeRespawnQueue(queuePath, queue);
  };
  const removeQueuedRespawn = (memberId) => {
    if (!memberId || !queue[memberId]) {
      return;
    }

    delete queue[memberId];
    persistQueue();
  };
  const getMemberStatus = (memberName) => findMemberStatus(teamStatusStore?.getSnapshot() ?? { projects: {} }, memberName);
  const logEvent = (message) => appendTeamWatcherLog(logPath, message);
  const performRespawn = ({ memberName, memberConfig, project, currentSurface, workspaceRoot }) => {
    const spawnArgs = [
      buildRegistryLabel(memberName, memberConfig?.emoji),
      memberConfig?.type ?? "",
      workspaceRoot,
      project,
    ];

    if (currentSurface) {
      const workspace = resolveWorkspaceForSurface(currentSurface);
      const pane = resolvePaneForSurface(currentSurface);
      if (workspace) {
        spawnArgs.push("--workspace", workspace);
      }
      if (pane) {
        spawnArgs.push("--pane", pane);
      }
    }

    const output = execFileSync(
      DEFAULT_CMUX_SPAWN_SCRIPT,
      spawnArgs,
      withCmuxEnv({
        encoding: "utf8",
        env: {
          ...process.env,
          KUMA_SKIP_AGENT_STATE_NOTIFY: "1",
        },
      }),
    ).trim();
    const nextSurface = output.match(/surface:\d+/u)?.[0] ?? output;
    if (!/^surface:\d+$/u.test(nextSurface)) {
      throw new Error(`Failed to respawn ${memberName}: ${output || "missing surface id"}`);
    }

    if (currentSurface) {
      execFileSync(DEFAULT_CMUX_KILL_SCRIPT, [currentSurface], withCmuxEnv({ encoding: "utf8" }));
    }

    const nextRegistry = updateRegistryMemberSurface(
      readSurfaceRegistry(),
      project,
      memberName,
      memberConfig?.emoji ?? "",
      nextSurface,
    );
    writeSurfaceRegistry(nextRegistry);

    return {
      project,
      surface: nextSurface,
    };
  };

  const runtime = {
    resolveMemberContext(memberName, emoji) {
      return resolveRegistryMemberContext(readSurfaceRegistry(), memberName, emoji);
    },
    removeMemberSurface({ memberName, emoji = "", currentSurface = null }) {
      const memberContext = currentSurface
        ? { surface: currentSurface, project: null }
        : runtime.resolveMemberContext(memberName, emoji);
      const nextRegistry = removeRegistryMemberSurface(readSurfaceRegistry(), memberName, emoji);
      writeSurfaceRegistry(nextRegistry);

      if (memberContext?.surface) {
        try {
          execFileSync(DEFAULT_CMUX_KILL_SCRIPT, [memberContext.surface], withCmuxEnv({ encoding: "utf8" }));
        } catch {
          // If the surface is already gone we still want the registry cleanup to stick.
        }
      }

      logEvent(`SURFACE_REMOVED: member=${memberName} surface=${memberContext?.surface ?? "none"}`);
      return {
        project: memberContext?.project ?? null,
        surface: memberContext?.surface ?? null,
        removed: true,
      };
    },
    respawnMember({ memberName, memberConfig, project, currentSurface, workspaceRoot, deferIfWorking = true }) {
      const memberContext = runtime.resolveMemberContext(memberName, memberConfig?.emoji);
      const nextProject = resolveProjectId(project, memberConfig, memberContext);
      const nextCurrentSurface = currentSurface ?? memberContext?.surface ?? null;
      const memberStatus = getMemberStatus(memberName);
      const memberId = memberConfig?.id ?? memberName;

      if (deferIfWorking && memberStatus === "working") {
        queue[memberId] = {
          memberId,
          memberName,
          project: nextProject,
          currentSurface: nextCurrentSurface,
          requestedAt: new Date().toISOString(),
          workspaceRoot,
        };
        persistQueue();
        logEvent(`RESPAWN_QUEUED: member=${memberName} surface=${nextCurrentSurface ?? "none"} status=working`);
        return {
          project: nextProject,
          surface: nextCurrentSurface,
          queued: true,
        };
      }

      const result = performRespawn({
        memberName,
        memberConfig,
        project: nextProject,
        currentSurface: nextCurrentSurface,
        workspaceRoot,
      });
      removeQueuedRespawn(memberId);
      logEvent(`RESPAWN_APPLIED: member=${memberName} old=${nextCurrentSurface ?? "none"} new=${result.surface}`);
      return {
        ...result,
        queued: false,
      };
    },
    processRespawnQueue() {
      for (const [memberId, entry] of Object.entries(queue)) {
        const latestEntry = teamConfigStore?.getMember(memberId) ?? teamConfigStore?.getMember(entry.memberName);
        if (!latestEntry) {
          removeQueuedRespawn(memberId);
          logEvent(`RESPAWN_DROPPED: member=${entry.memberName} reason=missing-member`);
          continue;
        }

        const status = getMemberStatus(latestEntry.key);
        if (status === "working") {
          continue;
        }

        try {
          const currentContext = runtime.resolveMemberContext(latestEntry.key, latestEntry.member.emoji);
          runtime.respawnMember({
            memberName: latestEntry.key,
            memberConfig: latestEntry.member,
            project: entry.project,
            currentSurface: currentContext?.surface ?? entry.currentSurface ?? null,
            workspaceRoot: entry.workspaceRoot,
            deferIfWorking: false,
          });
        } catch (error) {
          logEvent(
            `RESPAWN_ERROR: member=${latestEntry.key} details=${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
      }
    },
    close() {
      if (queueTimer != null) {
        clearInterval(queueTimer);
      }
    },
  };

  if (queuePollMs > 0) {
    queueTimer = setInterval(() => {
      runtime.processRespawnQueue();
    }, queuePollMs);
    queueTimer.unref?.();
  }

  return runtime;
}

/**
 * @param {object} options
 * @param {string} options.staticDir
 * @param {import("./stats-store.mjs").StatsStore} options.statsStore
 * @param {import("../scene-store.mjs").SceneStore} options.sceneStore
 * @param {import("./team-status-store.mjs").TeamStatusStore} [options.teamStatusStore]
 * @param {import("./content-store.mjs").ContentStore} [options.contentStore]
 * @param {import("./trend-store.mjs").TrendStore} [options.trendStore]
 * @param {import("./experiment-store.mjs").ExperimentStore} [options.experimentStore]
 * @param {ReturnType<import("./experiment-pipeline.mjs").createExperimentPipeline>} [options.experimentPipeline]
 * @param {import("./memo-store.mjs").MemoStore} [options.memoStore]
 * @param {import("./team-config-store.mjs").TeamConfigStore} [options.teamConfigStore]
 * @param {import("./studio-ws-events.mjs").StudioWsEvents} [options.studioWsEvents]
 * @param {(options?: { vaultDir?: string }) => Promise<object>} [options.vaultSkillSyncFn]
 * @param {{ resolveMemberContext?: (memberName: string, emoji?: string) => { project?: string, label?: string, surface?: string } | null, respawnMember?: (input: { memberName: string, memberConfig: object, project: string, currentSurface?: string | null, workspaceRoot: string }) => { project: string, surface: string } | Promise<{ project: string, surface: string }> }} [options.teamConfigRuntime]
 * @param {string} [options.workspaceRoot]
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

      try {
        const respawned = await configRuntime.respawnMember({
          memberName,
          memberConfig: updatedEntry.member,
          project,
          currentSurface: memberContext?.surface ?? null,
          workspaceRoot: workspaceRoot ?? resolve(join(staticDir, "..", "..", "..")),
        });

        const payload = {
          member: memberName,
          config: updatedEntry.member,
          project: respawned.project,
          surface: respawned.surface ?? memberContext?.surface ?? null,
          queued: respawned.queued === true,
          forced: body?.force === true,
        };
        studioWsEvents?.broadcastTeamConfigChanged(payload);
        sendJson(res, 200, payload);
      } catch (error) {
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
    // Nightmode flag
    // ------------------------------------------------------------------

    const NIGHTMODE_FLAG = "/tmp/kuma-nightmode.flag";

    if (url.pathname === "/studio/nightmode" && req.method === "GET") {
      const enabled = existsSync(NIGHTMODE_FLAG);
      sendJson(res, 200, { enabled });
      return true;
    }

    if (url.pathname === "/studio/nightmode" && req.method === "POST") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body." });
        return true;
      }
      const enabled = body?.enabled === true;
      try {
        if (enabled) {
          writeFileSync(NIGHTMODE_FLAG, new Date().toISOString(), "utf-8");
        } else if (existsSync(NIGHTMODE_FLAG)) {
          const { unlinkSync } = await import("node:fs");
          unlinkSync(NIGHTMODE_FLAG);
        }
      } catch {
        // ignore flag write errors
      }
      if (studioWsEvents) {
        studioWsEvents.broadcastNightMode(enabled);
      }
      sendJson(res, 200, { enabled });
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
