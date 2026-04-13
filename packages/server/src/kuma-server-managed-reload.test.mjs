import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const MANAGED_RELOAD_SCRIPT_PATH = resolve(process.cwd(), "scripts/bin/kuma-server-reload");

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function setupManagedReloadSandbox() {
  const root = await mkdtemp(join(tmpdir(), "kuma-managed-reload-"));
  const home = join(root, "home");
  const kumaDir = join(home, ".kuma");
  const cmuxDir = join(kumaDir, "cmux");
  const binDir = join(root, "bin");
  const teamPath = join(kumaDir, "team.json");
  const surfacesPath = join(root, "surfaces.json");
  const sendLog = join(root, "send.log");
  const cmuxLog = join(root, "cmux.log");
  const workspaceRoot = join(root, "workspace");
  const plansDir = join(workspaceRoot, ".kuma", "plans");

  await mkdir(cmuxDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(plansDir, { recursive: true });

  await writeFile(teamPath, '{"teams":{}}\n', "utf8");
  await writeFile(
    surfacesPath,
    `${JSON.stringify({
      system: {
        "🐻 쿠마": "surface:1",
      },
      "kuma-studio": {
        server: "surface:42",
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
case "$command" in
  tree)
    cat <<'EOF'
workspace:7
  pane:1
    surface:1 tty=ttys001
  pane:11
    surface:42 tty=ttys042
EOF
    ;;
  read-screen)
    exit 0
    ;;
  close-surface)
    exit 0
    ;;
  new-surface)
    printf 'surface:99\\n'
    ;;
  tab-action)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`,
  );

  await writeExecutable(
    join(binDir, "lsof"),
    `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == -tiTCP:* ]]; then
  if [ "\${KUMA_TEST_LSOF_MODE:-listener}" = "listener" ]; then
    printf '%s\\n' "\${KUMA_TEST_LISTENER_PID:-43210}"
  fi
  exit 0
fi

if [ "\${1:-}" = "-a" ] && [ "\${2:-}" = "-p" ] && [ "\${4:-}" = "-d" ] && [ "\${5:-}" = "cwd" ] && [ "\${6:-}" = "-Fn" ]; then
  pid="\${3:-}"
  if [ "$pid" = "\${KUMA_TEST_TTY_SHELL_PID:-7001}" ] && [ -n "\${KUMA_TEST_ANCHOR_WORKSPACE:-}" ]; then
    printf 'p%s\\nfcwd\\nn%s\\n' "$pid" "\${KUMA_TEST_ANCHOR_WORKSPACE}"
    exit 0
  fi
fi
`,
  );

  await writeExecutable(
    join(binDir, "ps"),
    `#!/bin/bash
set -euo pipefail
if [ "\${1:-}" = "-t" ]; then
  printf '7000 6999 /usr/bin/login\\n'
  printf '%s 7000 -/bin/zsh\\n' "\${KUMA_TEST_TTY_SHELL_PID:-7001}"
  printf '7002 %s /usr/local/bin/claude\\n' "\${KUMA_TEST_TTY_SHELL_PID:-7001}"
  exit 0
fi

if [ -n "\${KUMA_TEST_RUNNING_WORKSPACE:-}" ]; then
  printf 'node KUMA_STUDIO_WORKSPACE=%s /usr/local/bin/node %s/packages/server/src/cli.mjs serve --port 4312\\n' "\${KUMA_TEST_RUNNING_WORKSPACE}" "${process.cwd()}"
else
  printf 'node /usr/local/bin/node %s/packages/server/src/cli.mjs serve --port 4312\\n' "${process.cwd()}"
fi
`,
  );

  await writeExecutable(
    join(cmuxDir, "kuma-cmux-send.sh"),
    `#!/bin/bash
set -euo pipefail
printf '%q ' "$@" > "${sendLog}"
printf '\\n' >> "${sendLog}"
`,
  );

  return {
    root,
    home,
    binDir,
    teamPath,
    surfacesPath,
    sendLog,
    cmuxLog,
    workspaceRoot,
    plansDir,
  };
}

describe("kuma-server-reload", () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("reloads the managed kuma-server surface and reuses the running server workspace when invoked from the repo root", async () => {
    const sandbox = await setupManagedReloadSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await execFile("bash", [MANAGED_RELOAD_SCRIPT_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: sandbox.home,
        PATH: `${sandbox.binDir}:${process.env.PATH}`,
        KUMA_SURFACES_PATH: sandbox.surfacesPath,
        KUMA_TEAM_JSON_PATH: sandbox.teamPath,
        KUMA_CMUX_DIR: join(sandbox.home, ".kuma", "cmux"),
        INIT_CWD: process.cwd(),
        KUMA_TEST_RUNNING_WORKSPACE: sandbox.workspaceRoot,
      },
    });

    const sendLog = await readFile(sandbox.sendLog, "utf8");
    expect(stdout).toContain("SURFACE: surface:99");
    expect(stdout).toContain("REPLACED_SURFACE: surface:42");
    expect(stdout).toContain("CMUX_WORKSPACE: workspace:7");
    expect(stdout).toContain("CMUX_PANE: pane:11");
    expect(stdout).toContain(`WORKSPACE: ${await realpath(sandbox.workspaceRoot)}`);
    const cmuxLog = await readFile(sandbox.cmuxLog, "utf8");
    expect(sendLog).toContain("--workspace workspace:7");
    expect(sendLog).toContain("surface:99");
    expect(sendLog).toContain(`KUMA_STUDIO_WORKSPACE=${await realpath(sandbox.workspaceRoot)}`);
    expect(sendLog).toContain("KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=");
    expect(sendLog).toContain("vault");
    expect(sendLog).toContain("claude");
    expect(sendLog).toContain("codex");
    expect(sendLog).toContain("npm\\ run\\ server:reload");
    expect(cmuxLog).toContain("close-surface|--workspace workspace:7 --surface surface:42");
    expect(cmuxLog).toContain("new-surface|--pane pane:11 --workspace workspace:7");
    expect(cmuxLog).toContain("tab-action|--action rename --workspace workspace:7 --surface surface:99 --title kuma-server");
    expect(sendLog).not.toContain("surface:42 cd");
  });

  it("prefers the caller workspace binding over the running daemon binding", async () => {
    const sandbox = await setupManagedReloadSandbox();
    tempRoots.push(sandbox.root);

    const preferredWorkspace = join(sandbox.root, "preferred-workspace");
    await mkdir(preferredWorkspace, { recursive: true });

    await execFile("bash", [MANAGED_RELOAD_SCRIPT_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: sandbox.home,
        PATH: `${sandbox.binDir}:${process.env.PATH}`,
        KUMA_SURFACES_PATH: sandbox.surfacesPath,
        KUMA_TEAM_JSON_PATH: sandbox.teamPath,
        KUMA_CMUX_DIR: join(sandbox.home, ".kuma", "cmux"),
        INIT_CWD: preferredWorkspace,
        KUMA_TEST_RUNNING_WORKSPACE: sandbox.workspaceRoot,
      },
    });

    const sendLog = await readFile(sandbox.sendLog, "utf8");
    expect(sendLog).toContain(`KUMA_STUDIO_WORKSPACE=${await realpath(preferredWorkspace)}`);
    expect(sendLog).not.toContain(`KUMA_STUDIO_WORKSPACE=${await realpath(sandbox.workspaceRoot)}`);
    expect(sendLog).toContain("KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=");
    expect(sendLog).toContain("surface:99");
  });

  it("recovers the workspace binding from the managed Kuma orchestrator surface when the daemon env is unavailable", async () => {
    const sandbox = await setupManagedReloadSandbox();
    tempRoots.push(sandbox.root);

    const { stdout } = await execFile("bash", [MANAGED_RELOAD_SCRIPT_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: sandbox.home,
        PATH: `${sandbox.binDir}:${process.env.PATH}`,
        KUMA_SURFACES_PATH: sandbox.surfacesPath,
        KUMA_TEAM_JSON_PATH: sandbox.teamPath,
        KUMA_CMUX_DIR: join(sandbox.home, ".kuma", "cmux"),
        INIT_CWD: process.cwd(),
        KUMA_TEST_RUNNING_WORKSPACE: "",
        KUMA_TEST_ANCHOR_WORKSPACE: sandbox.workspaceRoot,
      },
    });

    const sendLog = await readFile(sandbox.sendLog, "utf8");
    expect(stdout).toContain(`WORKSPACE: ${await realpath(sandbox.workspaceRoot)}`);
    expect(sendLog).toContain(`KUMA_STUDIO_WORKSPACE=${await realpath(sandbox.workspaceRoot)}`);
    expect(sendLog).toContain("KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=");
  });

  it("recovers the workspace binding from the live kuma-server surface history when the running daemon env is stale", async () => {
    const sandbox = await setupManagedReloadSandbox();
    tempRoots.push(sandbox.root);

    await writeExecutable(
      join(sandbox.binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
printf '%s|' "$command" >> "${sandbox.cmuxLog}"
shift || true
printf '%q ' "$@" >> "${sandbox.cmuxLog}"
printf '\\n' >> "${sandbox.cmuxLog}"
case "$command" in
  tree)
    cat <<'EOF'
workspace:7
  pane:1
    surface:1 tty=ttys001
  pane:11
    surface:42 [terminal] "kuma-server" tty=ttys042
EOF
    ;;
  read-screen)
    printf 'cd "%s" && KUMA_STUDIO_WORKSPACE=%s npm run server:reload\\n' "${process.cwd()}" "${sandbox.workspaceRoot}"
    ;;
  close-surface)
    exit 0
    ;;
  new-surface)
    printf 'surface:99\\n'
    ;;
  tab-action)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`,
    );

    const { stdout } = await execFile("bash", [MANAGED_RELOAD_SCRIPT_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: sandbox.home,
        PATH: `${sandbox.binDir}:${process.env.PATH}`,
        KUMA_SURFACES_PATH: sandbox.surfacesPath,
        KUMA_TEAM_JSON_PATH: sandbox.teamPath,
        KUMA_CMUX_DIR: join(sandbox.home, ".kuma", "cmux"),
        INIT_CWD: process.cwd(),
        KUMA_TEST_RUNNING_WORKSPACE: process.cwd(),
      },
    });

    const sendLog = await readFile(sandbox.sendLog, "utf8");
    expect(stdout).toContain(`WORKSPACE: ${await realpath(sandbox.workspaceRoot)}`);
    expect(sendLog).toContain(`KUMA_STUDIO_WORKSPACE=${await realpath(sandbox.workspaceRoot)}`);
  });

  it("re-discovers and re-registers a live kuma-server title surface when the registry key is missing", async () => {
    const sandbox = await setupManagedReloadSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(
      sandbox.surfacesPath,
      `${JSON.stringify({
        system: {
          "🐻 쿠마": "surface:1",
        },
        "kuma-studio": {},
      }, null, 2)}\n`,
      "utf8",
    );

    await writeExecutable(
      join(sandbox.binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
printf '%s|' "$command" >> "${sandbox.cmuxLog}"
shift || true
printf '%q ' "$@" >> "${sandbox.cmuxLog}"
printf '\\n' >> "${sandbox.cmuxLog}"
case "$command" in
  tree)
    cat <<'EOF'
workspace:7
  pane:1
    surface:1 tty=ttys001
  pane:11
    surface:15 [terminal] "kuma-server" tty=ttys042
EOF
    ;;
  read-screen)
    exit 0
    ;;
  close-surface)
    exit 0
    ;;
  new-surface)
    printf 'surface:99\\n'
    ;;
  tab-action)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`,
    );

    const { stdout } = await execFile("bash", [MANAGED_RELOAD_SCRIPT_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: sandbox.home,
        PATH: `${sandbox.binDir}:${process.env.PATH}`,
        KUMA_SURFACES_PATH: sandbox.surfacesPath,
        KUMA_TEAM_JSON_PATH: sandbox.teamPath,
        KUMA_CMUX_DIR: join(sandbox.home, ".kuma", "cmux"),
        INIT_CWD: process.cwd(),
        KUMA_TEST_RUNNING_WORKSPACE: sandbox.workspaceRoot,
      },
    });

    const sendLog = await readFile(sandbox.sendLog, "utf8");
    const nextRegistry = JSON.parse(await readFile(sandbox.surfacesPath, "utf8"));
    expect(stdout).toContain("REPLACED_SURFACE: surface:15");
    expect(sendLog).toContain("surface:99");
    expect(nextRegistry["kuma-studio"].server).toBe("surface:99");
  });

  it("preserves an explicitly blank explorer roots env when reloading the managed surface", async () => {
    const sandbox = await setupManagedReloadSandbox();
    tempRoots.push(sandbox.root);

    await execFile("bash", [MANAGED_RELOAD_SCRIPT_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: sandbox.home,
        PATH: `${sandbox.binDir}:${process.env.PATH}`,
        KUMA_SURFACES_PATH: sandbox.surfacesPath,
        KUMA_TEAM_JSON_PATH: sandbox.teamPath,
        KUMA_CMUX_DIR: join(sandbox.home, ".kuma", "cmux"),
        INIT_CWD: process.cwd(),
        KUMA_TEST_RUNNING_WORKSPACE: sandbox.workspaceRoot,
        KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS: "",
      },
    });

    const sendLog = await readFile(sandbox.sendLog, "utf8");
    expect(sendLog).toContain("KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=\\'\\'");
  });

  it("fails clearly when the managed kuma-server surface is missing", async () => {
    const sandbox = await setupManagedReloadSandbox();
    tempRoots.push(sandbox.root);

    await writeFile(sandbox.surfacesPath, '{"kuma-studio":{}}\n', "utf8");

    let failure;
    try {
      await execFile("bash", [MANAGED_RELOAD_SCRIPT_PATH], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: sandbox.home,
          PATH: `${sandbox.binDir}:${process.env.PATH}`,
          KUMA_SURFACES_PATH: sandbox.surfacesPath,
          KUMA_TEAM_JSON_PATH: sandbox.teamPath,
          KUMA_CMUX_DIR: join(sandbox.home, ".kuma", "cmux"),
          INIT_CWD: process.cwd(),
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(failure.code).toBe(1);
    expect(`${failure.stderr}`).toContain("managed kuma-server surface not found");
  });

  it("fails clearly when it cannot resolve the managed server pane/workspace slot", async () => {
    const sandbox = await setupManagedReloadSandbox();
    tempRoots.push(sandbox.root);

    await writeExecutable(
      join(sandbox.binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  read-screen)
    exit 0
    ;;
  tree)
    cat <<'EOF'
workspace:7
  surface:42
EOF
    ;;
  *)
    exit 0
    ;;
esac
`,
    );

    let failure;
    try {
      await execFile("bash", [MANAGED_RELOAD_SCRIPT_PATH], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: sandbox.home,
          PATH: `${sandbox.binDir}:${process.env.PATH}`,
          KUMA_SURFACES_PATH: sandbox.surfacesPath,
          KUMA_TEAM_JSON_PATH: sandbox.teamPath,
          KUMA_CMUX_DIR: join(sandbox.home, ".kuma", "cmux"),
          INIT_CWD: process.cwd(),
          KUMA_TEST_RUNNING_WORKSPACE: sandbox.workspaceRoot,
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(failure.code).toBe(1);
    expect(`${failure.stderr}`).toContain("failed to resolve pane for managed kuma-server surface");
  });

  it("rejects the repo root as a managed workspace anchor fallback", async () => {
    const sandbox = await setupManagedReloadSandbox();
    tempRoots.push(sandbox.root);

    let failure;
    try {
      await execFile("bash", [MANAGED_RELOAD_SCRIPT_PATH], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: sandbox.home,
          PATH: `${sandbox.binDir}:${process.env.PATH}`,
          KUMA_SURFACES_PATH: sandbox.surfacesPath,
          KUMA_TEAM_JSON_PATH: sandbox.teamPath,
          KUMA_CMUX_DIR: join(sandbox.home, ".kuma", "cmux"),
          INIT_CWD: process.cwd(),
          KUMA_TEST_RUNNING_WORKSPACE: "",
          KUMA_TEST_ANCHOR_WORKSPACE: process.cwd(),
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(failure.code).toBe(1);
    expect(`${failure.stderr}`).toContain("unable to resolve workspace binding");
  });
});
