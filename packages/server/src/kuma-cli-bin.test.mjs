import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

const KUMA_TASK_PATH = resolve(process.cwd(), "scripts/bin/kuma-task");
const KUMA_READ_PATH = resolve(process.cwd(), "scripts/bin/kuma-read");
const KUMA_STATUS_PATH = resolve(process.cwd(), "scripts/bin/kuma-status");
const KUMA_SPAWN_PATH = resolve(process.cwd(), "scripts/bin/kuma-spawn");
const KUMA_KILL_PATH = resolve(process.cwd(), "scripts/bin/kuma-kill");
const KUMA_PROJECT_INIT_PATH = resolve(process.cwd(), "scripts/bin/kuma-project-init");
const KUMA_RESULT_INGEST_PATH = resolve(process.cwd(), "scripts/bin/kuma-result-ingest");
const KUMA_DISPATCH_PATH = resolve(process.cwd(), "scripts/bin/kuma-dispatch");

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function setupCliSandbox() {
  const root = await mkdtemp(join(tmpdir(), "kuma-cli-bin-"));
  const home = join(root, "home");
  const kumaDir = join(home, ".kuma");
  const cmuxDir = join(kumaDir, "cmux");
  const vaultResultsDir = join(kumaDir, "vault", "results");
  const binDir = join(root, "bin");
  const taskDir = join(root, "tasks");
  const resultDir = join(root, "results");
  const outputDir = join(root, "read-output");
  const workspaceDir = join(root, "workspace");
  const projectRoot = join(workspaceDir, "kuma-studio");
  const surfacesPath = join(root, "surfaces.json");
  const projectsPath = join(kumaDir, "projects.json");
  const teamPath = join(kumaDir, "team.json");
  const cmuxLog = join(root, "cmux.log");
  const spawnLog = join(root, "spawn.log");
  const killLog = join(root, "kill.log");
  const projectInitLog = join(root, "project-init.log");
  const dispatchLog = join(root, "dispatch.log");
  const dispatchStatePath = join(root, "dispatch-state.json");
  const serverCliPath = join(root, "kuma-server-cli.mjs");

  await mkdir(cmuxDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(taskDir, { recursive: true });
  await mkdir(resultDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(projectRoot, { recursive: true });

  await writeFile(
    teamPath,
    `${JSON.stringify({
      teams: {
        system: {
          name: "시스템",
          members: [
            { id: "kuma", name: "쿠마", emoji: "🐻", spawnType: "claude", team: "system", nodeType: "session" },
            { id: "noeuri", name: "노을이", emoji: "🦌", spawnType: "codex", team: "system" },
            { id: "jjooni", name: "쭈니", emoji: "🐝", spawnType: "codex", team: "system" },
          ],
        },
        dev: {
          name: "개발팀",
          members: [
            { id: "howl", name: "하울", emoji: "🐺", spawnType: "claude", team: "dev", nodeType: "team" },
            { id: "tookdaki", name: "뚝딱이", emoji: "🦫", spawnType: "codex", team: "dev", roleLabel: { en: "Engineer. Implementation and fix delivery" }, skills: ["dev-team"] },
            { id: "saemi", name: "새미", emoji: "🦅", spawnType: "codex", team: "dev" },
            { id: "koon", name: "쿤", emoji: "🦝", spawnType: "claude", team: "dev", roleLabel: { en: "Publisher / Designer. HTML/CSS/Graphics" }, skills: ["frontend-design"] },
            { id: "bamdori", name: "밤토리", emoji: "🦔", spawnType: "claude", team: "dev", roleLabel: { en: "QA. Build, deploy, screen verification. No code edits" }, skills: ["kuma-picker"] },
          ],
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await writeFile(
    projectsPath,
    `${JSON.stringify({
      "kuma-studio": projectRoot,
    }, null, 2)}\n`,
    "utf8",
  );

  await writeFile(
    surfacesPath,
    `${JSON.stringify({
      system: {
        "🐻 쿠마": "surface:1",
        "🐝 쭈니": "surface:2",
      },
      "kuma-studio": {
        "🐺 하울": "surface:3",
        "🦫 뚝딱이": "surface:4",
        "🦅 새미": "surface:5",
        "🦝 쿤": "surface:16",
        "🦔 밤토리": "surface:7",
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await writeExecutable(
    join(binDir, "cmux"),
    `#!/bin/bash
set -euo pipefail
command="\${1:-}"
printf '%s|' "$command" >> "${cmuxLog}"
shift || true
printf '%q ' "$@" >> "${cmuxLog}"
printf '\\n' >> "${cmuxLog}"
if [ "$command" = "wait-for" ]; then
  echo "OK"
fi
`,
  );

  await writeExecutable(
    join(cmuxDir, "kuma-cmux-read.sh"),
    `#!/bin/bash
set -euo pipefail
surface="$1"
cat "${outputDir}/$(printf '%s' "$surface" | tr ':' '_').txt"
`,
  );

  await writeExecutable(
    join(cmuxDir, "kuma-cmux-send.sh"),
    `#!/bin/bash
set -euo pipefail
printf 'send-wrapper|' >> "${cmuxLog}"
printf '%q ' "$@" >> "${cmuxLog}"
printf '\\n' >> "${cmuxLog}"
`,
  );

  await writeFile(
    serverCliPath,
    `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function parseFlags(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (next != null && !next.startsWith("--")) {
        options[key] = next;
        index += 1;
      } else {
        options[key] = true;
      }
      continue;
    }
    options._.push(value);
  }
  return options;
}

function parseTaskFile(taskFile) {
  const contents = readFileSync(taskFile, "utf8");
  const lines = contents.replace(/\\r/g, "").split("\\n");
  const frontmatter = {};
  let index = 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---") {
      index += 1;
      break;
    }
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const body = lines.slice(index).join("\\n");
  const summary = body.split(/\\r?\\n/u).map((line) => line.trim()).find((line) => line && !line.startsWith("#")) || "";
  return {
    taskId: frontmatter.id || "",
    taskFile,
    project: frontmatter.project || "",
    initiator: frontmatter.initiator || "",
    worker: frontmatter.worker || "",
    qa: frontmatter.qa || "",
    resultFile: frontmatter.result || "",
    signal: frontmatter.signal || "",
    instruction: body.trim(),
    summary,
  };
}

function readState() {
  if (!existsSync(process.env.KUMA_DISPATCH_STATE_PATH)) {
    return { dispatches: {} };
  }
  return JSON.parse(readFileSync(process.env.KUMA_DISPATCH_STATE_PATH, "utf8"));
}

function writeState(state) {
  mkdirSync(dirname(process.env.KUMA_DISPATCH_STATE_PATH), { recursive: true });
  writeFileSync(process.env.KUMA_DISPATCH_STATE_PATH, JSON.stringify(state, null, 2) + "\\n", "utf8");
}

function appendLog(message) {
  writeFileSync(process.env.KUMA_DISPATCH_LOG_PATH, message + "\\n", { encoding: "utf8", flag: "a" });
}

function classifyOutput(output) {
  const text = String(output || "").replace(/\\r/g, "");
  const lines = text.split("\\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { state: "idle", lastOutputLines: [], task: null };
  }

  const meaningful = lines.filter((line) => !/^[-─]{3,}$/u.test(line) && !/bypass permissions/iu.test(line) && !/now using extra usage/iu.test(line));
  const hasPrompt = meaningful.some((line) => /^(?:❯|>|›)\s*$/.test(line));
  const idleHint = meaningful.some((line) => /^new task\\?/iu.test(line) || /^gpt-[\\w.-]+/iu.test(line));
  const working = meaningful.some((line) =>
    /^Investigating\\b/u.test(line) ||
    /^Working on\\b/u.test(line) ||
    /^•\\s*Working\\b/u.test(line) ||
    /^⏺\\s*(?:Bash|Read|Edit)\\(/u.test(line),
  );
  const filteredLines = meaningful.filter((line) => !/^(?:❯|>|›)\s*$/.test(line));
  const preview = filteredLines[0] || null;

  if (working && !hasPrompt) {
    return { state: "working", lastOutputLines: preview ? [preview] : [], task: preview };
  }

  if (idleHint || hasPrompt) {
    return { state: "idle", lastOutputLines: [], task: null };
  }

  if (working) {
    return { state: "working", lastOutputLines: preview ? [preview] : [], task: preview };
  }

  return { state: "idle", lastOutputLines: preview ? [preview] : [], task: preview };
}

function buildTeamStatus(projectFilter = "") {
  const registry = JSON.parse(readFileSync(process.env.KUMA_SURFACES_PATH, "utf8"));
  const team = JSON.parse(readFileSync(process.env.HOME + "/.kuma/team.json", "utf8"));
  const allMembers = Object.values(team.teams || {}).flatMap((entry) => Array.isArray(entry?.members) ? entry.members : []);
  const projects = [];

  const candidateProjectIds = projectFilter ? [projectFilter] : Object.keys(registry || {});
  for (const projectId of candidateProjectIds) {
    if (projectFilter && projectId !== projectFilter) continue;
    const members = [];
    for (const member of allMembers) {
      const assignedProjectId = member?.team === "system" ? "system" : "kuma-studio";
      if (assignedProjectId !== projectId) continue;
      const label = String((member.emoji || "") + " " + (member.name || member.id || "")).trim();
      const surface = registry?.[projectId]?.[label] || null;
      let state = "offline";
      let lastOutputLines = [];
      let task = null;
      if (surface) {
        const outputPath = process.env.KUMA_STUB_OUTPUT_DIR + "/" + String(surface).replace(/:/g, "_") + ".txt";
        const output = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
        const classified = classifyOutput(output);
        state = classified.state;
        lastOutputLines = classified.lastOutputLines;
        task = classified.task;
      }
      members.push({
        id: member.id,
        surface,
        state,
        lastOutputLines,
        task,
        modelInfo: null,
        updatedAt: "2026-04-11T00:00:00.000Z",
      });
    }
    projects.push({ projectId, projectName: projectId, members });
  }

  return { projects };
}

const [command, ...rest] = process.argv.slice(2);
const options = parseFlags(rest);

switch (command) {
  case "dispatch-register": {
    const task = parseTaskFile(options["task-file"]);
    const state = readState();
    state.dispatches[task.taskId] = {
      ...task,
      initiatorLabel: options["initiator-label"] || "",
      workerId: options["worker-id"] || "",
      workerName: options["worker-name"] || "",
      workerType: options["worker-type"] || "",
      qaMember: options["qa-member"] || "",
      qaSurface: options["qa-surface"] || "",
      status: "dispatched",
      messages: task.instruction ? [{
        id: task.taskId + ":message:0001",
        kind: "instruction",
        text: task.instruction,
        bodySource: "forwarded-summary",
        from: "initiator",
        to: "worker",
        fromLabel: options["initiator-label"] || "",
        toLabel: options["worker-name"] || "",
        fromSurface: task.initiator || "",
        toSurface: task.worker || "",
        source: "kuma-task",
      }] : [],
    };
    writeState(state);
    appendLog(\`dispatch-register|\${task.taskId}|\${task.qa}|\${options["qa-member"] || ""}\`);
    process.stdout.write(JSON.stringify({ dispatch: state.dispatches[task.taskId] }, null, 2) + "\\n");
    break;
  }
  case "dispatch-message": {
    const task = parseTaskFile(options["task-file"]);
    const state = readState();
    const current = state.dispatches[task.taskId] || { ...task, status: "dispatched", messages: [] };
    const messages = Array.isArray(current.messages) ? current.messages.slice() : [];
    const message = {
      id: task.taskId + ":message:" + String(messages.length + 1).padStart(4, "0"),
      kind: options.kind || "note",
      text: options.text || "",
      bodySource: options["body-source"] || "direct-message",
      from: options.from || "",
      to: options.to || "",
      fromLabel: options["from-label"] || "",
      toLabel: options["to-label"] || "",
      fromSurface: options["from-surface"] || "",
      toSurface: options["to-surface"] || "",
      source: options.source || "kuma-dispatch",
    };
    messages.push(message);
    state.dispatches[task.taskId] = {
      ...current,
      ...task,
      messages,
      lastEvent: "message:" + message.kind,
    };
    writeState(state);
    appendLog(\`dispatch-message|\${task.taskId}|\${message.kind}|\${message.from}|\${message.to}|\${message.text}\`);
    process.stdout.write(JSON.stringify({ dispatch: state.dispatches[task.taskId] }, null, 2) + "\\n");
    break;
  }
  case "dispatch-complete":
  case "dispatch-fail":
  case "dispatch-qa-pass":
  case "dispatch-qa-reject": {
    const task = parseTaskFile(options["task-file"]);
    const state = readState();
    const current = state.dispatches[task.taskId] || { ...task, status: "dispatched" };
    let status = current.status;
    if (command === "dispatch-complete") {
      status = current.qa === "worker-self-report" || current.qa === "kuma-direct" ? "qa-passed" : "worker-done";
    } else if (command === "dispatch-fail") {
      status = "failed";
    } else if (command === "dispatch-qa-pass") {
      status = "qa-passed";
    } else if (command === "dispatch-qa-reject") {
      status = "qa-rejected";
    }
    state.dispatches[task.taskId] = {
      ...current,
      ...task,
      status,
      blocker: options.blocker || "",
      note: options.note || "",
    };
    writeState(state);
    appendLog(\`\${command}|\${task.taskId}|\${status}|\${options.blocker || ""}\`);
    process.stdout.write(JSON.stringify({ dispatch: state.dispatches[task.taskId] }, null, 2) + "\\n");
    break;
  }
  case "dispatch-status": {
    const task = parseTaskFile(options["task-file"]);
    const state = readState();
    process.stdout.write(JSON.stringify({ dispatch: state.dispatches[task.taskId] || null }, null, 2) + "\\n");
    break;
  }
  case "team-status": {
    process.stdout.write(JSON.stringify(buildTeamStatus(options.project || ""), null, 2) + "\\n");
    break;
  }
  default:
    process.stderr.write(\`Unsupported stub CLI command: \${command}\\n\`);
    process.exitCode = 1;
}
`,
    "utf8",
  );

  await writeExecutable(
    join(cmuxDir, "kuma-cmux-spawn.sh"),
    `#!/bin/bash
set -euo pipefail
printf '%q ' "$@" > "${spawnLog}"
printf '\\n' >> "${spawnLog}"
echo "\${KUMA_STUB_SPAWN_SURFACE:-surface:55}"
`,
  );

  await writeExecutable(
    join(cmuxDir, "kuma-cmux-kill.sh"),
    `#!/bin/bash
set -euo pipefail
printf '%q ' "$@" > "${killLog}"
printf '\\n' >> "${killLog}"
`,
  );

  await writeExecutable(
    join(cmuxDir, "kuma-cmux-project-init.sh"),
    `#!/bin/bash
set -euo pipefail
printf '%q ' "$@" > "${projectInitLog}"
printf '\\n' >> "${projectInitLog}"
node --input-type=module - "$KUMA_SURFACES_PATH" "$1" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [, , registryPath, project] = process.argv;
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
registry[project] = {
  "🐺 하울": "surface:31",
  "🦫 뚝딱이": "surface:32",
  "🦝 쿤": "surface:33",
  "🦅 새미": "surface:34",
  "🦔 밤토리": "surface:35"
};
writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\\n", "utf8");
NODE
echo "전팀 준비 완료. (워크스페이스: workspace:9)"
`,
  );

  return {
    root,
    projectRoot,
    resultDir,
    vaultResultsDir,
    taskDir,
    teamPath,
    outputDir,
    surfacesPath,
    projectsPath,
    cmuxLog,
    spawnLog,
    killLog,
    projectInitLog,
    dispatchLog,
    dispatchStatePath,
    serverCliPath,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${binDir}:${process.env.PATH}`,
      KUMA_SURFACES_PATH: surfacesPath,
      KUMA_PROJECTS_PATH: projectsPath,
      KUMA_TASK_DIR: taskDir,
      KUMA_RESULT_DIR: resultDir,
      KUMA_STUB_OUTPUT_DIR: outputDir,
      KUMA_INITIATOR_SURFACE: "surface:99",
      KUMA_SERVER_CLI: serverCliPath,
      KUMA_DISPATCH_STATE_PATH: dispatchStatePath,
      KUMA_DISPATCH_LOG_PATH: dispatchLog,
      KUMA_AUTO_VAULT_INGEST: "0",
      KUMA_AUTO_NOEURI_TRIGGER: "0",
    },
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function addSurfaceLabel(sandbox, projectId, label, surface) {
  const registry = await readJson(sandbox.surfacesPath);
  registry[projectId] = {
    ...(registry[projectId] ?? {}),
    [label]: surface,
  };
  await writeJson(sandbox.surfacesPath, registry);
}

async function setMemberDefaultQa(sandbox, memberId, defaultQa) {
  const team = await readJson(sandbox.teamPath);
  const member = team?.teams?.dev?.members?.find((entry) => entry.id === memberId);
  if (!member) {
    throw new Error(`member not found in sandbox team.json: ${memberId}`);
  }

  member.defaultQa = defaultQa;
  await writeJson(sandbox.teamPath, team);
}

async function setMemberVaultDomains(sandbox, memberId, vaultDomains) {
  const team = await readJson(sandbox.teamPath);
  const member = team?.teams?.dev?.members?.find((entry) => entry.id === memberId);
  if (!member) {
    throw new Error(`member not found in sandbox team.json: ${memberId}`);
  }

  member.vaultDomains = vaultDomains;
  await writeJson(sandbox.teamPath, team);
}

async function createDecisionRuntimeModules(root, logPath) {
  const studioDir = join(root, "packages", "server", "src", "studio");
  await mkdir(studioDir, { recursive: true });
  await writeFile(
    join(studioDir, "decision-detector.mjs"),
    `export function detectDecision({ text }) {
  if (typeof text !== "string" || !text.includes("먼저")) {
    return null;
  }

  return {
    matched: true,
    action: "priority",
    original_text: text.trim(),
  };
}
`,
    "utf8",
  );
  await writeFile(
    join(studioDir, "decisions-store.mjs"),
    `import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function appendDecision({ vaultDir, entry }) {
  mkdirSync(dirname(process.env.KUMA_STUB_DECISION_LOG), { recursive: true });
  appendFileSync(
    process.env.KUMA_STUB_DECISION_LOG,
    JSON.stringify({ kind: "append", vaultDir, entry }) + "\\n",
    "utf8",
  );
  return { ok: true };
}

export async function promoteToLedger(input) {
  mkdirSync(dirname(process.env.KUMA_STUB_DECISION_LOG), { recursive: true });
  appendFileSync(
    process.env.KUMA_STUB_DECISION_LOG,
    JSON.stringify({ kind: "promote", ...input }) + "\\n",
    "utf8",
  );
  return { inboxId: input.inboxId, ledgerId: "ledger-1" };
}
`,
    "utf8",
  );
  return { root, logPath };
}

async function runScript(scriptPath, args, env, cwd) {
  return execFile("bash", [scriptPath, ...args], { env, cwd });
}

describe("kuma CLI bin scripts", { timeout: 30_000 }, () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("kuma-task delegates worker prompts through kuma-cmux-send.sh and writes a task file", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    const taskFile = await readFile(taskFilePath, "utf8");
    expect(taskFile).toContain("worker: surface:4");
    expect(taskFile).toContain("qa: surface:7");
    expect(taskFile).toContain("echo test");

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send-wrapper|surface:4");
    expect(cmuxLog).not.toContain("send|--surface surface:4");
    expect(cmuxLog).not.toContain("send-key|--surface surface:4 Enter");
  });

  it("kuma-task routes Claude members through the same send wrapper", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await runScript(KUMA_TASK_PATH, ["쿤", "echo test", "--project", "kuma-studio"], sandbox.env);

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send-wrapper|surface:16");
    expect(cmuxLog).not.toContain("send|--surface surface:16");
  });

  it("kuma-task keeps dispatch prompts lean when role and skill already come from bootstrap", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await runScript(KUMA_TASK_PATH, ["쿤", "echo test", "--project", "kuma-studio"], sandbox.env);
    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(dispatchState.dispatches[taskId].messages[0]).toMatchObject({
      fromLabel: "",
      toLabel: "쿤",
    });
    expect(cmuxLog).toContain("echo test");
    expect(cmuxLog).toContain("[Kuma Studio Dispatch]");
    expect(cmuxLog).toContain("Speaker:");
    expect(cmuxLog).toContain("Speaker: initiator (surface:99)");
    expect(cmuxLog).toContain("Recipient:");
    expect(cmuxLog).not.toContain("Recipient: worker (surface:16)");
    expect(cmuxLog).toContain("Message kind: assigned task");
    expect(cmuxLog).toContain("Body source: forwarded/orchestrated summary");
    expect(cmuxLog).toContain("Tracked task file:");
    expect(cmuxLog).not.toContain("frontend-design");
    expect(cmuxLog).not.toContain("role: Publisher / Designer. HTML/CSS/Graphics");
    expect(cmuxLog).not.toContain("role and skill are context, not autonomous commands.");
  });

  it("kuma-task blocks dispatch when the worker surface is already working", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(join(sandbox.outputDir, "surface_4.txt"), "Investigating stubborn bug\n", "utf8");

    let failure;
    try {
      await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(failure.code).toBe(1);
    expect(`${failure.stderr}`).toContain("worker surface busy: surface:4");
    expect(`${failure.stderr}`).toContain("requeue or retry later");

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8").catch(() => "");
    expect(cmuxLog).not.toContain("send-wrapper|surface:4");
  });

  it("kuma-task no-qa prompt uses broker completion reporting", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio", "--no-qa"], sandbox.env);

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    const dispatchLog = await readFile(sandbox.dispatchLog, "utf8");
    expect(cmuxLog).toContain("kuma-dispatch complete --task-file");
    expect(cmuxLog).toContain("kuma-dispatch fail --task-file");
    expect(dispatchLog).toContain("dispatch-register|tookdaki-");
  });

  it("kuma-task emits a lifecycle decision capture when the detector matches", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);
    const runtimeRoot = join(sandbox.root, "decision-runtime");
    const decisionLog = join(sandbox.root, "decision-log.jsonl");
    await createDecisionRuntimeModules(runtimeRoot, decisionLog);

    await runScript(
      KUMA_TASK_PATH,
      ["뚝딱이", "이거 먼저 처리", "--project", "kuma-studio"],
      {
        ...sandbox.env,
        KUMA_DECISION_RUNTIME_ROOT: runtimeRoot,
        KUMA_STUB_DECISION_LOG: decisionLog,
      },
    );

    const entries = (await readFile(decisionLog, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "append",
      vaultDir: join(sandbox.env.HOME, ".kuma", "vault"),
      entry: {
        layer: "inbox",
        action: "priority",
        scope: "project:kuma-studio",
        writer: "lifecycle-emitter",
        original_text: "이거 먼저 처리",
      },
    });
    expect(entries[0].entry.context_ref).toContain("task:tookdaki-");
  });

  it("kuma-task keeps dispatching when the decision runtime is unavailable", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(
      KUMA_TASK_PATH,
      ["뚝딱이", "이거 먼저 처리", "--project", "kuma-studio"],
      {
        ...sandbox.env,
        KUMA_DECISION_RUNTIME_ROOT: join(sandbox.root, "missing-decision-runtime"),
      },
    );

    expect(stdout).toContain("TASK_FILE:");
    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send-wrapper|surface:4");
  });

  it("kuma-task decisions promote calls promoteToLedger directly without dispatching work", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);
    const runtimeRoot = join(sandbox.root, "decision-runtime");
    const decisionLog = join(sandbox.root, "decision-log.jsonl");
    await createDecisionRuntimeModules(runtimeRoot, decisionLog);

    const { stdout } = await runScript(
      KUMA_TASK_PATH,
      ["decisions", "promote", "inbox-7", "결정 문장", "--context", "thread:7"],
      {
        ...sandbox.env,
        KUMA_DECISION_RUNTIME_ROOT: runtimeRoot,
        KUMA_STUB_DECISION_LOG: decisionLog,
      },
    );

    expect(JSON.parse(stdout)).toEqual({ inboxId: "inbox-7", ledgerId: "ledger-1" });
    const entries = (await readFile(decisionLog, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(entries).toContainEqual({
      kind: "promote",
      vaultDir: join(sandbox.env.HOME, ".kuma", "vault"),
      inboxId: "inbox-7",
      resolvedText: "결정 문장",
      writer: "user-direct",
      contextRef: "thread:7",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8").catch(() => "");
    expect(cmuxLog).not.toContain("send-wrapper|");
    const dispatchLog = await readFile(sandbox.dispatchLog, "utf8").catch(() => "");
    expect(dispatchLog).not.toContain("dispatch-register|");
  });

  it("kuma-dispatch ask appends a thread message and sends it to the initiator surface", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);
    await addSurfaceLabel(sandbox, "kuma-studio", "Kuma", "surface:99");

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    const { stdout: askStdout } = await runScript(
      KUMA_DISPATCH_PATH,
      ["ask", "--task-file", taskFilePath, "--message", "Need API confirmation."],
      {
        ...sandbox.env,
        CMUX_SURFACE_ID: "surface:4",
        KUMA_INITIATOR_SURFACE: "surface:99",
      },
    );

    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);
    expect(dispatchState.dispatches[taskId].messages.at(-1)).toMatchObject({
      kind: "question",
      bodySource: "direct-message",
      from: "worker",
      to: "initiator",
      fromLabel: "뚝딱이",
      toLabel: "Kuma",
      text: "Need API confirmation.",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send-wrapper|surface:99");
    expect(askStdout).toContain("FROM: worker (surface:4)");
    expect(askStdout).toContain("TO: initiator (surface:99)");
    expect(cmuxLog).toContain("Speaker:");
    expect(cmuxLog).not.toContain("Speaker: worker (surface:4)");
    expect(cmuxLog).toContain("Recipient:");
    expect(cmuxLog).toContain("Recipient: Kuma (initiator, surface:99)");
    expect(cmuxLog).toContain("Message kind: question");
    expect(cmuxLog).toContain("Body source: direct thread message");
    expect(cmuxLog).toContain("Need API confirmation.");
  });

  it("kuma-dispatch complete updates broker status without sending a lifecycle thread notice", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    await runScript(
      KUMA_DISPATCH_PATH,
      ["complete", "--task-file", taskFilePath],
      {
        ...sandbox.env,
        KUMA_INITIATOR_SURFACE: "surface:4",
      },
    );

    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);
    expect(dispatchState.dispatches[taskId].status).toBe("worker-done");
    expect(dispatchState.dispatches[taskId].messages).toHaveLength(1);
    expect(dispatchState.dispatches[taskId].messages.at(-1)).toMatchObject({
      kind: "instruction",
      bodySource: "forwarded-summary",
      from: "initiator",
      to: "worker",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).not.toContain("Message kind: status update");
    expect(cmuxLog).not.toContain("Body source: dispatch lifecycle event");
    expect(cmuxLog).not.toContain("completed work. Result:");
  });

  it("kuma-dispatch qa-reject updates broker status without sending a lifecycle thread notice", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    await runScript(
      KUMA_DISPATCH_PATH,
      ["qa-reject", "--task-file", taskFilePath, "--blocker", "Selection mismatch"],
      {
        ...sandbox.env,
        KUMA_INITIATOR_SURFACE: "surface:7",
      },
    );

    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);
    expect(dispatchState.dispatches[taskId].status).toBe("qa-rejected");
    expect(dispatchState.dispatches[taskId].messages).toHaveLength(1);
    expect(dispatchState.dispatches[taskId].messages.at(-1)).toMatchObject({
      kind: "instruction",
      bodySource: "forwarded-summary",
      from: "initiator",
      to: "worker",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).not.toContain("Message kind: blocker");
    expect(cmuxLog).not.toContain("Body source: dispatch lifecycle event");
    expect(cmuxLog).not.toContain("Selection mismatch. Result:");
  });

  it("kuma-dispatch reply defaults back to the worker surface from the initiator", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);
    await addSurfaceLabel(sandbox, "kuma-studio", "Kuma", "surface:99");

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    await runScript(
      KUMA_DISPATCH_PATH,
      ["reply", "--task-file", taskFilePath, "--message", "Use the existing route handler."],
      {
        ...sandbox.env,
        CMUX_SURFACE_ID: "surface:99",
        KUMA_INITIATOR_SURFACE: "surface:99",
      },
    );

    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);
    expect(dispatchState.dispatches[taskId].messages.at(-1)).toMatchObject({
      kind: "answer",
      bodySource: "direct-message",
      from: "initiator",
      to: "worker",
      fromLabel: "Kuma",
      toLabel: "뚝딱이",
      text: "Use the existing route handler.",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send-wrapper|surface:4");
    expect(cmuxLog).toContain("Speaker:");
    expect(cmuxLog).toContain("Speaker: Kuma (initiator, surface:99)");
    expect(cmuxLog).toContain("Recipient:");
    expect(cmuxLog).not.toContain("Recipient: worker (surface:4)");
    expect(cmuxLog).toContain("Message kind: reply");
    expect(cmuxLog).toContain("Body source: direct thread message");
    expect(cmuxLog).toContain("Use the existing route handler.");
  });

  it("kuma-dispatch reply keeps initiator sender inference on the real initiator surface", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await addSurfaceLabel(sandbox, "kuma-studio", "Kuma", "surface:99");

    const { stdout } = await runScript(
      KUMA_TASK_PATH,
      ["뚝딱이", "echo test", "--project", "kuma-studio"],
      sandbox.env,
    );
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    const { stdout: replyStdout } = await runScript(
      KUMA_DISPATCH_PATH,
      ["reply", "--task-file", taskFilePath, "--message", "Keep the current plan."],
      {
        ...sandbox.env,
        CMUX_SURFACE_ID: "surface:99",
      },
    );

    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);
    expect(dispatchState.dispatches[taskId].messages.at(-1)).toMatchObject({
      kind: "answer",
      from: "initiator",
      to: "worker",
      fromLabel: "Kuma",
      fromSurface: "surface:99",
      toSurface: "surface:4",
      text: "Keep the current plan.",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send-wrapper|surface:4");
    expect(replyStdout).toContain("FROM: initiator (surface:99)");
    expect(replyStdout).toContain("TO: worker (surface:4)");
    expect(cmuxLog).toContain("Speaker: Kuma (initiator, surface:99)");
  });

  it("kuma-dispatch reply prefers the current cmux surface over an inherited initiator surface", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    const { stdout: replyStdout } = await runScript(
      KUMA_DISPATCH_PATH,
      ["reply", "--task-file", taskFilePath, "--message", "Worker side follow-up from nested shell."],
      {
        ...sandbox.env,
        CMUX_SURFACE_ID: "surface:4",
        KUMA_INITIATOR_SURFACE: "surface:99",
      },
    );

    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);
    expect(dispatchState.dispatches[taskId].messages.at(-1)).toMatchObject({
      kind: "answer",
      from: "worker",
      to: "initiator",
      fromLabel: "뚝딱이",
      fromSurface: "surface:4",
      toSurface: "surface:99",
      text: "Worker side follow-up from nested shell.",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send-wrapper|surface:99");
    expect(replyStdout).toContain("FROM: worker (surface:4)");
    expect(replyStdout).toContain("TO: initiator (surface:99)");
  });

  it("kuma-dispatch reply infers worker-to-initiator routing from the latest thread message when the current surface is opaque", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    const replyEnv = {
      ...sandbox.env,
      CMUX_SURFACE_ID: "066C9972-931B-4AF4-A6B1-08811B8D6898",
    };
    delete replyEnv.KUMA_INITIATOR_SURFACE;

    await runScript(
      KUMA_DISPATCH_PATH,
      ["reply", "--task-file", taskFilePath, "--message", "I'll handle the worker side from here."],
      replyEnv,
    );

    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);
    expect(dispatchState.dispatches[taskId].messages.at(-1)).toMatchObject({
      kind: "answer",
      from: "worker",
      to: "initiator",
      fromLabel: "뚝딱이",
      toLabel: "",
      fromSurface: "surface:4",
      toSurface: "surface:99",
      text: "I'll handle the worker side from here.",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send-wrapper|surface:99");
    expect(cmuxLog).toContain("Speaker:");
    expect(cmuxLog).not.toContain("Speaker: worker (surface:4)");
    expect(cmuxLog).toContain("Recipient:");
    expect(cmuxLog).toContain("Recipient: initiator (surface:99)");
    expect(cmuxLog).toContain("Message kind: reply");
    expect(cmuxLog).toContain("I\\'ll handle the worker side from here.");
  });

  it("kuma-dispatch reply keeps qa sender inference on the qa surface", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    const { stdout: replyStdout } = await runScript(
      KUMA_DISPATCH_PATH,
      ["reply", "--task-file", taskFilePath, "--message", "QA is verifying this now."],
      {
        ...sandbox.env,
        CMUX_SURFACE_ID: "surface:7",
        KUMA_INITIATOR_SURFACE: "surface:99",
      },
    );

    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);
    expect(dispatchState.dispatches[taskId].messages.at(-1)).toMatchObject({
      kind: "answer",
      from: "qa",
      to: "worker",
      fromLabel: "밤토리",
      fromSurface: "surface:7",
      toSurface: "surface:4",
      text: "QA is verifying this now.",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("send-wrapper|surface:4");
    expect(replyStdout).toContain("FROM: qa (surface:7)");
    expect(replyStdout).toContain("TO: worker (surface:4)");
    expect(cmuxLog).not.toContain("Speaker: QA (surface:7)");
  });

  it("kuma-dispatch prefers stored initiator labels over raw uuid-like surfaces", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const initiatorSurface = "940E93B3-2F3C-43A4-9546-A7AA2F1A2C55";
    await addSurfaceLabel(sandbox, "kuma-studio", "Kuma", initiatorSurface);

    const { stdout } = await runScript(
      KUMA_TASK_PATH,
      ["뚝딱이", "echo test", "--project", "kuma-studio"],
      {
        ...sandbox.env,
        KUMA_INITIATOR_SURFACE: initiatorSurface,
      },
    );
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];

    await runScript(
      KUMA_DISPATCH_PATH,
      ["ask", "--task-file", taskFilePath, "--message", "Need API confirmation."],
      {
        ...sandbox.env,
        CMUX_SURFACE_ID: "surface:4",
        KUMA_INITIATOR_SURFACE: "surface:4",
      },
    );

    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);
    expect(dispatchState.dispatches[taskId]).toMatchObject({
      initiator: initiatorSurface,
      initiatorLabel: "Kuma",
    });
    expect(dispatchState.dispatches[taskId].messages.at(-1)).toMatchObject({
      fromLabel: "뚝딱이",
      toLabel: "Kuma",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).not.toContain("Recipient: initiator (surface:99)");
    expect(cmuxLog).not.toContain(`Recipient: initiator (${initiatorSurface})`);
    expect(cmuxLog).toContain(`Recipient: Kuma (initiator, ${initiatorSurface})`);
  });

  it("kuma-dispatch keeps the generic initiator fallback only for truly unknown initiator surfaces", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const unknownInitiatorSurface = "B0A2CE10-3EFD-4C7A-B2C2-BF7D9B238999";
    const { stdout } = await runScript(
      KUMA_TASK_PATH,
      ["뚝딱이", "echo test", "--project", "kuma-studio"],
      {
        ...sandbox.env,
        KUMA_INITIATOR_SURFACE: unknownInitiatorSurface,
      },
    );
    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    expect(taskFilePath).toBeTruthy();

    await runScript(
      KUMA_DISPATCH_PATH,
      ["ask", "--task-file", taskFilePath, "--message", "Need API confirmation."],
      {
        ...sandbox.env,
        CMUX_SURFACE_ID: "surface:4",
        KUMA_INITIATOR_SURFACE: "surface:4",
      },
    );

    const dispatchState = await readJson(sandbox.dispatchStatePath);
    const [taskId] = Object.keys(dispatchState.dispatches);
    expect(dispatchState.dispatches[taskId].messages.at(-1)).toMatchObject({
      fromLabel: "뚝딱이",
      toLabel: "",
    });

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain(`Recipient: initiator (${unknownInitiatorSurface})`);
  });

  it("kuma-task prefers member defaultQa over the global default QA member", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await setMemberDefaultQa(sandbox, "tookdaki", "saemi");

    const { stdout } = await runScript(
      KUMA_TASK_PATH,
      ["뚝딱이", "echo test", "--project", "kuma-studio"],
      {
        ...sandbox.env,
        KUMA_DEFAULT_QA_MEMBER: "bamdori",
      },
    );

    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    const taskFile = await readFile(taskFilePath, "utf8");
    expect(taskFile).toContain("qa: surface:5");
    expect(stdout).toContain("QA: 새미 (surface:5)");
  });

  it("kuma-task treats member defaultQa=self like trust-worker mode", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await setMemberDefaultQa(sandbox, "tookdaki", "self");

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);

    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    const taskFile = await readFile(taskFilePath, "utf8");
    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(taskFile).toContain("qa: worker-self-report");
    expect(stdout).toContain("QA: worker-self-report (trusted)");
    expect(cmuxLog).toContain("trusted: worker-self-report");
  });

  it("kuma-task treats member defaultQa=kuma-direct as a direct Kuma review handoff", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await setMemberDefaultQa(sandbox, "tookdaki", "kuma-direct");

    const { stdout } = await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);

    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    const taskFile = await readFile(taskFilePath, "utf8");
    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(taskFile).toContain("qa: kuma-direct");
    expect(stdout).toContain("QA: kuma-direct (쿠마 직접 리뷰)");
    expect(cmuxLog).toContain("send-wrapper|surface:4");
    expect(cmuxLog).toContain("kuma-dispatch complete --task-file");
    expect(cmuxLog).not.toContain("worker-self-report");
  });

  it("kuma-task lets --qa override a member defaultQa", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await setMemberDefaultQa(sandbox, "tookdaki", "saemi");

    const { stdout } = await runScript(
      KUMA_TASK_PATH,
      ["뚝딱이", "echo test", "--project", "kuma-studio", "--qa", "밤토리"],
      sandbox.env,
    );

    const taskFilePath = stdout.match(/TASK_FILE: (.+)/)?.[1];
    const taskFile = await readFile(taskFilePath, "utf8");
    expect(taskFile).toContain("qa: surface:7");
    expect(stdout).toContain("QA: 밤토리 (surface:7)");
  });

  it("kuma-task does not prepend vault domain hints into the worker prompt by default", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const vaultDomainsDir = join(sandbox.env.HOME, ".kuma", "vault", "domains");
    await mkdir(vaultDomainsDir, { recursive: true });
    await writeFile(join(vaultDomainsDir, "security.md"), "# security\n", "utf8");
    await writeFile(join(vaultDomainsDir, "image-generation.md"), "# image-generation\n", "utf8");
    await writeFile(
      join(sandbox.env.HOME, ".kuma", "vault", "index.md"),
      [
        "# Kuma Vault Index",
        "",
        "## Domains",
        "- [보안 점검 도메인 운영 가이드](domains/security.md) — KISA, OWASP 중심 보안 점검 문서",
        "- [이미지 생성 도메인 운영 가이드](domains/image-generation.md) — 캐릭터, 디자인, image 작업 문서",
        "",
        "## Projects",
        "- [dummy](projects/dummy.md) — ignored",
        "",
      ].join("\n"),
      "utf8",
    );

    await runScript(KUMA_TASK_PATH, ["뚝딱이", "보안 KISA 이미지 캐릭터 작업", "--project", "kuma-studio"], sandbox.env);

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("Tracked task file:");
    expect(cmuxLog).not.toContain("Read ~/.kuma/vault/domains/security.md");
    expect(cmuxLog).not.toContain("Read ~/.kuma/vault/domains/image-generation.md");
  });

  it("kuma-task does not prepend member vaultDomains into the worker prompt by default", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await setMemberVaultDomains(sandbox, "tookdaki", ["analytics"]);
    const vaultDomainsDir = join(sandbox.env.HOME, ".kuma", "vault", "domains");
    await mkdir(vaultDomainsDir, { recursive: true });
    await writeFile(join(vaultDomainsDir, "analytics.md"), "# analytics\n", "utf8");

    await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("echo test");
    expect(cmuxLog).not.toContain("Read ~/.kuma/vault/domains/analytics.md");
  });

  it("kuma-read resolves a member by id and tails the requested number of lines", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(
      join(sandbox.outputDir, "surface_4.txt"),
      "line-1\nline-2\nline-3\nline-4\n",
      "utf8",
    );

    const { stdout } = await runScript(KUMA_READ_PATH, ["tookdaki", "--project", "kuma-studio", "--lines", "2"], sandbox.env);
    expect(stdout.trim()).toBe("line-3\nline-4");
  });

  it("kuma-status prints member statuses for the selected project", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(join(sandbox.outputDir, "surface_4.txt"), "Investigating sofa bug\n", "utf8");
    await writeFile(join(sandbox.outputDir, "surface_16.txt"), "❯\n", "utf8");
    await writeFile(join(sandbox.outputDir, "surface_7.txt"), "new task? /clear to save 12k tokens\n", "utf8");

    const { stdout } = await runScript(KUMA_STATUS_PATH, ["--project", "kuma-studio"], sandbox.env);

    expect(stdout).toContain("PROJECT\tMEMBER\tSURFACE\tSTATUS\tPREVIEW");
    expect(stdout).toContain("kuma-studio\t🦫 뚝딱이\tsurface:4\tworking\tInvestigating sofa bug");
    expect(stdout).toContain("kuma-studio\t🦝 쿤\tsurface:16\tidle");
    expect(stdout).toContain("kuma-studio\t🦔 밤토리\tsurface:7\tidle");
  });

  it("kuma-status treats bypass-permissions footers as idle instead of working", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(
      join(sandbox.outputDir, "surface_16.txt"),
      [
        "───────────────────────────",
        "❯",
        "───────────────────────────",
        "  ⏵⏵ bypass permissions on /tmp",
        "  Now using extra usage",
      ].join("\n"),
      "utf8",
    );

    const { stdout } = await runScript(KUMA_STATUS_PATH, ["--project", "kuma-studio"], sandbox.env);
    expect(stdout).toContain("kuma-studio\t🦝 쿤\tsurface:16\tidle\t");
    expect(stdout).not.toContain("kuma-studio\t🦝 쿤\tsurface:16\tworking");
    expect(stdout).not.toContain("bypass permissions");
  });

  it("kuma-spawn resolves the project from cwd and registers the spawned surface", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(KUMA_SPAWN_PATH, ["뚝딱이"], sandbox.env, sandbox.projectRoot);
    expect(stdout).toContain("PROJECT: kuma-studio");
    expect(stdout).toContain("SURFACE: surface:55");

    const spawnLog = await readFile(sandbox.spawnLog, "utf8");
    expect(spawnLog).toContain("kuma-studio");
    expect(spawnLog).toContain("surface:3");

    const killLog = await readFile(sandbox.killLog, "utf8");
    expect(killLog.trim()).toBe("surface:4");

    const registry = JSON.parse(await readFile(sandbox.surfacesPath, "utf8"));
    expect(registry["kuma-studio"]["🦫 뚝딱이"]).toBe("surface:55");
  });

  it("kuma-spawn forces system members into the system project even from a project cwd", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout, stderr } = await runScript(KUMA_SPAWN_PATH, ["노을이"], sandbox.env, sandbox.projectRoot);
    expect(stdout).toContain("PROJECT: system");
    expect(stdout).toContain("SURFACE: surface:55");
    expect(stderr).toContain("overriding project kuma-studio -> system");

    const spawnLog = await readFile(sandbox.spawnLog, "utf8");
    expect(spawnLog).toContain("system");
    expect(spawnLog).toContain("surface:1");

    const registry = JSON.parse(await readFile(sandbox.surfacesPath, "utf8"));
    expect(registry.system["🦌 노을이"]).toBe("surface:55");
  });

  it("kuma-spawn rejects explicit non-system projects for system members", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    let failure;
    try {
      await runScript(KUMA_SPAWN_PATH, ["노을이", "--project", "kuma-studio"], sandbox.env, sandbox.projectRoot);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(failure.stderr).toContain("must use project=system");
    expect(failure.stderr).toContain("refusing to spawn system member '노을이'");
  });

  it("kuma-kill removes the killed member from the registry", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(KUMA_KILL_PATH, ["뚝딱이", "--project", "kuma-studio"], sandbox.env);
    expect(stdout).toContain("SURFACE: surface:4");

    const killLog = await readFile(sandbox.killLog, "utf8");
    expect(killLog.trim()).toBe("surface:4");

    const registry = JSON.parse(await readFile(sandbox.surfacesPath, "utf8"));
    expect(registry["kuma-studio"]["🦫 뚝딱이"]).toBeUndefined();
  });

  it("kuma-project-init saves projects.json and delegates to the cmux project init wrapper", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const smokeDir = join(sandbox.root, "workspace", "smoke-test");
    const { stdout } = await runScript(KUMA_PROJECT_INIT_PATH, ["smoke", smokeDir], sandbox.env);

    expect(stdout).toContain("PROJECT: smoke");
    expect(stdout).toContain("DIR: ");

    const projectInitLog = await readFile(sandbox.projectInitLog, "utf8");
    expect(projectInitLog).toContain("smoke");

    const projects = JSON.parse(await readFile(sandbox.projectsPath, "utf8"));
    expect(projects.smoke.endsWith("/workspace/smoke-test")).toBe(true);

    const registry = JSON.parse(await readFile(sandbox.surfacesPath, "utf8"));
    expect(registry.smoke["🐺 하울"]).toBe("surface:31");
    expect(registry.smoke["🦔 밤토리"]).toBe("surface:35");
  });

  it("kuma-result-ingest copies only missing result files into vault/results", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await mkdir(sandbox.vaultResultsDir, { recursive: true });
    await writeFile(join(sandbox.resultDir, "task-a.result.md"), "# a\nnew\n", "utf8");
    await writeFile(join(sandbox.resultDir, "task-b.result.md"), "# b\ncopy me\n", "utf8");
    await writeFile(join(sandbox.vaultResultsDir, "task-a.result.md"), "# a\nkeep me\n", "utf8");

    const { stdout } = await runScript(KUMA_RESULT_INGEST_PATH, [], sandbox.env);

    expect(stdout).toContain("1건 ingest됨");
    expect(await readFile(join(sandbox.vaultResultsDir, "task-a.result.md"), "utf8")).toBe("# a\nkeep me\n");
    expect(await readFile(join(sandbox.vaultResultsDir, "task-b.result.md"), "utf8")).toBe("# b\ncopy me\n");
  });

  it("kuma-task rejects removed wait flags", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    let failure;
    try {
      await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio", "--wait"], sandbox.env);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(failure.code).toBe(1);
    expect(`${failure.stderr}`).toContain("unknown argument: --wait");
  });
});
