import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFile as execFileCallback, spawn } from "node:child_process";
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
  const waitLog = join(root, "wait.log");
  const waitCountPath = join(root, "wait-count.txt");

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
            { id: "tookdaki", name: "뚝딱이", emoji: "🦫", spawnType: "codex", team: "dev" },
            { id: "saemi", name: "새미", emoji: "🦅", spawnType: "codex", team: "dev" },
            { id: "koon", name: "쿤", emoji: "🦝", spawnType: "claude", team: "dev" },
            { id: "bamdori", name: "밤토리", emoji: "🦔", spawnType: "claude", team: "dev" },
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
    join(cmuxDir, "kuma-cmux-wait.sh"),
    `#!/bin/bash
set -euo pipefail
signal="$1"
result_file="\${2:-}"
count=0
if [ -f "${waitCountPath}" ]; then
  count="$(cat "${waitCountPath}")"
fi
count=$((count + 1))
printf '%s' "$count" > "${waitCountPath}"
printf '%q ' "$@" >> "${waitLog}"
printf '\\n' >> "${waitLog}"
timeout_count="\${WAIT_TIMEOUT_COUNT:-0}"
case "\${WAIT_BEHAVIOR:-ok}" in
  timeout)
    echo "SIGNAL_TIMEOUT: $signal (timeout=test)" >&2
    exit 1
    ;;
  *)
    if [ "$count" -le "$timeout_count" ]; then
      echo "SIGNAL_TIMEOUT: $signal (timeout=test count=$count)" >&2
      exit 1
    fi
    if [ -n "\${WAIT_WRITE_RESULT_CONTENT:-}" ] && [ -n "$result_file" ]; then
      mkdir -p "$(dirname "$result_file")"
      printf '%b' "$WAIT_WRITE_RESULT_CONTENT" > "$result_file"
    fi
    echo "SIGNAL_RECEIVED: $signal"
    ;;
esac
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
    waitLog,
    waitCountPath,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${binDir}:${process.env.PATH}`,
      KUMA_SURFACES_PATH: surfacesPath,
      KUMA_PROJECTS_PATH: projectsPath,
      KUMA_TASK_DIR: taskDir,
      KUMA_RESULT_DIR: resultDir,
      KUMA_INITIATOR_SURFACE: "surface:99",
    },
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

async function runScript(scriptPath, args, env, cwd) {
  return execFile("bash", [scriptPath, ...args], { env, cwd });
}

async function waitForTaskResultPath(taskDir, resultDir) {
  for (let index = 0; index < 100; index += 1) {
    const entries = (await readdir(taskDir)).filter((entry) => entry.endsWith(".task.md"));
    if (entries.length > 0) {
      const taskEntry = entries[0];
      return join(resultDir, basename(taskEntry).replace(/\.task\.md$/u, ".result.md"));
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error("task file was not created in time");
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

  it("kuma-task no-qa prompt uses file-based signal emission", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio", "--no-qa"], sandbox.env);

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("/tmp/kuma-signals/");
    expect(cmuxLog).not.toMatch(/wait-for\\ -S/u);
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
    expect(cmuxLog).toContain("/tmp/kuma-signals/");
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

  it("kuma-task prepends vault domain hints when instruction keywords match the vault index", async () => {
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
    expect(cmuxLog).toContain("Read ~/.kuma/vault/domains/security.md");
    expect(cmuxLog).toContain("Read ~/.kuma/vault/domains/image-generation.md");
    expect(cmuxLog).toMatch(/Read ~\/\.kuma\/vault\/domains\/security\.md[\s\S]*Read ~\/\.kuma\/vault\/domains\/image-generation\.md/u);
  });

  it("kuma-task always prepends member vaultDomains even without keyword matches", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await setMemberVaultDomains(sandbox, "tookdaki", ["analytics"]);
    const vaultDomainsDir = join(sandbox.env.HOME, ".kuma", "vault", "domains");
    await mkdir(vaultDomainsDir, { recursive: true });
    await writeFile(join(vaultDomainsDir, "analytics.md"), "# analytics\n", "utf8");

    await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio"], sandbox.env);

    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(cmuxLog).toContain("Read ~/.kuma/vault/domains/analytics.md");
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

  it("kuma-task forwards --wait-timeout to kuma-cmux-wait.sh", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio", "--wait", "--wait-timeout", "60"], sandbox.env);

    const waitLog = await readFile(sandbox.waitLog, "utf8");
    expect(waitLog).toContain("kuma-studio-tookdaki");
    expect(waitLog).toContain("--timeout 60");
    expect(waitLog).toContain("--surface surface:4");
  });

  it("kuma-task keeps --timeout as a backward-compatible wait-timeout alias", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio", "--wait", "--timeout", "45"], sandbox.env);

    const waitLog = await readFile(sandbox.waitLog, "utf8");
    expect(waitLog).toContain("--timeout 45");
  });

  it("kuma-task uses a 600 second default wait timeout", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await runScript(KUMA_TASK_PATH, ["뚝딱이", "echo test", "--project", "kuma-studio", "--wait"], sandbox.env);

    const waitLog = await readFile(sandbox.waitLog, "utf8");
    expect(waitLog).toContain("--timeout 600");
  });

  it("kuma-task extends wait timeout when the worker surface is still working", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(join(sandbox.outputDir, "surface_4.txt"), "Investigating stubborn bug\n", "utf8");

    const { stdout, stderr } = await runScript(
      KUMA_TASK_PATH,
      ["뚝딱이", "echo test", "--project", "kuma-studio", "--wait", "--timeout", "1", "--trust-worker"],
      {
        ...sandbox.env,
        WAIT_TIMEOUT_COUNT: "1",
        WAIT_WRITE_RESULT_CONTENT: "# result\\nextended wait ok\\n",
        KUMA_WAIT_TIMEOUT_EXTEND_BY: "2",
        KUMA_WAIT_TIMEOUT_MAX_TOTAL: "5",
      },
    );

    const waitLog = await readFile(sandbox.waitLog, "utf8");
    expect(waitLog).toContain("--timeout 1");
    expect(waitLog).toContain("--timeout 2");
    expect(stderr).toContain("WAIT_TIMEOUT_DIAG: surface=surface:4 status=working preview=Investigating stubborn bug");
    expect(stderr).toContain("TIMEOUT_EXTEND: mode=wait surface=surface:4 status=working add=2s total_timeout=3s extension=1/3");
    const resultPath = stdout.match(/RESULT_FILE: (.+)/)?.[1];
    expect(resultPath).toBeTruthy();
    expect(await readFile(resultPath, "utf8")).toBe("# result\nextended wait ok\n");
  });

  it("kuma-task wait mode ingests the completed result file into vault/results", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await runScript(
      KUMA_TASK_PATH,
      ["뚝딱이", "echo test", "--project", "kuma-studio", "--wait", "--trust-worker"],
      {
        ...sandbox.env,
        WAIT_WRITE_RESULT_CONTENT: "# result\\nwait ok\\n",
      },
    );

    const resultPath = stdout.match(/RESULT_FILE: (.+)/)?.[1];
    expect(resultPath).toBeTruthy();

    const vaultResultPath = join(sandbox.vaultResultsDir, basename(resultPath));
    expect(await readFile(vaultResultPath, "utf8")).toBe("# result\nwait ok\n");
    expect(stdout).toContain(`VAULT_RESULT_FILE: ${vaultResultPath}`);
  });

  it("kuma-task poll mode finishes when the result file appears", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    const child = spawn("bash", [
      KUMA_TASK_PATH,
      "뚝딱이",
      "echo test",
      "--project",
      "kuma-studio",
      "--wait",
      "--poll",
      "--timeout",
      "10",
      "--trust-worker",
    ], {
      env: sandbox.env,
      cwd: sandbox.projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    const resultPath = await waitForTaskResultPath(sandbox.taskDir, sandbox.resultDir);
    await writeFile(resultPath, "# result\npoll ok\n", "utf8");

    const exitCode = await new Promise((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("close", resolvePromise);
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain(`RESULT_FILE: ${resultPath}`);
    expect(stdout).toContain("poll ok");

    const vaultResultPath = join(sandbox.vaultResultsDir, basename(resultPath));
    expect(await readFile(vaultResultPath, "utf8")).toBe("# result\npoll ok\n");
    expect(stdout).toContain(`VAULT_RESULT_FILE: ${vaultResultPath}`);
  });

  it("kuma-task poll mode extends timeout while the worker surface is still working", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(join(sandbox.outputDir, "surface_4.txt"), "Investigating stubborn bug\n", "utf8");

    const child = spawn("bash", [
      KUMA_TASK_PATH,
      "뚝딱이",
      "echo test",
      "--project",
      "kuma-studio",
      "--wait",
      "--poll",
      "--timeout",
      "1",
      "--trust-worker",
    ], {
      env: {
        ...sandbox.env,
        KUMA_WAIT_POLL_INTERVAL: "1",
        KUMA_WAIT_TIMEOUT_EXTEND_BY: "2",
        KUMA_WAIT_TIMEOUT_MAX_TOTAL: "5",
      },
      cwd: sandbox.projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    const resultPath = await waitForTaskResultPath(sandbox.taskDir, sandbox.resultDir);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
    await writeFile(resultPath, "# result\npoll extend ok\n", "utf8");

    const exitCode = await new Promise((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("close", resolvePromise);
    });

    expect(exitCode).toBe(0);
    expect(stderr).toContain("RESULT_POLL_TIMEOUT:");
    expect(stderr).toContain("WAIT_TIMEOUT_DIAG: surface=surface:4 status=working preview=Investigating stubborn bug");
    expect(stderr).toContain("TIMEOUT_EXTEND: mode=poll surface=surface:4 status=working add=2s total_timeout=3s extension=1/3");
    expect(stdout).toContain("poll extend ok");
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

  it("kuma-task exits with diagnostics when wait times out on an idle surface", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(
      join(sandbox.outputDir, "surface_4.txt"),
      [
        "───────────────────────────",
        "❯",
        "───────────────────────────",
      ].join("\n"),
      "utf8",
    );

    let failure;
    try {
      await runScript(
        KUMA_TASK_PATH,
        ["뚝딱이", "echo test", "--project", "kuma-studio", "--wait", "--timeout", "60", "--no-qa"],
        {
          ...sandbox.env,
          WAIT_BEHAVIOR: "timeout",
        },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(failure.code).toBe(2);
    expect(`${failure.stdout}${failure.stderr}`).toContain("SIGNAL_TIMEOUT:");
    expect(`${failure.stdout}${failure.stderr}`).toContain("WAIT_TIMEOUT_DIAG: surface=surface:4 status=idle");
    expect(`${failure.stdout}${failure.stderr}`).not.toContain("TIMEOUT_EXTEND:");
  }, 30000);

  it("kuma-task stops extending after the adaptive wait timeout limit is exhausted", async () => {
    const sandbox = await setupCliSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(join(sandbox.outputDir, "surface_4.txt"), "Investigating stubborn bug\n", "utf8");

    let failure;
    try {
      await runScript(
        KUMA_TASK_PATH,
        ["뚝딱이", "echo test", "--project", "kuma-studio", "--wait", "--timeout", "1", "--no-qa"],
        {
          ...sandbox.env,
          WAIT_BEHAVIOR: "timeout",
          KUMA_WAIT_TIMEOUT_EXTEND_BY: "1",
          KUMA_WAIT_TIMEOUT_MAX_EXTENSIONS: "2",
          KUMA_WAIT_TIMEOUT_MAX_TOTAL: "3",
        },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(failure.code).toBe(2);
    expect(`${failure.stdout}${failure.stderr}`).toContain("TIMEOUT_EXTEND: mode=wait surface=surface:4 status=working add=1s total_timeout=2s extension=1/2");
    expect(`${failure.stdout}${failure.stderr}`).toContain("TIMEOUT_EXTEND: mode=wait surface=surface:4 status=working add=1s total_timeout=3s extension=2/2");
    expect(`${failure.stdout}${failure.stderr}`).toContain("WAIT_TIMEOUT_DIAG: surface=surface:4 status=working preview=Investigating stubborn bug");
  }, 15000);
});
