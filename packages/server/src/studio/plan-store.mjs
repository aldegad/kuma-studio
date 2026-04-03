/**
 * Plan document store — reads markdown plan files and calculates progress.
 *
 * Plan format: Markdown with YAML frontmatter + `- [x]`/`- [ ]` checklists.
 * Optional commit linking: `<!-- commit:hash -->` after a checklist item.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

/**
 * Resolve the plans directory.
 * Priority: KUMA_PLANS_DIR > KUMA_STUDIO_WORKSPACE/.kuma/plans > ~/Documents/workspace/.kuma/plans
 */
function resolvePlansDir() {
  if (process.env.KUMA_PLANS_DIR) return process.env.KUMA_PLANS_DIR;
  const workspace =
    process.env.KUMA_STUDIO_WORKSPACE || join(homedir(), "Documents", "workspace");
  return join(workspace, ".kuma", "plans");
}

function createWarning(code, message) {
  return { code, message };
}

function normalizeFrontmatterValue(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(content = "") {
  const safeContent = typeof content === "string" ? content : "";
  const warnings = [];

  if (safeContent.trim().length === 0) {
    warnings.push(createWarning("empty-file", "Plan file is empty."));
    return { frontmatter: {}, body: "", warnings };
  }

  const lines = safeContent.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: safeContent, warnings };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    warnings.push(
      createWarning(
        "frontmatter-not-closed",
        "Frontmatter start delimiter was found without a closing delimiter.",
      ),
    );
    return { frontmatter: {}, body: safeContent, warnings };
  }

  const frontmatter = Object.create(null);
  for (const [index, rawLine] of lines.slice(1, closingIndex).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!match) {
      warnings.push(
        createWarning(
          "frontmatter-malformed",
          `Ignoring malformed frontmatter at line ${index + 2}.`,
        ),
      );
      continue;
    }

    const [, key, value] = match;
    frontmatter[key] = normalizeFrontmatterValue(value);
  }

  return {
    frontmatter,
    body: lines.slice(closingIndex + 1).join("\n"),
    warnings,
  };
}

function parseChecklist(body = "") {
  const sections = [];
  let current = { title: "", items: [] };

  for (const line of body.split(/\r?\n/u)) {
    const heading = line.match(/^\s*##\s+(.+)/u);
    if (heading) {
      if (current.title || current.items.length) sections.push(current);
      current = { title: heading[1].trim(), items: [] };
      continue;
    }

    const check = line.match(/^\s*-\s+\[([ xX])\]\s+(.+)/u);
    if (check) {
      const checked = check[1] !== " ";
      let text = check[2].trim();
      let commitHash = null;

      const cm = text.match(/<!--\s*commit:([A-Za-z0-9]+)\s*-->/u);
      if (cm) {
        commitHash = cm[1];
        text = text.replace(/\s*<!--\s*commit:[A-Za-z0-9]+\s*-->/u, "").trim();
      }

      current.items.push({ text, checked, commitHash });
    }
  }

  if (current.title || current.items.length) sections.push(current);
  return sections;
}

/** Read all plan documents and return a snapshot. */
export async function readPlans() {
  const plansDir = resolvePlansDir();

  if (!existsSync(plansDir)) {
    return { plans: [], totalItems: 0, checkedItems: 0, overallCompletionRate: 0 };
  }

  const files = await readdir(plansDir, { recursive: true });
  const mdFiles = files
    .filter((f) => f.endsWith(".md") && basename(f) !== "index.md")
    .sort();

  const plans = [];
  let totalItems = 0;
  let checkedItems = 0;

  for (const file of mdFiles) {
    const planId = file.replace(/\.md$/u, "");

    try {
      const content = await readFile(join(plansDir, file), "utf8");
      const { frontmatter, body, warnings } = parseFrontmatter(content);
      const sections = parseChecklist(body);

      const planTotal = sections.reduce((sum, section) => sum + section.items.length, 0);
      const planChecked = sections.reduce(
        (sum, section) => sum + section.items.filter((item) => item.checked).length,
        0,
      );

      plans.push({
        id: planId,
        title: frontmatter.title || planId,
        status: frontmatter.status || "in_progress",
        created: frontmatter.created || null,
        sections,
        totalItems: planTotal,
        checkedItems: planChecked,
        completionRate: planTotal > 0 ? (planChecked / planTotal) * 100 : 0,
        warnings,
      });

      totalItems += planTotal;
      checkedItems += planChecked;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown read error";
      plans.push({
        id: planId,
        title: planId,
        status: "error",
        created: null,
        sections: [],
        totalItems: 0,
        checkedItems: 0,
        completionRate: 0,
        warnings: [createWarning("read-error", message)],
      });
    }
  }

  return {
    plans,
    totalItems,
    checkedItems,
    overallCompletionRate: totalItems > 0 ? (checkedItems / totalItems) * 100 : 0,
  };
}
