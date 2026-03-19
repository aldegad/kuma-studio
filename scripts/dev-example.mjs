import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    if (host) {
      server.listen(port, host);
      return;
    }

    server.listen(port);
  });
}

async function findAvailablePort(startPort, host) {
  let port = startPort;

  while (!(await isPortAvailable(port, host))) {
    port += 1;
  }

  return port;
}

function runLinkScript() {
  const result = spawnSync(process.execPath, ["./scripts/link-example-runtime.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

async function main() {
  runLinkScript();

  const requestedWebPort = Number(process.env.PORT ?? 3000);
  const requestedDaemonPort = Number(process.env.KUMA_PICKER_DAEMON_PORT ?? 4312);

  const daemonPort = await findAvailablePort(requestedDaemonPort, "127.0.0.1");
  const webPort = await findAvailablePort(requestedWebPort);
  const daemonUrl = `http://127.0.0.1:${daemonPort}`;

  process.stdout.write(`[kuma-picker] daemon: ${daemonUrl}\n`);
  process.stdout.write(`[kuma-picker] web: http://127.0.0.1:${webPort}\n`);

  const daemon = spawn(
    process.execPath,
    ["./packages/server/src/cli.mjs", "serve", "--root", "./example/next-host", "--port", String(daemonPort)],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    },
  );

  const web = spawn(
    npmCommand,
    ["run", "dev", "--workspace=kuma-picker-example-next-host", "--", "--port", String(webPort)],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        NEXT_PUBLIC_KUMA_PICKER_DAEMON_URL: daemonUrl,
        PORT: String(webPort),
      },
    },
  );

  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (!daemon.killed) daemon.kill("SIGTERM");
    if (!web.killed) web.kill("SIGTERM");

    setTimeout(() => process.exit(code), 200);
  };

  daemon.on("exit", (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });

  web.on("exit", (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
