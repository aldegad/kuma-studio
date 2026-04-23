import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { readJsonBody, sendJson } from "../server-support.mjs";
import { isWithinRoot, resolveExplorerRootsConfig } from "./studio-explorer-routes.mjs";

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const PDF_RENDER_TIMEOUT_MS = 30_000;

function isAllowedPath(allowedRoots, candidatePath) {
  const resolved = resolve(candidatePath);
  return allowedRoots.some((root) => isWithinRoot(root, resolved));
}

function sanitizeAsciiFilename(value) {
  const fallback = "markdown.pdf";
  const sanitized = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return sanitized || fallback;
}

function contentDispositionForDownload(filePath) {
  const sourceName = basename(filePath).replace(/\.(md|mdx)$/iu, ".pdf");
  const asciiName = sanitizeAsciiFilename(sourceName);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(sourceName)}`;
}

function getRequestOrigin(req) {
  const host = req.headers.host || "127.0.0.1:4312";
  return `http://${host}`;
}

async function renderMarkdownPdf({ req, filePath }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(PDF_RENDER_TIMEOUT_MS);

    const printUrl = `${getRequestOrigin(req)}/studio/markdown-print?path=${encodeURIComponent(filePath)}`;
    await page.goto(printUrl, { waitUntil: "networkidle", timeout: PDF_RENDER_TIMEOUT_MS });
    await page.waitForSelector("[data-markdown-print-ready]", { timeout: PDF_RENDER_TIMEOUT_MS });

    const readyState = await page.locator("[data-markdown-print-ready]").first().getAttribute("data-markdown-print-ready");
    if (readyState !== "true") {
      const message = await page.locator("body").innerText().catch(() => "Markdown print page failed to render.");
      throw new Error(message.trim() || "Markdown print page failed to render.");
    }

    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "16mm",
        right: "15mm",
        bottom: "18mm",
        left: "15mm",
      },
    });
  } finally {
    await browser.close();
  }
}

export function createStudioMarkdownPdfRouteHandler({
  workspaceRoot,
  globalRoots,
  systemRoot,
  readProjectRoots,
} = {}) {
  return async (req, res, url) => {
    if (url.pathname !== "/studio/fs/markdown-pdf") {
      return false;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed." });
      return true;
    }

    const { allowedRoots } = resolveExplorerRootsConfig({
      workspaceRoot,
      globalRoots,
      systemRoot,
      readProjectRoots,
    });

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        error: "Invalid markdown PDF payload.",
        details: error instanceof Error ? error.message : "Unknown error",
      });
      return true;
    }

    const filePath = body?.path;
    if (typeof filePath !== "string" || !filePath.trim()) {
      sendJson(res, 400, { error: "Missing path parameter." });
      return true;
    }

    const resolved = resolve(filePath);
    if (!isAllowedPath(allowedRoots, resolved)) {
      sendJson(res, 403, { error: "Path outside allowed directories." });
      return true;
    }

    if (!MARKDOWN_EXTENSIONS.has(extname(resolved).toLowerCase())) {
      sendJson(res, 400, { error: "Only Markdown files can be exported as PDF." });
      return true;
    }

    try {
      const metadata = await stat(resolved);
      if (!metadata.isFile()) {
        sendJson(res, 400, { error: "Not a file." });
        return true;
      }

      const pdf = await renderMarkdownPdf({ req, filePath: resolved });
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": pdf.byteLength,
        "Content-Disposition": contentDispositionForDownload(resolved),
        "Cache-Control": "no-store",
      });
      res.end(pdf);
    } catch (error) {
      sendJson(res, 500, {
        error: "Failed to export Markdown PDF.",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return true;
  };
}
