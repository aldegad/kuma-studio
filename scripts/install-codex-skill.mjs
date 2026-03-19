import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const skillName = "kuma-picker";
const sourceDir = path.join(repoRoot, "skills", skillName);
const extensionSourceDir = path.join(repoRoot, "packages", "browser-extension");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const targetDir = path.join(codexHome, "skills", skillName);
const extensionTargetDir = path.join(codexHome, "extensions", "kuma-picker-browser-extension");
const hostGuidePath = path.join(repoRoot, "docs", "install-next-app-router.md");

function parseArgs(argv) {
  return {
    yes: argv.includes("--yes"),
    skipExperimentalPrompt: argv.includes("--skip-experimental-prompt"),
    showExperimentalGuide: argv.includes("--show-experimental-guide"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printUsage() {
  console.log(`install-codex-skill.mjs

Usage:
  node ./scripts/install-codex-skill.mjs [--yes] [--skip-experimental-prompt] [--show-experimental-guide]

What it installs by default:
  - ~/.codex/skills/kuma-picker
  - ~/.codex/extensions/kuma-picker-browser-extension

What it does not install by default:
  - picker/provider host embedding
  - design-lab routes
  - any files inside the current app repo

Experimental host embedding is optional. Use --show-experimental-guide to print the setup guide path without prompting.
`);
}

function installDirectory(sourcePath, targetPath, label) {
  if (!fs.existsSync(sourcePath)) {
    console.error(`${label} source not found: ${sourcePath}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function isInteractivePromptEnabled(options) {
  return process.stdin.isTTY && process.stdout.isTTY && !options.yes && !options.skipExperimentalPrompt;
}

function prompt(question) {
  return new Promise((resolvePromise) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolvePromise(answer);
    });
  });
}

async function maybeOfferExperimentalGuide(options) {
  if (options.showExperimentalGuide) {
    console.log("Experimental host embedding guide:");
    console.log(hostGuidePath);
    console.log("This mode is optional and not required for the Chrome extension workflow.");
    return;
  }

  if (!isInteractivePromptEnabled(options)) {
    return;
  }

  const answer = (await prompt(
    "Optional experimental host embedding (picker/provider/design-lab) was not installed. It is not needed for the browser extension workflow. Show the setup guide path now? [y/N] ",
  ))
    .trim()
    .toLowerCase();

  if (answer === "y" || answer === "yes") {
    console.log("Experimental host embedding guide:");
    console.log(hostGuidePath);
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

installDirectory(sourceDir, targetDir, "Skill");
installDirectory(extensionSourceDir, extensionTargetDir, "Browser extension");

console.log(`Installed ${skillName} skill to ${targetDir}`);
console.log(`Installed browser extension to ${extensionTargetDir}`);
console.log("Installed the core extension-first workflow only.");
console.log("No files were added to the current app repo.");
console.log("Optional host embedding (picker/provider/design-lab) is experimental and not installed by default.");

await maybeOfferExperimentalGuide(options);
