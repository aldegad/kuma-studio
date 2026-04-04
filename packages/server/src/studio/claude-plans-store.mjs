/**
 * Claude Plans cache store — reads/deletes markdown plan files
 * from ~/.claude/plans/ directory.
 */

import { readdir, readFile, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";

const CLAUDE_PLANS_DIR = join(homedir(), ".claude", "plans");

/**
 * Extract the first # heading from markdown content.
 * @param {string} content
 * @returns {string|null}
 */
function extractTitle(content) {
  const match = content.match(/^\s*#\s+(.+)/mu);
  return match ? match[1].trim() : null;
}

/**
 * Read all .md files from ~/.claude/plans/ and return metadata for each.
 * @returns {Promise<Array<{id: string, filename: string, title: string, size: number, modified: string, preview: string}>>}
 */
export async function listClaudePlans() {
  if (!existsSync(CLAUDE_PLANS_DIR)) return [];

  const files = await readdir(CLAUDE_PLANS_DIR);
  const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

  const plans = [];

  for (const filename of mdFiles) {
    const filePath = join(CLAUDE_PLANS_DIR, filename);

    try {
      const [content, fileStat] = await Promise.all([
        readFile(filePath, "utf8"),
        stat(filePath),
      ]);

      if (!fileStat.isFile()) continue;

      const id = filename.replace(/\.md$/u, "");
      const title = extractTitle(content) || id;
      const preview = content.slice(0, 200);

      plans.push({
        id,
        filename,
        title,
        size: fileStat.size,
        modified: fileStat.mtime.toISOString(),
        preview,
      });
    } catch {
      continue;
    }
  }

  return plans;
}

/**
 * Delete a .md file from ~/.claude/plans/.
 * Validates filename to prevent path traversal.
 * @param {string} filename
 * @returns {Promise<{success: boolean, error?: string, status?: number}>}
 */
export async function deleteClaudePlan(filename) {
  // Block path traversal
  if (
    !filename ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return { success: false, error: "Invalid filename.", status: 400 };
  }

  // Only allow .md extension
  if (extname(filename) !== ".md") {
    return { success: false, error: "Only .md files can be deleted.", status: 400 };
  }

  // Extra safety: basename must match the input
  if (basename(filename) !== filename) {
    return { success: false, error: "Invalid filename.", status: 400 };
  }

  const filePath = join(CLAUDE_PLANS_DIR, filename);

  try {
    await unlink(filePath);
    return { success: true };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { success: false, error: "File not found.", status: 404 };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      status: 500,
    };
  }
}
