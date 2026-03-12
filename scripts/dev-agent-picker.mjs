import { mkdirSync, watch } from "node:fs";
import { generateAgentPickerDrafts } from "./generate-agent-picker-drafts.mjs";
import { syncAgentPickerScene } from "./sync-agent-picker-scene.mjs";
import { spawnPackageScript } from "../tools/shared/package-manager.mjs";
import { resolveHostPaths } from "../tools/shared/project-context.mjs";

const appRoot = process.cwd();
const { draftsRoot } = resolveHostPaths(appRoot);

mkdirSync(draftsRoot, { recursive: true });

generateAgentPickerDrafts(appRoot);
syncAgentPickerScene(appRoot);

let queued = false;
let timer = null;

function scheduleDraftRefresh(reason) {
  if (timer) {
    clearTimeout(timer);
  }

  timer = setTimeout(() => {
    timer = null;
    if (queued) return;
    queued = true;

    try {
      generateAgentPickerDrafts(appRoot);
      syncAgentPickerScene(appRoot);
      process.stdout.write(`[agent-picker] refreshed drafts after ${reason}\n`);
    } catch (error) {
      process.stderr.write(`[agent-picker] failed to refresh drafts: ${error}\n`);
    } finally {
      queued = false;
    }
  }, 120);
}

const watcher = watch(
  draftsRoot,
  {
    recursive: true,
  },
  (_eventType, filename) => {
    scheduleDraftRefresh(filename ? `change in ${filename}` : "draft update");
  },
);

const hostDevScript = process.env.AGENT_PICKER_HOST_DEV_SCRIPT ?? "agent-picker:host-dev";
const child = spawnPackageScript(hostDevScript, { cwd: appRoot });

if (!child) {
  process.stderr.write(`[agent-picker] missing host dev script: ${hostDevScript}\n`);
  watcher.close();
  process.exit(1);
}

function shutdown(signal) {
  watcher.close();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  if (!child.killed) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code) => {
  watcher.close();
  process.exit(code ?? 0);
});
