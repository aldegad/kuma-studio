import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { parseFrontmatterDocument } from "./vault-ingest.mjs";

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

export async function readStudioSkills() {
  try {
    const skillsDir = join(homedir(), ".claude", "skills");
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.isSymbolicLink()) {
        try {
          const metadata = await stat(join(skillsDir, entry.name));
          if (!metadata.isDirectory()) continue;
        } catch {
          continue;
        }
      }

      try {
        const skillDir = join(skillsDir, entry.name);
        const files = await readdir(skillDir);
        const skillFile = files.find((file) => file.toLowerCase() === "skill.md");

        if (!skillFile) continue;

        const content = await readFile(join(skillDir, skillFile), "utf8");

        skills.push({
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

    return skills;
  } catch {
    return [];
  }
}

export async function readStudioPlugins() {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const content = await readFile(settingsPath, "utf8");
    const settings = JSON.parse(content);
    const plugins = settings.enabledPlugins;
    if (Array.isArray(plugins)) return plugins;
    if (plugins && typeof plugins === "object") return Object.keys(plugins).filter((key) => plugins[key]);
    return [];
  } catch {
    return [];
  }
}
