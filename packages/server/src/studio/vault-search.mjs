import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

import { resolveVaultDir } from "./memo-store.mjs";
import { parseFrontmatterDocument } from "./vault-ingest.mjs";

const MARKDOWN_EXTENSION = ".md";
const WALK_SKIP_DIRS = new Set([".git", "images", "node_modules"]);

function normalizeLineEndings(value) {
  return String(value ?? "").replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function normalizeSearchText(value) {
  return normalizeLineEndings(value).toLowerCase();
}

function normalizeRelativePath(value) {
  return String(value ?? "").replace(/\\/gu, "/");
}

function trimExcerpt(value) {
  const singleLine = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (singleLine.length <= 160) {
    return singleLine;
  }

  return `${singleLine.slice(0, 157)}...`;
}

function compareMatches(left, right) {
  return (
    left.path.localeCompare(right.path) ||
    left.lineNumber - right.lineNumber ||
    left.fieldKind.localeCompare(right.fieldKind)
  );
}

async function walkVaultMarkdownFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (WALK_SKIP_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...await walkVaultMarkdownFiles(rootDir, fullPath));
      continue;
    }

    if (!entry.isFile() || extname(entry.name).toLowerCase() !== MARKDOWN_EXTENSION) {
      continue;
    }

    files.push({
      fullPath,
      relativePath: normalizeRelativePath(relative(rootDir, fullPath)),
    });
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

function resolveFrontmatterBoundary(lines) {
  if (lines[0]?.trim() !== "---") {
    return {
      closingIndex: -1,
      bodyStartIndex: 0,
    };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    return {
      closingIndex: -1,
      bodyStartIndex: 0,
    };
  }

  return {
    closingIndex,
    bodyStartIndex: closingIndex + 1,
  };
}

function normalizeFrontmatterSearchValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }

  return String(value ?? "").trim();
}

// Search still needs original line numbers/excerpts even though parsing now comes from the shared ingest parser.
function parseFrontmatterSearchBridge(content = "") {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split("\n");
  const { frontmatter } = parseFrontmatterDocument(normalized);
  const { closingIndex, bodyStartIndex } = resolveFrontmatterBoundary(lines);

  if (closingIndex === -1) {
    return {
      lines,
      bodyStartIndex,
      frontmatterFields: [],
    };
  }

  const arrayValueQueues = new Map();
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      arrayValueQueues.set(key, [...value]);
    }
  }

  const frontmatterFields = [];
  let currentArrayKey = null;

  for (let index = 1; index < closingIndex; index += 1) {
    const rawLine = lines[index];
    const trimmedLine = rawLine.trimEnd();
    const arrayItem = trimmedLine.match(/^\s*-\s*(.+)$/u);
    if (currentArrayKey && arrayItem) {
      const normalizedValue = normalizeFrontmatterSearchValue(arrayValueQueues.get(currentArrayKey)?.shift());
      if (!normalizedValue) {
        continue;
      }

      frontmatterFields.push({
        key: currentArrayKey,
        value: normalizedValue,
        lineNumber: index + 1,
        excerpt: trimmedLine.trim(),
      });
      continue;
    }

    const keyMatch = trimmedLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!keyMatch) {
      currentArrayKey = null;
      continue;
    }

    const [, key, rawValue] = keyMatch;
    const parsedValue = frontmatter[key];
    if (rawValue.trim() === "") {
      currentArrayKey = Array.isArray(parsedValue) ? key : null;
      continue;
    }

    currentArrayKey = null;
    const normalizedValue = normalizeFrontmatterSearchValue(parsedValue);
    if (!normalizedValue) {
      continue;
    }

    frontmatterFields.push({
      key,
      value: normalizedValue,
      lineNumber: index + 1,
      excerpt: trimmedLine.trim(),
    });
  }

  return {
    lines,
    bodyStartIndex: closingIndex + 1,
    frontmatterFields,
  };
}

function analyzeVaultDocument(relativePath, content, normalizedQuery) {
  const canonicalId = basename(relativePath, extname(relativePath));
  const { lines, bodyStartIndex, frontmatterFields } = parseFrontmatterSearchBridge(content);
  const entityMatches = [];
  const contentMatches = [];

  if (normalizeSearchText(canonicalId).includes(normalizedQuery)) {
    entityMatches.push({
      path: relativePath,
      lineNumber: 1,
      fieldKind: "canonical_id",
      excerpt: canonicalId,
    });
  }

  for (const field of frontmatterFields) {
    if (!field.value || !normalizeSearchText(field.value).includes(normalizedQuery)) {
      continue;
    }

    entityMatches.push({
      path: relativePath,
      lineNumber: field.lineNumber,
      fieldKind: field.key === "title" ? "title" : `frontmatter:${field.key}`,
      excerpt: field.excerpt,
    });
  }

  for (let index = bodyStartIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || !normalizeSearchText(line).includes(normalizedQuery)) {
      continue;
    }

    contentMatches.push({
      path: relativePath,
      lineNumber: index + 1,
      fieldKind: "body",
      excerpt: trimExcerpt(line),
    });
  }

  entityMatches.sort(compareMatches);
  contentMatches.sort(compareMatches);

  return {
    entityMatches,
    contentMatches,
  };
}

export async function searchVault({ query, vaultDir = resolveVaultDir() } = {}) {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    throw new Error("vault-search requires a non-empty query.");
  }

  const resolvedVaultDir = resolve(vaultDir);
  if (!existsSync(resolvedVaultDir)) {
    throw new Error(`Vault directory not found: ${resolvedVaultDir}`);
  }

  const files = await walkVaultMarkdownFiles(resolvedVaultDir);
  const entityMatches = [];
  const contentMatches = [];
  const comparableQuery = normalizeSearchText(normalizedQuery);

  for (const file of files) {
    const content = await readFile(file.fullPath, "utf8");
    const matches = analyzeVaultDocument(file.relativePath, content, comparableQuery);
    entityMatches.push(...matches.entityMatches);
    contentMatches.push(...matches.contentMatches);
  }

  entityMatches.sort(compareMatches);
  contentMatches.sort(compareMatches);

  return {
    query: normalizedQuery,
    vaultDir: resolvedVaultDir,
    scannedFiles: files.length,
    entityMatches,
    contentMatches,
  };
}

export function formatVaultSearchText(result) {
  const lines = [
    "# /vault search",
    "",
    `query: ${result.query}`,
    `vault_dir: ${result.vaultDir}`,
    `files_scanned: ${result.scannedFiles}`,
    "",
    "## Entity Matches",
  ];

  if (result.entityMatches.length === 0) {
    lines.push("(none)");
  } else {
    for (const match of result.entityMatches) {
      lines.push(
        `- \`${match.path}:${match.lineNumber}\` [${match.fieldKind}] ${trimExcerpt(match.excerpt) || "(blank)"}`,
      );
    }
  }

  lines.push("", "## Content Matches");

  if (result.contentMatches.length === 0) {
    lines.push("(none)");
  } else {
    for (const match of result.contentMatches) {
      lines.push(
        `- \`${match.path}:${match.lineNumber}\` [${match.fieldKind}] ${trimExcerpt(match.excerpt) || "(blank)"}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
