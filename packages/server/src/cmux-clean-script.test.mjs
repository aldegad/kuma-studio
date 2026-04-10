import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile as execFileCallback } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

const CLEAN_SCRIPT_PATH = resolve(process.cwd(), "scripts/cmux/kuma-cmux-clean.sh");

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

describe("cmux orphan clean script", { timeout: 30_000 }, () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("preserves kuma root and workspace main surfaces while reporting real orphans in dry-run mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-clean-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const registryPath = join(root, "surfaces.json");

    await mkdir(binDir, { recursive: true });
    await writeFile(
      registryPath,
      `${JSON.stringify({
        system: {
          "🐻 쿠마": "surface:1",
          "🦌 노을이": "surface:83",
        },
        "kuma-studio": {
          "🦫 뚝딱이": "surface:50",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  list-workspaces)
    cat <<'EOF'
* workspace:1  🐻 kuma studio  [selected]
  workspace:2  kuma-studio
EOF
    ;;
  list-panes)
    if [ "$2" = "workspace:1" ]; then
      cat <<'EOF'
  pane:1  [1 surface]
  pane:2  [1 surface]
EOF
    else
      cat <<'EOF'
* pane:10  [3 surfaces]  [focused]
EOF
    fi
    ;;
  list-pane-surfaces)
    if [ "$2" = "workspace:1" ] && [ "$4" = "pane:1" ]; then
      cat <<'EOF'
* surface:1  🐻 쿠마  [selected]
EOF
    elif [ "$2" = "workspace:1" ] && [ "$4" = "pane:2" ]; then
      cat <<'EOF'
* surface:86  💨 슉슉이  [selected]
EOF
    else
      cat <<'EOF'
  surface:50  🦫 뚝딱이
  surface:75  kuma-studio
* surface:81  kuma-studio  [selected]
EOF
    fi
    ;;
  close-surface)
    exit 0
    ;;
  *)
    echo "unexpected cmux command: $command" >&2
    exit 1
    ;;
esac
`,
    );

    const { stdout } = await execFile("bash", [CLEAN_SCRIPT_PATH, "--dry-run", "--verbose"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SURFACES_PATH: registryPath,
      },
    });

    expect(stdout).toContain("KEEP surface:75\tworkspace:2\tkuma-studio\treason=workspace-main");
    expect(stdout).toContain("KEEP surface:81\tworkspace:2\tkuma-studio\treason=workspace-main");
    expect(stdout).toContain("ORPHAN surface:86\tworkspace:1\t💨 슉슉이");
    expect(stdout).toContain("dry-run orphan 1개: surface:86");
  });

  it("closes orphan surfaces with the required workspace argument", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-clean-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const registryPath = join(root, "surfaces.json");
    const closeLog = join(root, "close.log");

    await mkdir(binDir, { recursive: true });
    await writeFile(
      registryPath,
      `${JSON.stringify({
        "kuma-studio": {
          "🦫 뚝딱이": "surface:50",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  list-workspaces)
    echo "workspace:2  kuma-studio"
    ;;
  list-panes)
    echo "pane:10  [2 surfaces]"
    ;;
  list-pane-surfaces)
    cat <<'EOF'
  surface:50  🦫 뚝딱이
  surface:86  💨 슉슉이
EOF
    ;;
  close-surface)
    printf '%q ' "$@" > "${closeLog}"
    printf '\\n' >> "${closeLog}"
    ;;
  *)
    echo "unexpected cmux command: $command" >&2
    exit 1
    ;;
esac
`,
    );

    const { stdout } = await execFile("bash", [CLEAN_SCRIPT_PATH], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SURFACES_PATH: registryPath,
      },
    });

    const closeLogContents = await readFile(closeLog, "utf8");
    expect(closeLogContents).toContain("--workspace workspace:2 --surface surface:86");
    expect(stdout).toContain("orphan 1개 정리: surface:86");
  });

  it("keeps registered surfaces as reason=registered before workspace-main heuristics", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-clean-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const registryPath = join(root, "surfaces.json");

    await mkdir(binDir, { recursive: true });
    await writeFile(
      registryPath,
      `${JSON.stringify({
        "kuma-studio": {
          "🦔 밤토리": "surface:87",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  list-workspaces)
    echo "workspace:2  kuma-studio"
    ;;
  list-panes)
    echo "pane:10  [2 surfaces]"
    ;;
  list-pane-surfaces)
    cat <<'EOF'
  surface:87  kuma-studio
  surface:81  kuma-studio
EOF
    ;;
  close-surface)
    exit 0
    ;;
  *)
    echo "unexpected cmux command: $command" >&2
    exit 1
    ;;
esac
`,
    );

    const { stdout } = await execFile("bash", [CLEAN_SCRIPT_PATH, "--dry-run", "--verbose"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SURFACES_PATH: registryPath,
      },
    });

    expect(stdout).toContain("KEEP surface:87\tworkspace:2\tkuma-studio\treason=registered");
    expect(stdout).toContain("KEEP surface:81\tworkspace:2\tkuma-studio\treason=workspace-main");
    expect(stdout).toContain("orphan 없음");
  });

  it("warns and keeps unknown surfaces when pane lookup returns not_found", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-cmux-clean-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const registryPath = join(root, "surfaces.json");

    await mkdir(binDir, { recursive: true });
    await writeFile(registryPath, "{}\n", "utf8");

    await writeExecutable(
      join(binDir, "cmux"),
      `#!/bin/bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  list-workspaces)
    echo "workspace:2  kuma-studio"
    ;;
  list-panes)
    echo "pane:10  [1 surface]"
    ;;
  list-pane-surfaces)
    echo "Error: not_found: Pane or workspace not found" >&2
    exit 1
    ;;
  close-surface)
    exit 0
    ;;
  *)
    echo "unexpected cmux command: $command" >&2
    exit 1
    ;;
esac
`,
    );

    const { stdout, stderr } = await execFile("bash", [CLEAN_SCRIPT_PATH, "--dry-run", "--verbose"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KUMA_SURFACES_PATH: registryPath,
      },
    });

    expect(stderr).toContain("WARN: cmux list-pane-surfaces --workspace workspace:2 --pane pane:10 failed; skipping pane and keeping undiscovered surfaces in place");
    expect(stderr).toContain("Error: not_found: Pane or workspace not found");
    expect(stdout).toContain("orphan 없음");
  });
});
