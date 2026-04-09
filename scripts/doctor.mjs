#!/usr/bin/env node

/**
 * Diagnostic check for kuma-studio installation.
 *
 * Usage: node scripts/doctor.mjs
 */

import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "../packages/server/src/constants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const STATE_DIR = join(HOME, ".kuma-picker");
const OPENAI_ENV_PATH = join(CLAUDE_DIR, ".env.openai");
const HEALTHCHECK_URL = `http://127.0.0.1:${DEFAULT_PORT}/health`;

function check(label, condition) {
  const status = condition ? "OK" : "FAIL";
  const icon = condition ? "[+]" : "[-]";
  process.stdout.write(`  ${icon} ${label}: ${status}\n`);
  return condition;
}

async function main() {
  process.stdout.write("kuma-studio doctor\n\n");

  let allOk = true;

  // Check Node.js version
  const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
  allOk = check("Node.js >= 20", nodeVersion >= 20) && allOk;

  // Check project structure
  allOk = check("packages/server exists", existsSync(resolve(ROOT, "packages/server/src/index.mjs"))) && allOk;
  allOk = check("packages/studio-web exists", existsSync(resolve(ROOT, "packages/studio-web/package.json"))) && allOk;
  allOk = check("packages/browser-extension exists", existsSync(resolve(ROOT, "packages/browser-extension/manifest.json"))) && allOk;

  // Check dependencies
  allOk = check("node_modules installed", existsSync(resolve(ROOT, "node_modules"))) && allOk;
  allOk = check("ws package available", existsSync(resolve(ROOT, "node_modules/ws"))) && allOk;

  // Check studio-web build
  const studioDistExists = existsSync(resolve(ROOT, "packages/studio-web/dist/index.html"));
  check("studio-web built", studioDistExists);
  if (!studioDistExists) {
    process.stdout.write("    Run: npm run build:studio\n");
  }

  // Check skills
  const skills = [
    { id: "kuma", candidates: ["kuma"] },
    { id: "dev-team", candidates: ["dev-team"] },
    { id: "strategy-analytics-team", candidates: ["strategy-analytics-team", "analytics-team", "strategy-team"] },
    { id: "tmux-ops", candidates: ["tmux-ops"] },
  ];
  for (const skill of skills) {
    const resolvedSkill = skill.candidates.find((candidate) =>
      existsSync(join(CLAUDE_DIR, "skills", candidate, "skill.md")),
    );
    const ok = Boolean(resolvedSkill);
    allOk = check(`Skill: ${skill.id}`, ok) && allOk;
    if (!ok) process.stdout.write("    Run: node scripts/install.mjs\n");
    if (ok && resolvedSkill !== skill.id) {
      process.stdout.write(`    Using legacy alias: ${resolvedSkill} (deprecated, canonical: ${skill.id})\n`);
    }
  }

  // Check state directory and team metadata
  allOk = check(`State dir (${STATE_DIR})`, existsSync(STATE_DIR)) && allOk;
  const hasTeamMeta = existsSync(join(STATE_DIR, "team.json"));
  allOk = check("Team metadata", hasTeamMeta) && allOk;
  if (!hasTeamMeta) process.stdout.write("    Run: node scripts/install.mjs\n");

  // Check for OpenAI API key
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  check("OPENAI_API_KEY set (optional)", hasApiKey);
  if (!hasApiKey) {
    process.stdout.write(`    For image generation: source ${OPENAI_ENV_PATH}\n`);
  }

  // Try to reach the daemon
  try {
    const res = await fetch(HEALTHCHECK_URL, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    check("Daemon server reachable", data.ok === true);
  } catch {
    check("Daemon server reachable", false);
    process.stdout.write("    Start server: npm run server:reload\n");
  }

  process.stdout.write(`\n${allOk ? "All critical checks passed!" : "Some checks failed. See above."}\n`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exitCode = 1;
});
