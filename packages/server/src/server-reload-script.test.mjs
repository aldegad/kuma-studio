import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const SERVER_RELOAD_SCRIPT_PATH = resolve(process.cwd(), "scripts/server-reload.sh");

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

describe("server-reload.sh", () => {
  const tempRoots = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("blocks unmanaged raw reloads unless explicitly allowed", async () => {
    await expect(execFile("bash", [SERVER_RELOAD_SCRIPT_PATH], {
      env: {
        ...process.env,
        INIT_CWD: process.cwd(),
        KUMA_STUDIO_PORT: "44311",
        KUMA_ALLOW_RAW_SERVER_RELOAD: "",
      },
    })).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("refusing unmanaged Kuma Studio server reload"),
    });
  });

  it("binds INIT_CWD as the workspace when relaunched from a workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-server-reload-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const nodeLog = join(root, "node.log");
    const workspaceRoot = join(root, "workspace");
    await mkdir(binDir, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });

    await writeExecutable(
      join(binDir, "lsof"),
      "#!/bin/bash\nexit 0\n",
    );
    await writeExecutable(
      join(binDir, "node"),
      `#!/bin/bash
set -euo pipefail
printf 'workspace=%s\\n' "\${KUMA_STUDIO_WORKSPACE:-<unset>}" > "${nodeLog}"
printf 'explorerRoots=%s\\n' "\${KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS-<unset>}" >> "${nodeLog}"
printf 'argv=' >> "${nodeLog}"
printf '%q ' "$@" >> "${nodeLog}"
printf '\\n' >> "${nodeLog}"
`,
    );

    await execFile("bash", [SERVER_RELOAD_SCRIPT_PATH], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        INIT_CWD: workspaceRoot,
        KUMA_STUDIO_PORT: "44312",
        KUMA_ALLOW_RAW_SERVER_RELOAD: "1",
      },
    });

    const log = await readFile(nodeLog, "utf8");
    expect(log).toContain(`workspace=${await realpath(workspaceRoot)}`);
    expect(log).toContain("explorerRoots=vault,claude,codex");
    expect(log).toContain("--root");
  });

  it("binds the resolver workspace when no external binding exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-server-reload-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const nodeLog = join(root, "node.log");
    const workspaceRoot = join(root, "workspace");
    await mkdir(binDir, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });

    await writeExecutable(
      join(binDir, "lsof"),
      "#!/bin/bash\nexit 0\n",
    );
    await writeExecutable(
      join(binDir, "node"),
      `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == *"/scripts/resolve-default-workspace.mjs" ]]; then
  printf '%s\\n' "${workspaceRoot}"
  exit 0
fi
printf 'workspace=%s\\n' "\${KUMA_STUDIO_WORKSPACE:-<unset>}" > "${nodeLog}"
printf 'explorerRoots=%s\\n' "\${KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS-<unset>}" >> "${nodeLog}"
`,
    );

    await execFile("bash", [SERVER_RELOAD_SCRIPT_PATH], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        INIT_CWD: process.cwd(),
        KUMA_STUDIO_PORT: "44313",
        KUMA_ALLOW_RAW_SERVER_RELOAD: "1",
      },
    });

    const log = await readFile(nodeLog, "utf8");
    expect(log).toContain(`workspace=${workspaceRoot}`);
    expect(log).toContain("explorerRoots=vault,claude,codex");
  });

  it("reuses the running daemon env when the caller does not provide bindings", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-server-reload-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const nodeLog = join(root, "node.log");
    const workspaceRoot = join(root, "workspace");
    await mkdir(binDir, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });

    await writeExecutable(
      join(binDir, "lsof"),
      `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == -tiTCP:* ]]; then
  printf '54321\\n'
fi
`,
    );
    await writeExecutable(
      join(binDir, "ps"),
      `#!/bin/bash
set -euo pipefail
printf 'node KUMA_STUDIO_WORKSPACE=%s KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS=%s /usr/local/bin/node cli.mjs serve\\n' "${workspaceRoot}" "vault,claude,codex"
`,
    );
    await writeExecutable(
      join(binDir, "node"),
      `#!/bin/bash
set -euo pipefail
printf 'workspace=%s\\n' "\${KUMA_STUDIO_WORKSPACE:-<unset>}" > "${nodeLog}"
printf 'explorerRoots=%s\\n' "\${KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS-<unset>}" >> "${nodeLog}"
`,
    );

    await execFile("bash", [SERVER_RELOAD_SCRIPT_PATH], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        INIT_CWD: process.cwd(),
        KUMA_STUDIO_PORT: "44314",
        KUMA_ALLOW_RAW_SERVER_RELOAD: "1",
      },
    });

    const log = await readFile(nodeLog, "utf8");
    expect(log).toContain(`workspace=${await realpath(workspaceRoot)}`);
    expect(log).toContain("explorerRoots=vault,claude,codex");
  });

  it("preserves an explicitly blank explorer roots env", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-server-reload-"));
    tempRoots.push(root);

    const binDir = join(root, "bin");
    const nodeLog = join(root, "node.log");
    await mkdir(binDir, { recursive: true });

    await writeExecutable(
      join(binDir, "lsof"),
      "#!/bin/bash\nexit 0\n",
    );
    await writeExecutable(
      join(binDir, "node"),
      `#!/bin/bash
set -euo pipefail
printf 'explorerRoots=%s\\n' "\${KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS-<unset>}" > "${nodeLog}"
`,
    );

    await execFile("bash", [SERVER_RELOAD_SCRIPT_PATH], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        INIT_CWD: process.cwd(),
        KUMA_STUDIO_PORT: "44315",
        KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS: "",
        KUMA_ALLOW_RAW_SERVER_RELOAD: "1",
      },
    });

    const log = await readFile(nodeLog, "utf8");
    expect(log).toContain("explorerRoots=");
    expect(log).not.toContain("<unset>");
  });
});
