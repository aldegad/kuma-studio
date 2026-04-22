#!/usr/bin/env node

import { basename } from "node:path";

import {
  bootstrapPrivateRepo,
  PRIVATE_REPO_NAME,
  resolveDefaultPrivateRepoDir,
} from "../packages/server/src/private-repo-bootstrap.mjs";

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/private-repo-bootstrap.mjs [target-path]",
      "",
      "Bootstraps a private Kuma brain repo and relinks ~/.kuma/vault, ~/.kuma/plans, and ~/.kuma/team.json.",
      `Default target: ${resolveDefaultPrivateRepoDir()}`,
      "",
    ].join("\n"),
  );
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }
  if (args.length > 1) {
    throw new Error("Expected at most one target path argument.");
  }

  const targetArg = args[0];
  const result = await bootstrapPrivateRepo({
    targetDir: targetArg ?? resolveDefaultPrivateRepoDir(),
  });

  process.stdout.write(`kuma-private bootstrap\n\n`);
  process.stdout.write(`Target repo: ${result.targetDir}\n`);
  process.stdout.write(`Existing target content: ${result.targetWasPopulated ? "populated" : "empty"}\n`);
  process.stdout.write(`Git init: ${result.gitInitialized ? "created" : "already present"}\n`);

  if (result.copied.length > 0) {
    process.stdout.write("\nCopied from ~/.kuma:\n");
    for (const entry of result.copied) {
      process.stdout.write(`- ${entry.id}\n`);
    }
  }

  if (result.scaffolded.length > 0) {
    process.stdout.write("\nScaffolded:\n");
    for (const path of result.scaffolded) {
      process.stdout.write(`- ${basename(path)}\n`);
    }
  }

  if (result.backups.length > 0 && result.backupRoot) {
    process.stdout.write(`\nPre-link backup: ${result.backupRoot}\n`);
  }

  process.stdout.write("\nCanonical links:\n");
  for (const link of result.linked) {
    process.stdout.write(`- ${link.id}: ${link.status}\n`);
  }

  process.stdout.write(
    [
      "",
      `Next:`,
      `1. cd ${result.targetDir}`,
      `2. git remote add origin <your-private-${PRIVATE_REPO_NAME}-remote>`,
      "3. git add . && git commit -m \"Initialize private Kuma brain\"",
      "4. git push -u origin main",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
