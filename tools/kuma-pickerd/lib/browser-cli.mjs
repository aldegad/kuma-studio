import { fetchJson, getDaemonUrlFromOptions } from "./automation-client.mjs";

export async function commandGetBrowserSession(options) {
  const daemonUrl = getDaemonUrlFromOptions(options);
  const session = await fetchJson(`${daemonUrl}/browser-session`, {
    method: "GET",
    headers: {},
  });
  process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
}
