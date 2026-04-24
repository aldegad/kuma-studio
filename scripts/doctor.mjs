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
import { inspectPrivateRepoLinks, PRIVATE_REPO_NAME } from "../packages/server/src/private-repo-bootstrap.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const CODEX_DIR = join(HOME, ".codex");
const STATE_DIR = join(HOME, ".kuma-picker");
const OPENAI_ENV_PATH = join(CLAUDE_DIR, ".env.openai");
const HEALTHCHECK_URL = `http://127.0.0.1:${DEFAULT_PORT}/health`;
const SKILL_ROOTS = [
  { label: "Claude", dir: join(CLAUDE_DIR, "skills") },
  { label: "Codex", dir: join(CODEX_DIR, "skills") },
];

function check(label, condition) {
  const status = condition ? "OK" : "FAIL";
  const icon = condition ? "[+]" : "[-]";
  process.stdout.write(`  ${icon} ${label}: ${status}\n`);
  return condition;
}

function report(label, status) {
  const normalized = status === "warn" ? "WARN" : status === "fail" ? "FAIL" : "OK";
  const icon = status === "warn" ? "[!]" : status === "fail" ? "[-]" : "[+]";
  process.stdout.write(`  ${icon} ${label}: ${normalized}\n`);
  return status;
}

async function main() {
  process.stdout.write("kuma-studio doctor\n\n");

  let allOk = true;
  let hasWarnings = false;

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
    { id: "kuma-brief", candidates: ["kuma-brief"] },
    { id: "kuma-dispatch", candidates: ["kuma-dispatch"] },
    { id: "kuma-overnight", candidates: ["kuma-overnight"] },
    { id: "kuma-panel", candidates: ["kuma-panel"] },
    { id: "kuma-plan", candidates: ["kuma-plan"] },
    { id: "kuma-picker", candidates: ["kuma-picker"] },
    { id: "kuma-recovery", candidates: ["kuma-recovery"] },
    { id: "kuma-server", candidates: ["kuma-server"] },
    { id: "kuma-snapshot", candidates: ["kuma-snapshot"] },
    { id: "kuma-vault", candidates: ["kuma-vault"] },
    { id: "noeuri", candidates: ["noeuri"] },
  ];
  for (const skillRoot of SKILL_ROOTS) {
    for (const skill of skills) {
      const resolvedSkill = skill.candidates.find((candidate) =>
        existsSync(join(skillRoot.dir, candidate, "SKILL.md")) ||
        existsSync(join(skillRoot.dir, candidate, "skill.md")),
      );
      const ok = Boolean(resolvedSkill);
      allOk = check(`${skillRoot.label} skill: ${skill.id}`, ok) && allOk;
      if (!ok) process.stdout.write("    Run: node scripts/install.mjs\n");
      if (ok && resolvedSkill !== skill.id) {
        process.stdout.write(`    Using legacy alias: ${resolvedSkill} (deprecated, canonical: ${skill.id})\n`);
      }
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

  const privateRepoLinks = await inspectPrivateRepoLinks();
  for (const item of privateRepoLinks.items) {
    let status = "ok";
    if (item.status === "missing") {
      status = "warn";
    } else if (item.status !== "ok") {
      status = "fail";
    }

    const result = report(`Kuma private link: ${item.id}`, status);
    if (result === "warn") {
      hasWarnings = true;
      process.stdout.write("    Run: npm run kuma-private:bootstrap\n");
    } else if (result === "fail") {
      allOk = false;
      process.stdout.write("    Expected a symlink into kuma-studio-private. Run: npm run kuma-private:bootstrap\n");
    }

    if (item.targetPath) {
      process.stdout.write(`    Target: ${item.targetPath}\n`);
    }
  }

  if (privateRepoLinks.sharedRepoRoot) {
    const result = report(
      `Private repo root (${PRIVATE_REPO_NAME})`,
      privateRepoLinks.ok ? "ok" : "fail",
    );
    if (result === "fail") {
      allOk = false;
      process.stdout.write(`    Shared root should resolve to a ${PRIVATE_REPO_NAME} clone.\n`);
    } else {
      process.stdout.write(`    Root: ${privateRepoLinks.sharedRepoRoot}\n`);
    }
  } else {
    hasWarnings = true;
    report(`Private repo root (${PRIVATE_REPO_NAME})`, "warn");
    process.stdout.write("    No shared private repo root detected yet. Run: npm run kuma-private:bootstrap\n");
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

  let summary = "All critical checks passed!";
  if (!allOk) {
    summary = "Some checks failed. See above.";
  } else if (hasWarnings) {
    summary = "Critical checks passed with warnings.";
  }

  process.stdout.write(`\n${summary}\n`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exitCode = 1;
});
