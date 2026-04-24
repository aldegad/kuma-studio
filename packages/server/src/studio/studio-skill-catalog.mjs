import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import { parseFrontmatterDocument } from "./vault-ingest.mjs";

const HOME_DIR = homedir();
const SKILL_SOURCES = [
  { ecosystem: "claude", ecosystemLabel: "Claude", dir: join(HOME_DIR, ".claude", "skills") },
  { ecosystem: "codex", ecosystemLabel: "Codex", dir: join(HOME_DIR, ".codex", "skills") },
];
const CLAUDE_PLUGIN_DIR = join(HOME_DIR, ".claude", "plugins");
const CLAUDE_SETTINGS_PATH = join(HOME_DIR, ".claude", "settings.json");
const CODEX_CONFIG_PATH = join(HOME_DIR, ".codex", "config.toml");
const CODEX_PLUGIN_CACHE_DIR = join(HOME_DIR, ".codex", "plugins", "cache");

export function extractStudioSkillDescription(content) {
  const parsed = parseFrontmatterDocument(String(content ?? ""));
  const frontmatterDescription = typeof parsed.frontmatter?.description === "string"
    ? parsed.frontmatter.description.trim()
    : "";
  if (frontmatterDescription) {
    return frontmatterDescription;
  }

  const body = parsed.body ?? String(content ?? "");
  const lines = body.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => /^#\s+/u.test(line.trim()));
  const candidateLines = (headingIndex >= 0 ? lines.slice(headingIndex + 1) : lines)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#+\s+/u.test(line));

  const firstSentence = candidateLines[0]?.match(/^(.+?[.!?])(?:\s|$)/u)?.[1] ?? candidateLines[0] ?? "";
  return firstSentence.trim();
}

async function readSkillsFromDir({ ecosystem, ecosystemLabel, dir }) {
  const skills = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.isSymbolicLink()) {
        try {
          const metadata = await stat(join(dir, entry.name));
          if (!metadata.isDirectory()) continue;
        } catch {
          continue;
        }
      }

      try {
        const skillDir = join(dir, entry.name);
        const files = await readdir(skillDir);
        const skillFile = files.find((file) => file.toLowerCase() === "skill.md");

        if (!skillFile) continue;

        const content = await readFile(join(skillDir, skillFile), "utf8");

        skills.push({
          ecosystem,
          ecosystemLabel,
          name: entry.name,
          description: extractStudioSkillDescription(content),
          file: skillFile,
          content,
          path: join(skillDir, skillFile),
        });
      } catch {
        continue;
      }
    }

    return skills.sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

export async function readStudioSkills() {
  const groups = await Promise.all(SKILL_SOURCES.map(readSkillsFromDir));
  return groups.flat();
}

function parseJsonPluginManifest(content) {
  try {
    const manifest = JSON.parse(content);
    const name = typeof manifest?.name === "string" ? manifest.name.trim() : "";
    const displayName = typeof manifest?.interface?.displayName === "string"
      ? manifest.interface.displayName.trim()
      : name;
    const description = typeof manifest?.interface?.shortDescription === "string"
      ? manifest.interface.shortDescription.trim()
      : typeof manifest?.description === "string"
        ? manifest.description.trim()
        : "";
    return { name, displayName, description };
  } catch {
    return { name: "", displayName: "", description: "" };
  }
}

async function readPluginManifest(path) {
  try {
    return parseJsonPluginManifest(await readFile(path, "utf8"));
  } catch {
    return { name: "", displayName: "", description: "" };
  }
}

function normalizeEnabledPluginKeys(enabledPlugins) {
  if (Array.isArray(enabledPlugins)) {
    return enabledPlugins.filter((plugin) => typeof plugin === "string" && plugin.trim()).map((plugin) => plugin.trim());
  }
  if (enabledPlugins && typeof enabledPlugins === "object") {
    return Object.keys(enabledPlugins).filter((key) => enabledPlugins[key]);
  }
  return [];
}

export function filterClaudePluginKeys(keys, skillNames = new Set()) {
  return keys
    .map((key) => String(key ?? "").trim())
    .filter(Boolean)
    .filter((key) => !key.endsWith("@user-skills"))
    .filter((key) => !skillNames.has(key));
}

export function parseCodexEnabledPluginKeys(content) {
  const keys = [];
  let currentKey = "";
  for (const line of String(content ?? "").split(/\r?\n/u)) {
    const section = line.match(/^\s*\[plugins\."([^"]+)"\]\s*$/u);
    if (section) {
      currentKey = section[1].trim();
      continue;
    }
    if (currentKey && /^\s*enabled\s*=\s*true\s*$/u.test(line)) {
      keys.push(currentKey);
      currentKey = "";
      continue;
    }
    if (/^\s*\[/.test(line)) {
      currentKey = "";
    }
  }
  return keys;
}

async function readClaudePlugins(skillNames) {
  try {
    const settings = JSON.parse(await readFile(CLAUDE_SETTINGS_PATH, "utf8"));
    const keys = filterClaudePluginKeys(normalizeEnabledPluginKeys(settings?.enabledPlugins), skillNames);
    const plugins = [];
    for (const key of keys) {
      const pluginName = key.split("@")[0] || key;
      const manifestPath = join(CLAUDE_PLUGIN_DIR, pluginName, ".claude-plugin", "plugin.json");
      const manifest = await readPluginManifest(manifestPath);
      plugins.push({
        ecosystem: "claude",
        ecosystemLabel: "Claude",
        name: key,
        displayName: manifest.displayName || pluginName,
        description: manifest.description,
        sourcePath: manifest.name ? dirname(dirname(manifestPath)) : "",
      });
    }
    return plugins;
  } catch {
    return [];
  }
}

async function readCodexPlugins() {
  try {
    const keys = parseCodexEnabledPluginKeys(await readFile(CODEX_CONFIG_PATH, "utf8"));
    const plugins = [];
    for (const key of keys) {
      const [pluginName, marketplace = ""] = key.split("@");
      if (!pluginName || !marketplace) continue;
      const versionsRoot = join(CODEX_PLUGIN_CACHE_DIR, marketplace, pluginName);
      let versions = [];
      try {
        versions = (await readdir(versionsRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
      } catch {
        versions = [];
      }
      const version = versions.at(-1) ?? "";
      const manifestPath = version
        ? join(versionsRoot, version, ".codex-plugin", "plugin.json")
        : "";
      const manifest = manifestPath ? await readPluginManifest(manifestPath) : { displayName: "", description: "" };
      plugins.push({
        ecosystem: "codex",
        ecosystemLabel: "Codex",
        name: key,
        displayName: manifest.displayName || pluginName,
        description: manifest.description,
        sourcePath: version ? dirname(dirname(manifestPath)) : "",
      });
    }
    return plugins;
  } catch {
    return [];
  }
}

export async function readStudioPlugins() {
  const skills = await readStudioSkills();
  const claudeSkillNames = new Set(
    skills.filter((skill) => skill.ecosystem === "claude").map((skill) => skill.name),
  );
  const groups = await Promise.all([
    readClaudePlugins(claudeSkillNames),
    readCodexPlugins(),
  ]);
  return groups.flat();
}
