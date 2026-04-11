/**
 * Plan document store — reads markdown plan files and calculates progress.
 *
 * Plan format: Markdown with YAML frontmatter + `- [x]`/`- [ ]` checklists.
 * Optional commit linking: `<!-- commit:hash -->` after a checklist item.
 */

import fs, { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PLAN_STATUS_COLOR_BY_STATUS = {
  active: "blue",
  hold: "yellow",
  blocked: "orange",
  completed: "green",
  failed: "red",
};

let cachedPlansDir = null;
let cachedPlansSnapshot = null;
let cachedPlansPromise = null;

/**
 * Resolve the plans directory.
 * Priority: KUMA_PLANS_DIR > KUMA_STUDIO_WORKSPACE/.kuma/plans > <cwd>/.kuma/plans
 */
function resolvePlansDir() {
  if (process.env.KUMA_PLANS_DIR) return process.env.KUMA_PLANS_DIR;
  const workspace = process.env.KUMA_STUDIO_WORKSPACE || process.cwd();
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

export function normalizePlanStatus(rawStatus) {
  const normalized = String(rawStatus ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");

  switch (normalized) {
    case "":
    case "active":
    case "in_progress":
      return "active";
    case "hold":
    case "on_hold":
    case "paused":
      return "hold";
    case "blocked":
      return "blocked";
    case "completed":
    case "done":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    default:
      return normalized;
  }
}

export function getPlanStatusColor(status) {
  return PLAN_STATUS_COLOR_BY_STATUS[normalizePlanStatus(status)] ?? "gray";
}

function normalizePlanId(filePath) {
  if (filePath.endsWith("/index.md")) {
    return filePath.slice(0, -"/index.md".length);
  }

  return filePath.replace(/\.md$/u, "");
}

function createEmptyPlansSnapshot() {
  return { plans: [], totalItems: 0, checkedItems: 0, overallCompletionRate: 0 };
}

function syncCacheDirectory(plansDir) {
  if (cachedPlansDir === plansDir) {
    return;
  }

  cachedPlansDir = plansDir;
  cachedPlansSnapshot = null;
  cachedPlansPromise = null;
}

async function loadPlansFromDisk(plansDir) {
  if (!existsSync(plansDir)) {
    return createEmptyPlansSnapshot();
  }

  const files = await readdir(plansDir, { recursive: true });
  const mdFiles = files
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .sort();

  const plans = [];
  let totalItems = 0;
  let checkedItems = 0;

  for (const file of mdFiles) {
    const planId = normalizePlanId(file);
    const slashIndex = planId.indexOf("/");
    const project = slashIndex > 0 ? planId.slice(0, slashIndex) : null;

    try {
      const content = await readFile(join(plansDir, file), "utf8");
      const { frontmatter, body, warnings } = parseFrontmatter(content);
      const sections = parseChecklist(body);
      const status = normalizePlanStatus(frontmatter.status || "active");

      const planTotal = sections.reduce((sum, section) => sum + section.items.length, 0);
      const planChecked = sections.reduce(
        (sum, section) => sum + section.items.filter((item) => item.checked).length,
        0,
      );

      plans.push({
        id: planId,
        project,
        title: frontmatter.title || planId,
        status,
        statusColor: getPlanStatusColor(status),
        created: frontmatter.created || null,
        body: body.trim(),
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
        project,
        title: planId,
        status: "failed",
        statusColor: getPlanStatusColor("failed"),
        created: null,
        body: "",
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

export function invalidatePlansCache() {
  cachedPlansSnapshot = null;
  cachedPlansPromise = null;
}

export async function refreshPlans() {
  const plansDir = resolvePlansDir();
  syncCacheDirectory(plansDir);

  if (cachedPlansPromise) {
    return cachedPlansPromise;
  }

  const loadPromise = loadPlansFromDisk(plansDir)
    .then((snapshot) => {
      cachedPlansSnapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      if (cachedPlansPromise === loadPromise) {
        cachedPlansPromise = null;
      }
    });

  cachedPlansPromise = loadPromise;
  return loadPromise;
}

/** Read all plan documents and return a cached snapshot. */
export async function readPlans() {
  const plansDir = resolvePlansDir();
  syncCacheDirectory(plansDir);

  if (cachedPlansSnapshot) {
    return cachedPlansSnapshot;
  }

  if (cachedPlansPromise) {
    return cachedPlansPromise;
  }

  return refreshPlans();
}

/**
 * Watch the plans directory recursively and refresh cached snapshots on markdown changes.
 * @param {{ debounceMs?: number, onChange?: (snapshot: Awaited<ReturnType<typeof readPlans>>) => void | Promise<void>, onError?: (error: unknown) => void }} [options]
 * @returns {() => void}
 */
export function watchPlans(options = {}) {
  const { debounceMs = 500, onChange, onError } = options;
  const plansDir = resolvePlansDir();
  syncCacheDirectory(plansDir);

  if (!existsSync(plansDir)) {
    return () => {};
  }

  let debounceTimer = null;
  let closed = false;
  let watcher = null;

  const scheduleRefresh = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const snapshot = await refreshPlans();
        await onChange?.(snapshot);
      } catch (error) {
        onError?.(error);
      }
    }, debounceMs);
  };

  try {
    watcher = fs.watch(plansDir, { recursive: true }, (_eventType, filename) => {
      if (closed) {
        return;
      }

      const relativeFile = typeof filename === "string" ? filename : "";
      if (relativeFile && !relativeFile.endsWith(".md")) {
        return;
      }

      scheduleRefresh();
    });
  } catch (error) {
    onError?.(error);
    return () => {};
  }

  return () => {
    closed = true;
    clearTimeout(debounceTimer);
    watcher?.close();
  };
}
