#!/usr/bin/env node

/**
 * Install kuma-studio skills into a Claude Code project.
 *
 * Usage: node scripts/install.mjs [--project-dir /path/to/project]
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = args["project-dir"] ?? process.cwd();

  process.stdout.write(`Installing kuma-studio skills into ${projectDir}\n`);

  // Create .claude directory if needed
  const claudeDir = resolve(projectDir, ".claude");
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Check if kuma-studio server package is accessible
  const serverPkg = resolve(ROOT, "packages/server/package.json");
  if (!existsSync(serverPkg)) {
    process.stderr.write("Error: kuma-studio server package not found.\n");
    process.exitCode = 1;
    return;
  }

  process.stdout.write("kuma-studio skills installed successfully.\n");
  process.stdout.write(`\nQuick start:\n`);
  process.stdout.write(`  cd ${ROOT}\n`);
  process.stdout.write(`  npm run kuma-studio:serve\n`);
  process.stdout.write(`  npm run kuma-studio:dashboard\n`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exitCode = 1;
});
