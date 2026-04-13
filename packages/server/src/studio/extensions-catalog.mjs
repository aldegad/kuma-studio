import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_DISPATCH_RESULT_DIR } from "../kuma-paths.mjs";

const CLAUDE_CATALOG_PATH = join(DEFAULT_DISPATCH_RESULT_DIR, "claude-addons-catalog.result.md");
const CODEX_CATALOG_PATH = join(DEFAULT_DISPATCH_RESULT_DIR, "codex-addons-catalog.result.md");

const CATALOG_SPECS = [
  {
    id: "claude-code",
    label: "Claude Code",
    path: CLAUDE_CATALOG_PATH,
    categories: [
      { id: "tools", label: "도구", heading: "## 1. 내장 도구" },
      { id: "skills", label: "스킬", heading: "## 2. 스킬" },
      { id: "plugins", label: "플러그인", heading: "## 3. 플러그인" },
      { id: "mcp", label: "MCP", heading: "## 4. MCP 서버" },
      { id: "hooks", label: "훅", heading: "## 5. 훅" },
    ],
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    path: CODEX_CATALOG_PATH,
    categories: [
      { id: "plugins", label: "플러그인", heading: "## 1. 플러그인 카탈로그" },
      { id: "skills", label: "스킬", heading: "## 2. 스킬 카탈로그" },
      { id: "mcp", label: "MCP", heading: "## 3. MCP / 외부 도구 연동 카탈로그" },
      { id: "cli", label: "CLI 명령", heading: "## 4. CLI 서브커맨드 카탈로그" },
    ],
  },
];

function extractMarkdownSection(content, heading) {
  const lines = String(content ?? "").split(/\r?\n/u);
  const startIndex = lines.findIndex((line) => line.startsWith(heading));
  if (startIndex < 0) {
    return "";
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join("\n").trim();
}

async function readCatalogContent(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export async function readExtensionsCatalog() {
  const ecosystems = await Promise.all(
    CATALOG_SPECS.map(async (spec) => {
      const content = await readCatalogContent(spec.path);
      const categories = spec.categories
        .map((category) => ({
          id: category.id,
          label: category.label,
          markdown: extractMarkdownSection(content, category.heading),
        }))
        .filter((category) => category.markdown.length > 0);

      return {
        id: spec.id,
        label: spec.label,
        sourcePath: spec.path,
        available: categories.length > 0,
        categories,
      };
    }),
  );

  return {
    ecosystems,
  };
}
