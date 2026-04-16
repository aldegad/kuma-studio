import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import {
  commandBrowserListTabs,
  commandBrowserScreenshot,
  commandBrowserScreenshotDiff,
  commandBrowserStudioSnapshot,
  commandBrowserType,
  commandBrowserWaitFor,
  commandGetBrowserSession,
} from "./browser-cli.mjs";
import { commandRun } from "./playwright-runner.mjs";
import { parseFlags, readNumber, readOptionalString, requireString } from "./cli-options.mjs";
import { DEFAULT_PORT } from "./constants.mjs";
export { createServer } from "./server.mjs";
import { createServer } from "./server.mjs";
import { BrowserExtensionStatusStore } from "./browser-extension-status-store.mjs";
import { DevSelectionStore } from "./dev-selection-store.mjs";
import { normalizeViewport } from "./scene-schema.mjs";
import { SceneStore } from "./scene-store.mjs";
import { ingestGenericSource, ingestInbox, ingestResultFile, ingestResultFileWithGuards, resolveResultPathForTaskId } from "./studio/vault-ingest.mjs";
import { formatVaultLintReport, lintVaultFiles } from "./studio/vault-lint.mjs";
import { resolveVaultDir } from "./studio/memo-store.mjs";
import { formatVaultGetText, formatVaultSearchText, getVaultDocuments, searchVault } from "./studio/vault-search.mjs";
import { resolveAgentIdByDescriptor } from "./team-metadata.mjs";
import { computeProjectHash, resolveKumaPickerStateDir, resolveProjectStateDir } from "./state-home.mjs";
import { DEFAULT_DISPATCH_TASK_DIR, DEFAULT_VAULT_INGEST_STAMP_DIR } from "./kuma-paths.mjs";

const DEFAULT_DAEMON_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

function printUsage() {
  process.stdout.write(`kuma-studio

Usage:
  kuma-studio serve [--host 127.0.0.1] [--port ${DEFAULT_PORT}] [--root .]
  kuma-studio get-scene [--root .]
  kuma-studio get-selection [--session-id session-01] [--recent 5 | --all] [--root .]
  kuma-studio get-job-card [--session-id session-01] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio team-status [--project kuma-studio] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio get-extension-status [--root .]
  kuma-studio get-browser-session [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio browser-list-tabs [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio browser-screenshot [--file /tmp/kuma-studio-screenshot.png] [--hide-overlay] [--tab-id 123 | --tab-index 1 | --url-contains "example.com"] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio browser-studio-snapshot [--file /tmp/kuma-studio-snapshot.png] [--hide-overlay] (--tab-id 123 | --tab-index 1 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio browser-screenshot-diff --before /tmp/previous.png [--file /tmp/current.png] [--diff-file /tmp/diff.png] [--hide-overlay] (--tab-id 123 | --tab-index 1 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio browser-wait-for --selector "#submit" [--state visible] (--tab-id 123 | --tab-index 1 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio browser-type --selector "#search" --text "hello" [--fill] (--tab-id 123 | --tab-index 1 | --url "https://example.com/page" | --url-contains "example.com") [--delay-ms 50] [--timeout-ms 15000] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio run [script.js] (--tab-id 123 | --tab-index 1 | --url "https://example.com/page" | --url-contains "example.com") [--timeout-ms 15000] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio set-job-status --status in_progress --message "Write a short progress note" [--session-id session-01] [--author codex] [--tab-id 123 | --url "https://example.com/page" | --url-contains "example.com"] [--selector "#submit"] [--selector-path "main > button:nth-of-type(1)"] [--rect-json '{"x":10,"y":20,"width":120,"height":48}'] [--daemon-url ${DEFAULT_DAEMON_URL}] [--root .]
  kuma-studio set-agent-status --status working|idle --from-stdin [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio dispatch-register --task-file ${DEFAULT_DISPATCH_TASK_DIR}/task.task.md [--summary "Implement fix"] [--worker-id saemi] [--worker-name 새미] [--worker-type codex] [--qa-member 밤토리] [--qa-surface surface:7] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio dispatch-status --task-file ${DEFAULT_DISPATCH_TASK_DIR}/task.task.md [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio dispatch-message --task-file ${DEFAULT_DISPATCH_TASK_DIR}/task.task.md --kind question --text "Need clarification" [--from worker] [--to initiator] [--from-surface surface:4] [--to-surface surface:1] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio dispatch-complete --task-file ${DEFAULT_DISPATCH_TASK_DIR}/task.task.md [--summary "Implemented"] [--note "handoff complete"] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio dispatch-fail --task-file ${DEFAULT_DISPATCH_TASK_DIR}/task.task.md --blocker "reason" [--summary "Failed"] [--note "details"] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio dispatch-qa-pass --task-file ${DEFAULT_DISPATCH_TASK_DIR}/task.task.md [--note "QA PASS"] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio dispatch-qa-reject --task-file ${DEFAULT_DISPATCH_TASK_DIR}/task.task.md --blocker "reason" [--note "details"] [--daemon-url ${DEFAULT_DAEMON_URL}]
  kuma-studio put-scene --file ./scene.json [--root .]
  kuma-studio add-node --id node-01 --item-id draft-01 --title "Draft 01" --viewport original --x 0 --y 0 --z-index 1 [--root .]
  kuma-studio move-node --id node-01 --x 120 --y 80 [--root .]
  kuma-studio remove-node --id node-01 [--root .]
  kuma-studio vault-ingest [result-file|raw/<name>|https://url|inline text] [--full-auto|--bypass] [--signal task-done] [--stamp-dir ${DEFAULT_VAULT_INGEST_STAMP_DIR}] --qa-status passed [--section projects|domains|learnings] [--slug custom-slug] [--page projects/kuma-studio.md] [--title "Custom Title"] [--project kuma-studio] [--task-dir ${DEFAULT_DISPATCH_TASK_DIR}] [--vault-dir ~/.kuma/vault] [--dry-run]
  kuma-studio vault-ingest result <task-id> [--full-auto|--bypass] [--signal task-done] [--stamp-dir ${DEFAULT_VAULT_INGEST_STAMP_DIR}] [--qa-status passed] [--task-dir ${DEFAULT_DISPATCH_TASK_DIR}] [--vault-dir ~/.kuma/vault]
  kuma-studio vault-ingest [--full-auto|--bypass]                         # ingest ~/.kuma/vault/inbox/* text files
  kuma-studio vault-lint [current-focus.md ...] [--mode fast|full] [--vault-dir ~/.kuma/vault] [--schema-path ~/.kuma/vault/schema.md] [--files current-focus.md,dispatch-log.md] [--json]
  kuma-studio vault-search --query "task id" [--mode search|timeline] [--limit 20] [--vault-dir ~/.kuma/vault] [--format text|json]
  kuma-studio vault-get <id|path ...> [--vault-dir ~/.kuma/vault] [--format text|json]
  kuma-studio project-info [--root .]            # show current project hash and state dir
  kuma-studio list-projects                      # list all known project state directories
  kuma-studio dashboard                          # open http://localhost:${DEFAULT_PORT}/studio
`);
}

function resolveSelectionSessionId(root, options) {
  const explicitSessionId = readOptionalString(options, "session-id");
  if (explicitSessionId) {
    return explicitSessionId;
  }

  const selectionStore = new DevSelectionStore(root);
  return selectionStore.readAll()?.latestSessionId ?? null;
}

function readDaemonUrlOption(options) {
  return readOptionalString(options, "daemon-url") ?? DEFAULT_DAEMON_URL;
}

function buildJobCardTargetFromOptions(options) {
  const tabId = readNumber(options, "tab-id", null);
  const url = readOptionalString(options, "url");
  const urlContains = readOptionalString(options, "url-contains");

  if (!Number.isInteger(tabId) && !url && !urlContains) {
    return null;
  }

  return {
    tabId: Number.isInteger(tabId) ? tabId : null,
    url: url ?? null,
    urlContains: urlContains ?? null,
  };
}

function buildJobCardAnchorFromOptions(options) {
  const selector = readOptionalString(options, "selector");
  const selectorPath = readOptionalString(options, "selector-path");
  const rectJson = readOptionalString(options, "rect-json");
  let rect = null;

  if (rectJson) {
    try {
      rect = JSON.parse(rectJson);
    } catch {
      throw new Error("--rect-json must be valid JSON.");
    }
  }

  if (!selector && !selectorPath && !rect) {
    return null;
  }

  return {
    selector: selector ?? null,
    selectorPath: selectorPath ?? null,
    rect,
  };
}

async function readJobCardFromDaemon(daemonUrl, sessionId = null) {
  const search = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const response = await fetch(`${daemonUrl}/job-card${search}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error((await response.text()) || `Failed to read job cards from ${daemonUrl}.`);
  }

  return response.json();
}

async function readTeamStatusFromDaemon(daemonUrl, projectId = "") {
  const search = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  const response = await fetch(`${daemonUrl}/studio/team-status${search}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `Failed to read team status from ${daemonUrl}.`);
  }

  return response.json();
}

async function writeJobCardToDaemon(daemonUrl, payload) {
  const response = await fetch(`${daemonUrl}/job-card`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `Failed to write the job card to ${daemonUrl}.`);
  }

  return response.json();
}

async function writeAgentStateToDaemon(daemonUrl, payload) {
  const response = await fetch(`${daemonUrl}/studio/agent-state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `Failed to update the agent state via ${daemonUrl}.`);
  }

  return response.json();
}

async function postDispatchJson(daemonUrl, path, payload, fallbackMessage) {
  const response = await fetch(`${daemonUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload ?? {}),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(raw || fallbackMessage);
  }

  return response.json();
}

async function getDispatchJson(daemonUrl, path, fallbackMessage) {
  const response = await fetch(`${daemonUrl}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(raw || fallbackMessage);
  }

  return response.json();
}

function parseTaskFileFrontmatter(contents) {
  const lines = String(contents ?? "").replace(/\r/gu, "").split("\n");
  if (lines[0] !== "---") {
    throw new Error("task file is missing YAML frontmatter.");
  }

  const frontmatter = {};
  let index = 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---") {
      index += 1;
      break;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    frontmatter[key] = value === "null" ? "" : value;
  }

  const body = lines.slice(index).join("\n");
  const instruction = body.trim();
  const summaryLine = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) ?? "";

  return {
    taskId: typeof frontmatter.id === "string" ? frontmatter.id.trim() : "",
    project: typeof frontmatter.project === "string" ? frontmatter.project.trim() : "",
    initiator: typeof frontmatter.initiator === "string" ? frontmatter.initiator.trim() : "",
    worker: typeof frontmatter.worker === "string" ? frontmatter.worker.trim() : "",
    qa: typeof frontmatter.qa === "string" ? frontmatter.qa.trim() : "",
    resultFile: typeof frontmatter.result === "string" ? frontmatter.result.trim() : "",
    signal: typeof frontmatter.signal === "string" ? frontmatter.signal.trim() : "",
    instruction,
    summary: summaryLine.replace(/\s+/gu, " ").slice(0, 200),
  };
}

function readDispatchTaskMetadata(options) {
  const taskFile = resolve(requireString(options, "task-file"));
  const parsed = parseTaskFileFrontmatter(readFileSync(taskFile, "utf8"));
  if (!parsed.taskId) {
    throw new Error("task file is missing id frontmatter.");
  }
  return {
    ...parsed,
    taskFile,
  };
}

function dispatchTaskIdFromOptions(options) {
  const explicitTaskId = readOptionalString(options, "task-id");
  if (explicitTaskId) {
    return explicitTaskId;
  }
  return readDispatchTaskMetadata(options).taskId;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];

    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    process.stdin.on("error", reject);
  });
}

function resolveAgentIdFromDescriptor(payload) {
  const agentId = resolveAgentIdByDescriptor({
    description: payload?.description,
    subagentType: payload?.subagent_type,
    model: payload?.model,
  });

  if (!agentId) {
    throw new Error("Could not map the stdin payload to a team member.");
  }

  return agentId;
}

async function commandServe(options) {
  const host = typeof options.host === "string" ? options.host : "127.0.0.1";
  const port = readNumber(options, "port", DEFAULT_PORT);
  const root = typeof options.root === "string" ? options.root : ".";
  const { server, store } = await createServer({ host, port, root });

  server.listen(port, host, () => {
    process.stdout.write(`kuma-studio listening on http://${host}:${port}\n`);
    process.stdout.write(`scene path: ${store.scenePath}\n`);
  });

  const shutdown = () => {
    process.stdout.write("\nstopping kuma-studio\n");
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function commandGetScene(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const store = new SceneStore(root);
  process.stdout.write(`${JSON.stringify(store.read(), null, 2)}\n`);
}

function readPositiveIntegerOption(options, key) {
  const value = readNumber(options, key, null);
  if (value == null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${key} must be a positive integer.`);
  }

  return value;
}

function sliceRecentSelections(collection, count) {
  if (!collection || !Array.isArray(collection.sessions)) {
    return null;
  }

  const sessions = collection.sessions.slice(-count);
  const latestSessionId = sessions[sessions.length - 1]?.session?.id ?? null;

  return {
    ...collection,
    updatedAt: sessions[sessions.length - 1]?.capturedAt ?? collection.updatedAt,
    latestSessionId,
    sessions,
  };
}

function commandGetSelection(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const selectionStore = new DevSelectionStore(root);
  const sessionId = readOptionalString(options, "session-id");
  const recentCount = readPositiveIntegerOption(options, "recent");
  let selection = null;

  if (sessionId) {
    selection = selectionStore.readSession(sessionId);
  } else if (options.all === true) {
    selection = selectionStore.readAll();
  } else if (recentCount) {
    selection = sliceRecentSelections(selectionStore.readAll(), recentCount);
  } else {
    selection = selectionStore.read();
  }

  process.stdout.write(`${JSON.stringify(selection ?? null, null, 2)}\n`);
}

async function commandGetJobCard(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const sessionId = resolveSelectionSessionId(root, options);
  const daemonUrl = readDaemonUrlOption(options);
  process.stdout.write(`${JSON.stringify(await readJobCardFromDaemon(daemonUrl, sessionId), null, 2)}\n`);
}

async function commandTeamStatus(options) {
  const daemonUrl = readDaemonUrlOption(options);
  const projectId = readOptionalString(options, "project") ?? "";
  process.stdout.write(`${JSON.stringify(await readTeamStatusFromDaemon(daemonUrl, projectId), null, 2)}\n`);
}

function commandGetExtensionStatus(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const extensionStatusStore = new BrowserExtensionStatusStore(root);
  process.stdout.write(`${JSON.stringify(extensionStatusStore.readSummary(), null, 2)}\n`);
}

async function commandSetJobStatus(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const daemonUrl = readDaemonUrlOption(options);
  const sessionId = resolveSelectionSessionId(root, options);
  const resultMessage = requireString(options, "message");
  const payload = {
    sessionId,
    status: requireString(options, "status"),
    message: resultMessage,
    resultMessage,
    author: readOptionalString(options, "author") ?? "codex",
    target: buildJobCardTargetFromOptions(options),
    anchor: buildJobCardAnchorFromOptions(options),
  };

  process.stdout.write(`${JSON.stringify(await writeJobCardToDaemon(daemonUrl, payload), null, 2)}\n`);
}

async function commandSetAgentStatus(options) {
  const daemonUrl = readDaemonUrlOption(options);
  const status = requireString(options, "status");

  if (!["working", "idle"].includes(status)) {
    throw new Error("--status must be either working or idle.");
  }

  if (options["from-stdin"] !== true) {
    throw new Error("set-agent-status currently requires --from-stdin.");
  }

  const raw = String(await readStdin()).trim();
  if (!raw) {
    throw new Error("Expected JSON on stdin.");
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("stdin must be valid JSON.");
  }

  const agentId = resolveAgentIdFromDescriptor(payload);
  const task = status === "working" ? readOptionalString(payload, "description") : null;
  const response = await writeAgentStateToDaemon(daemonUrl, { agentId, status, task });
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

async function commandDispatchRegister(options) {
  const daemonUrl = readDaemonUrlOption(options);
  const task = readDispatchTaskMetadata(options);
  const payload = {
    taskId: task.taskId,
    taskFile: task.taskFile,
    project: task.project,
    initiator: task.initiator,
    initiatorLabel: readOptionalString(options, "initiator-label") ?? "",
    worker: readOptionalString(options, "worker-surface") ?? task.worker,
    workerId: readOptionalString(options, "worker-id") ?? "",
    workerName: readOptionalString(options, "worker-name") ?? "",
    workerType: readOptionalString(options, "worker-type") ?? "",
    qa: task.qa,
    qaMember: readOptionalString(options, "qa-member") ?? "",
    qaSurface: readOptionalString(options, "qa-surface") ?? "",
    resultFile: task.resultFile,
    signal: task.signal,
    instruction: readOptionalString(options, "instruction") ?? task.instruction,
    summary: readOptionalString(options, "summary") ?? task.summary,
  };
  process.stdout.write(`${JSON.stringify(await postDispatchJson(
    daemonUrl,
    "/studio/dispatches",
    payload,
    `Failed to register dispatch via ${daemonUrl}.`,
  ), null, 2)}\n`);
}

async function commandDispatchStatus(options) {
  const daemonUrl = readDaemonUrlOption(options);
  const taskId = dispatchTaskIdFromOptions(options);
  process.stdout.write(`${JSON.stringify(await getDispatchJson(
    daemonUrl,
    `/studio/dispatches/${encodeURIComponent(taskId)}`,
    `Failed to read dispatch ${taskId} via ${daemonUrl}.`,
  ), null, 2)}\n`);
}

async function commandDispatchMessage(options) {
  const daemonUrl = readDaemonUrlOption(options);
  const task = readDispatchTaskMetadata(options);
  const text = readOptionalString(options, "text") ?? options._.join(" ").trim();
  if (!text) {
    throw new Error("dispatch-message requires --text.");
  }

  const payload = {
    kind: readOptionalString(options, "kind") ?? "note",
    text,
    bodySource: readOptionalString(options, "body-source") ?? "",
    from: readOptionalString(options, "from") ?? "",
    to: readOptionalString(options, "to") ?? "",
    fromLabel: readOptionalString(options, "from-label") ?? "",
    toLabel: readOptionalString(options, "to-label") ?? "",
    fromSurface: readOptionalString(options, "from-surface") ?? "",
    toSurface: readOptionalString(options, "to-surface") ?? "",
    source: readOptionalString(options, "source") ?? "kuma-dispatch",
  };

  process.stdout.write(`${JSON.stringify(await postDispatchJson(
    daemonUrl,
    `/studio/dispatches/${encodeURIComponent(task.taskId)}/messages`,
    payload,
    `Failed to append a dispatch message for ${task.taskId} via ${daemonUrl}.`,
  ), null, 2)}\n`);
}

async function commandDispatchEvent(options, type) {
  const daemonUrl = readDaemonUrlOption(options);
  const task = readDispatchTaskMetadata(options);
  const payload = {
    type,
    summary: readOptionalString(options, "summary") ?? "",
    blocker: readOptionalString(options, "blocker") ?? "",
    note: readOptionalString(options, "note") ?? "",
    source: readOptionalString(options, "source") ?? "kuma-dispatch",
    resultFile: readOptionalString(options, "result-file") ?? task.resultFile,
  };

  if (type === "fail" && !payload.blocker) {
    throw new Error("dispatch-fail requires --blocker.");
  }
  if (type === "qa-reject" && !payload.blocker) {
    throw new Error("dispatch-qa-reject requires --blocker.");
  }

  process.stdout.write(`${JSON.stringify(await postDispatchJson(
    daemonUrl,
    `/studio/dispatches/${encodeURIComponent(task.taskId)}/events`,
    payload,
    `Failed to report ${type} for ${task.taskId} via ${daemonUrl}.`,
  ), null, 2)}\n`);
}

function commandPutScene(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const file = resolve(requireString(options, "file"));
  const store = new SceneStore(root);
  const payload = JSON.parse(readFileSync(file, "utf8"));
  process.stdout.write(`${JSON.stringify(store.write(payload), null, 2)}\n`);
}

function commandAddNode(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const store = new SceneStore(root);
  process.stdout.write(
    `${JSON.stringify(
      store.addNode({
        id: requireString(options, "id"),
        itemId: requireString(options, "item-id"),
        title: requireString(options, "title"),
        viewport: normalizeViewport(requireString(options, "viewport")),
        x: readNumber(options, "x", 0),
        y: readNumber(options, "y", 0),
        zIndex: readNumber(options, "z-index", 1),
      }),
      null,
      2,
    )}\n`,
  );
}

function commandMoveNode(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const store = new SceneStore(root);
  process.stdout.write(
    `${JSON.stringify(
      store.updateNode(requireString(options, "id"), {
        x: readNumber(options, "x", 0),
        y: readNumber(options, "y", 0),
      }),
      null,
      2,
    )}\n`,
  );
}

function commandRemoveNode(options) {
  const root = typeof options.root === "string" ? options.root : ".";
  const store = new SceneStore(root);
  process.stdout.write(`${JSON.stringify(store.removeNode(requireString(options, "id")), null, 2)}\n`);
}

function commandProjectInfo(options) {
  const root = typeof options.root === "string" ? resolve(options.root) : resolve(".");
  const hash = computeProjectHash(root);
  const stateDir = resolveProjectStateDir(root);
  const scenePath = resolve(stateDir, "scene.json");
  const hasScene = existsSync(scenePath);

  process.stdout.write(
    JSON.stringify(
      {
        projectRoot: root,
        projectHash: hash,
        stateDir,
        hasScene,
      },
      null,
      2,
    ) + "\n",
  );
}

function commandListProjects() {
  const stateHome = resolveKumaPickerStateDir();
  const projectsDir = resolve(stateHome, "projects");
  const results = [];

  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = resolve(projectsDir, entry.name);
      const metaPath = resolve(dir, "project.json");
      const scenePath = resolve(dir, "scene.json");
      let meta = null;
      try {
        meta = JSON.parse(readFileSync(metaPath, "utf8"));
      } catch {
        // No project metadata yet.
      }
      results.push({
        hash: entry.name,
        stateDir: dir,
        hasScene: existsSync(scenePath),
        projectRoot: meta?.projectRoot ?? null,
      });
    }
  }

  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
}

function resolveVaultIngestMode(options) {
  const bypass = options.bypass === true;
  const fullAuto = options["full-auto"] === true || (!bypass && options["full-auto"] !== false);

  if (bypass && options["full-auto"] === true) {
    throw new Error("vault-ingest cannot use --bypass and --full-auto together.");
  }

  return bypass ? "bypass" : "full-auto";
}

function formatRoutingSummary(preview, sourceLabel = "") {
  const routing = preview?.routing ?? {};
  const candidates = Array.isArray(routing.candidates) ? routing.candidates.slice(0, 3) : [];
  const lines = [
    sourceLabel ? `Source: ${sourceLabel}` : null,
    `Suggested: ${routing.suggestedPath ?? preview?.relativePagePath ?? "(unknown)"}`,
    `Confidence: ${routing.confidence ?? "unknown"}${routing.reason ? ` (${routing.reason})` : ""}`,
  ].filter(Boolean);

  if (candidates.length > 0) {
    lines.push("Candidates:");
    for (const candidate of candidates) {
      lines.push(`- ${candidate.relativePath} (score ${candidate.score})`);
    }
  }

  return lines.join("\n");
}

function collectVaultIngestLintFiles(response, files = new Set()) {
  if (!response || typeof response !== "object") {
    return files;
  }

  if (Array.isArray(response.processed)) {
    for (const entry of response.processed) {
      collectVaultIngestLintFiles(entry, files);
    }
    return files;
  }

  if (typeof response.relativePagePath === "string" && response.relativePagePath.trim()) {
    files.add(response.relativePagePath.trim());
  }

  if (
    typeof response.action === "string" &&
    ["CREATE", "INGEST", "UPDATE", "INGEST_BATCH"].includes(response.action)
  ) {
    files.add("index.md");
    files.add("log.md");
  }

  return files;
}

async function promptVaultIngestDecision(preview, sourceLabel = "") {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `vault-ingest routing is ambiguous for ${sourceLabel || preview?.sourcePath || "this source"}. ` +
      `Use --bypass to accept the best guess, or pass --section/--page/--project explicitly.`,
    );
  }

  const routing = preview?.routing ?? {};
  const candidates = Array.isArray(routing.candidates) ? routing.candidates.slice(0, 3) : [];
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    process.stdout.write(`${formatRoutingSummary(preview, sourceLabel)}\n`);
    process.stdout.write("Routing is ambiguous. Choose one:\n");
    process.stdout.write("  1) keep suggested\n");
    candidates.forEach((candidate, index) => {
      process.stdout.write(`  ${index + 2}) ${candidate.relativePath}\n`);
    });
    process.stdout.write(`  ${candidates.length + 2}) skip this source\n`);

    const answer = (await rl.question("Select [1]: ")).trim() || "1";
    const selected = Number(answer);
    if (!Number.isInteger(selected) || selected < 1 || selected > candidates.length + 2) {
      throw new Error("Invalid routing choice.");
    }

    if (selected === 1) {
      return { action: "keep" };
    }
    if (selected === candidates.length + 2) {
      return { action: "skip" };
    }

    const candidate = candidates[selected - 2];
    return {
      action: "override",
      page: candidate.relativePath,
    };
  } finally {
    rl.close();
  }
}

async function commandVaultIngest(options, args = []) {
  if (options.help === true) {
    printUsage();
    return;
  }

  const positionalArgs = Array.isArray(args) ? args.filter((value) => typeof value === "string" && value.trim()) : [];
  const primaryArg = positionalArgs[0] ?? readOptionalString(options, "result-file");
  const activeVaultDir =
    readOptionalString(options, "vault-dir") ??
    readOptionalString(options, "wiki-dir") ??
    undefined;
  const taskDir = readOptionalString(options, "task-dir") ?? undefined;
  const qaStatus = readOptionalString(options, "qa-status") ?? "passed";
  const section = readOptionalString(options, "section") ?? undefined;
  const slug = readOptionalString(options, "slug") ?? undefined;
  const page = readOptionalString(options, "page") ?? undefined;
  const title = readOptionalString(options, "title") ?? undefined;
  const project = readOptionalString(options, "project") ?? undefined;
  const dryRun = options["dry-run"] === true;
  const mode = resolveVaultIngestMode(options);
  const needsInteractivePreview = mode !== "bypass" && !dryRun;
  const signal = readOptionalString(options, "signal") ?? undefined;
  const stampDir = readOptionalString(options, "stamp-dir") ?? undefined;
  const useGuardedResultIngest = Boolean(signal || stampDir);

  const maybeResolvePromptOverride = async (preview, sourceLabel) => {
    if (mode === "bypass" || dryRun || preview?.routing?.ambiguous !== true) {
      return { section, slug, page, title, project };
    }

    const decision = await promptVaultIngestDecision(preview, sourceLabel);
    if (decision.action === "skip") {
      return { skip: true };
    }
    if (decision.action === "override") {
      return {
        section,
        slug,
        page: decision.page,
        title,
        project,
      };
    }

    return { section, slug, page, title, project };
  };

  if (!primaryArg) {
    const response = await ingestInbox({
      vaultDir: activeVaultDir,
      taskDir,
      section,
      qaStatus,
      dryRun,
      routeResolver:
        !needsInteractivePreview
          ? null
          : async ({ entryName, preview }) => {
            if (preview?.routing?.ambiguous !== true) {
              return null;
            }
            const decision = await promptVaultIngestDecision(preview, entryName);
            if (decision.action === "skip") {
              return { skip: true };
            }
            if (decision.action === "override") {
              return { page: decision.page };
            }
            return null;
          },
    });
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }

  let response;
  if (primaryArg === "result") {
    const taskId = positionalArgs[1];
    if (!taskId) {
      throw new Error("vault-ingest result requires a task id.");
    }
    const resultPath = await resolveResultPathForTaskId(taskId, {
      taskDir,
      vaultDir: activeVaultDir,
    });
    const resolved = needsInteractivePreview
      ? await (async () => {
        const preview = await ingestResultFile({
          resultPath,
          vaultDir: activeVaultDir,
          taskDir,
          qaStatus,
          section,
          slug,
          page,
          title,
          dryRun: true,
        });
        const next = await maybeResolvePromptOverride(preview, taskId);
        if (next.skip === true) {
          process.stdout.write(`${JSON.stringify({ action: "SKIP", source: taskId, routing: preview.routing }, null, 2)}\n`);
          return null;
        }
        return next;
      })()
      : { section, slug, page, title, project };
    if (!resolved) {
      return;
    }
    if (useGuardedResultIngest) {
      response = await ingestResultFileWithGuards({
        resultPath,
        signal,
        stampDir,
        vaultDir: activeVaultDir,
        taskDir,
        section: resolved.section,
        slug: resolved.slug,
        page: resolved.page,
        title: resolved.title,
        dryRun,
      });
    } else {
      response = await ingestResultFile({
        resultPath,
        vaultDir: activeVaultDir,
        taskDir,
        qaStatus,
        section: resolved.section,
        slug: resolved.slug,
        page: resolved.page,
        title: resolved.title,
        dryRun,
      });
    }
  } else if (primaryArg.startsWith("raw/")) {
    const rawPath = primaryArg.slice("raw/".length);
    if (!rawPath) {
      throw new Error("vault-ingest raw/<name> requires a raw file path.");
    }
    const resolvedRawPath = resolve(activeVaultDir ?? resolveVaultDir(), "raw", rawPath);
    const resolved = needsInteractivePreview
      ? await (async () => {
        const preview = await ingestGenericSource({
          source: resolvedRawPath,
          sourceType: "file",
          vaultDir: activeVaultDir,
          taskDir,
          qaStatus,
          section,
          slug,
          page,
          title,
          project,
          dryRun: true,
        });
        const next = await maybeResolvePromptOverride(preview, primaryArg);
        if (next.skip === true) {
          process.stdout.write(`${JSON.stringify({ action: "SKIP", source: primaryArg, routing: preview.routing }, null, 2)}\n`);
          return null;
        }
        return next;
      })()
      : { section, slug, page, title, project };
    if (!resolved) {
      return;
    }
    response = await ingestGenericSource({
      source: resolvedRawPath,
      sourceType: "file",
      vaultDir: activeVaultDir,
      taskDir,
      qaStatus,
      section: resolved.section,
      slug: resolved.slug,
      page: resolved.page,
      title: resolved.title,
      project: resolved.project,
      dryRun,
    });
  } else {
    const looksLikeResultFile =
      primaryArg.endsWith(".result.md") ||
      Boolean(readOptionalString(options, "result-file"));
    if (looksLikeResultFile) {
      const resolved = needsInteractivePreview
        ? await (async () => {
          const preview = await ingestResultFile({
            resultPath: primaryArg,
            vaultDir: activeVaultDir,
            taskDir,
            qaStatus,
            section,
            slug,
            page,
            title,
            dryRun: true,
          });
          const next = await maybeResolvePromptOverride(preview, primaryArg);
          if (next.skip === true) {
            process.stdout.write(`${JSON.stringify({ action: "SKIP", source: primaryArg, routing: preview.routing }, null, 2)}\n`);
            return null;
          }
          return next;
        })()
        : { section, slug, page, title, project };
      if (!resolved) {
        return;
      }
      if (useGuardedResultIngest) {
        response = await ingestResultFileWithGuards({
          resultPath: primaryArg,
          signal,
          stampDir,
          vaultDir: activeVaultDir,
          taskDir,
          section: resolved.section,
          slug: resolved.slug,
          page: resolved.page,
          title: resolved.title,
          dryRun,
        });
      } else {
        response = await ingestResultFile({
          resultPath: primaryArg,
          vaultDir: activeVaultDir,
          taskDir,
          qaStatus,
          section: resolved.section,
          slug: resolved.slug,
          page: resolved.page,
          title: resolved.title,
          dryRun,
        });
      }
    } else {
      const resolved = needsInteractivePreview
        ? await (async () => {
          const preview = await ingestGenericSource({
            source: primaryArg,
            vaultDir: activeVaultDir,
            taskDir,
            qaStatus,
            section,
            slug,
            page,
            title,
            project,
            dryRun: true,
          });
          const next = await maybeResolvePromptOverride(preview, primaryArg);
          if (next.skip === true) {
            process.stdout.write(`${JSON.stringify({ action: "SKIP", source: primaryArg, routing: preview.routing }, null, 2)}\n`);
            return null;
          }
          return next;
        })()
        : { section, slug, page, title, project };
      if (!resolved) {
        return;
      }
      response = await ingestGenericSource({
        source: primaryArg,
        vaultDir: activeVaultDir,
        taskDir,
        qaStatus,
        section: resolved.section,
        slug: resolved.slug,
        page: resolved.page,
        title: resolved.title,
        project: resolved.project,
        dryRun,
      });
    }
  }

  const lintFiles = dryRun ? [] : [...collectVaultIngestLintFiles(response)];
  if (lintFiles.length > 0) {
    const lint = lintVaultFiles({
      vaultDir: response?.vaultDir ?? activeVaultDir,
      mode: "fast",
      files: lintFiles,
    });
    response = {
      ...response,
      lint,
    };
    if (!lint.ok) {
      process.exitCode = 1;
    }
  }

  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

async function commandVaultSearch(options) {
  if (options.help === true) {
    printUsage();
    return;
  }

  const query = readOptionalString(options, "query") ?? options._.join(" ").trim();
  if (!query) {
    throw new Error("vault-search requires a query.");
  }

  const mode = readOptionalString(options, "mode") ?? "search";
  const limit = readNumber(options, "limit", 20);
  const result = await searchVault({
    query,
    mode,
    limit,
    vaultDir: readOptionalString(options, "vault-dir") ?? undefined,
  });

  const format = readOptionalString(options, "format") ?? "text";
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (format !== "text") {
    throw new Error(`Unsupported vault-search format: ${format}`);
  }

  process.stdout.write(formatVaultSearchText(result));
}

async function commandVaultGet(options) {
  if (options.help === true) {
    printUsage();
    return;
  }

  const ids = Array.isArray(options._)
    ? options._.filter((value) => typeof value === "string" && value.trim())
    : [];
  if (ids.length === 0) {
    throw new Error("vault-get requires at least one id or path.");
  }

  const result = await getVaultDocuments({
    ids,
    vaultDir: readOptionalString(options, "vault-dir") ?? undefined,
  });

  const format = readOptionalString(options, "format") ?? "text";
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (format !== "text") {
    throw new Error(`Unsupported vault-get format: ${format}`);
  }

  process.stdout.write(formatVaultGetText(result));
}

function commandVaultLint(options) {
  if (options.help === true) {
    printUsage();
    return;
  }

  const mode = readOptionalString(options, "mode") ?? "full";
  if (mode !== "fast" && mode !== "full") {
    throw new Error("--mode must be either fast or full.");
  }

  const positionalFiles = Array.isArray(options._)
    ? options._.filter((value) => typeof value === "string" && value.trim())
    : [];
  const filesOption = readOptionalString(options, "files");
  const requestedFiles = positionalFiles.length > 0 ? positionalFiles : filesOption ?? undefined;

  const result = lintVaultFiles({
    vaultDir:
      readOptionalString(options, "vault-dir") ??
      readOptionalString(options, "wiki-dir") ??
      undefined,
    schemaPath: readOptionalString(options, "schema-path") ?? undefined,
    mode,
    files: requestedFiles,
  });

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatVaultLintReport(result));
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const options = parseFlags(rest);
  switch (command) {
    case "serve":
      await commandServe(options);
      return;
    case "get-scene":
      commandGetScene(options);
      return;
    case "get-selection":
      commandGetSelection(options);
      return;
    case "get-job-card":
      await commandGetJobCard(options);
      return;
    case "team-status":
      await commandTeamStatus(options);
      return;
    case "get-extension-status":
      commandGetExtensionStatus(options);
      return;
    case "get-browser-session":
      await commandGetBrowserSession(options);
      return;
    case "browser-list-tabs":
      await commandBrowserListTabs(options);
      return;
    case "browser-screenshot":
      await commandBrowserScreenshot(options);
      return;
    case "browser-studio-snapshot":
      await commandBrowserStudioSnapshot(options);
      return;
    case "browser-screenshot-diff":
      await commandBrowserScreenshotDiff(options);
      return;
    case "browser-wait-for":
      await commandBrowserWaitFor(options);
      return;
    case "browser-type":
      await commandBrowserType(options);
      return;
    case "run":
      await commandRun(options, fileArg);
      return;
    case "set-job-status":
      await commandSetJobStatus(options);
      return;
    case "set-agent-status":
      await commandSetAgentStatus(options);
      return;
    case "dispatch-register":
      await commandDispatchRegister(options);
      return;
    case "dispatch-status":
      await commandDispatchStatus(options);
      return;
    case "dispatch-message":
      await commandDispatchMessage(options);
      return;
    case "dispatch-complete":
      await commandDispatchEvent(options, "complete");
      return;
    case "dispatch-fail":
      await commandDispatchEvent(options, "fail");
      return;
    case "dispatch-qa-pass":
      await commandDispatchEvent(options, "qa-pass");
      return;
    case "dispatch-qa-reject":
      await commandDispatchEvent(options, "qa-reject");
      return;
    case "put-scene":
      commandPutScene(options);
      return;
    case "add-node":
      commandAddNode(options);
      return;
    case "move-node":
      commandMoveNode(options);
      return;
    case "remove-node":
      commandRemoveNode(options);
      return;
    case "vault-ingest":
      await commandVaultIngest(options, options._);
      return;
    case "vault-lint":
      commandVaultLint(options);
      return;
    case "vault-search":
      await commandVaultSearch(options);
      return;
    case "vault-get":
      await commandVaultGet(options);
      return;
    case "project-info":
      commandProjectInfo(options);
      return;
    case "list-projects":
      commandListProjects();
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
