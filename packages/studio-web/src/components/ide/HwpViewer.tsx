import { useEffect, useMemo, useState } from "react";
import rhwpWasmUrl from "@rhwp/core/rhwp_bg.wasm?url";

interface HwpViewerProps {
  content: string;
  mimeType: string;
  filePath: string;
  onClose: () => void;
  inline?: boolean;
}

type HwpRenderState =
  | { status: "loading" }
  | {
      status: "ready";
      pages: string[];
      fontsUsed: string[];
      missingFonts: string[];
      runtimeFontFiles: string[];
      fontAssetError: string | null;
      reflowedLinesegs: number;
      validationWarningCount: number;
    }
  | { status: "error"; message: string };

interface HwpPageTextLayout {
  runs?: HwpTextLayoutRun[];
}

interface HwpTextLayoutRun {
  text?: string;
  x?: number;
  y?: number;
  h?: number;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  textColor?: string;
  parentParaIdx?: number;
  controlIdx?: number;
  cellIdx?: number;
  cellParaIdx?: number;
}

interface HwpPageControlLayout {
  controls?: HwpControlLayoutControl[];
}

interface HwpControlLayoutControl {
  type?: string;
  paraIdx?: number;
  controlIdx?: number;
  cells?: HwpControlLayoutCell[];
}

interface HwpControlLayoutCell {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  cellIdx?: number;
}

interface HwpResolvedTableCell {
  paraIdx: number;
  controlIdx: number;
  cellIdx: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

let rhwpInitPromise: Promise<void> | null = null;
let hwpFontLinkInjected = false;
let hwpRuntimeFontStyleInjected = false;
let hwpRuntimeFontManifestPromise: Promise<{ files: Set<string>; error: string | null }> | null = null;
let fontProbeCanvas: HTMLCanvasElement | null = null;
let fontProbeContext: CanvasRenderingContext2D | null = null;

const HWP_FONT_FALLBACKS: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /(?:한컴바탕|함초롬바탕|HCR\s*Batang|HY.*명조|윤명조|신명조|휴먼명조|바탕|궁서|Batang|Gungsuh|Garamond|Times New Roman)/iu, family: '"함초롬바탕", "HCR Batang", "Noto Serif KR", "Nanum Myeongjo", serif' },
  { pattern: /(?:한컴돋움|함초롬돋움|HCR\s*Dotum|HY.*고딕|HY그래픽|HY헤드라인|윤고딕|가는각진제목체|나눔고딕|맑은 고딕|돋움|굴림|Malgun Gothic|Dotum|Gulim|Trebuchet)/iu, family: '"함초롬돋움", "HCR Dotum", "Pretendard", "Noto Sans KR", "Nanum Gothic", sans-serif' },
  { pattern: /(?:Arial|Calibri)/iu, family: '"Pretendard", "Noto Sans KR", sans-serif' },
];
const HWP_RUNTIME_FONT_FACES = [
  { family: "함초롬바탕", weight: 400, files: ["HCRBatang.ttf", "HANBatang.ttf", "HANBatang.TTF", "hanbatang.ttf"] },
  { family: "함초롬바탕", weight: 700, files: ["HCRBatang-Bold.ttf", "HANBatangB.ttf", "HANBatangB.TTF", "hanbatangb.ttf", "hanbatang-bold.ttf"] },
  { family: "HCR Batang", weight: 400, files: ["HCRBatang.ttf", "HANBatang.ttf", "HANBatang.TTF", "hanbatang.ttf"] },
  { family: "HCR Batang", weight: 700, files: ["HCRBatang-Bold.ttf", "HANBatangB.ttf", "HANBatangB.TTF", "hanbatangb.ttf", "hanbatang-bold.ttf"] },
  { family: "함초롬돋움", weight: 400, files: ["HCRDotum.ttf", "HANDotum.ttf", "HANDotum.TTF", "handotum.ttf"] },
  { family: "함초롬돋움", weight: 700, files: ["HCRDotum-Bold.ttf", "HANDotumB.ttf", "HANDotumB.TTF", "handotumb.ttf", "handotum-bold.ttf"] },
  { family: "HCR Dotum", weight: 400, files: ["HCRDotum.ttf", "HANDotum.ttf", "HANDotum.TTF", "handotum.ttf"] },
  { family: "HCR Dotum", weight: 700, files: ["HCRDotum-Bold.ttf", "HANDotumB.ttf", "HANDotumB.TTF", "handotumb.ttf", "handotum-bold.ttf"] },
];
const GENERIC_FONT_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
const HWP_TEXT_BASELINE_FACTOR = 0.85;
const HWP_TEXT_LINE_HEIGHT_FACTOR = 1.2;
const HWP_TABLE_RIGHT_PADDING = 7;
const HWP_TABLE_WRAP_TOLERANCE = 0.98;

function decodeBase64(content: string): Uint8Array {
  const raw = window.atob(content);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

async function fetchRuntimeHwpFontManifest(): Promise<{ files: Set<string>; error: string | null }> {
  hwpRuntimeFontManifestPromise ??= fetch("/studio/hwp-fonts")
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json() as { files?: Array<{ name?: unknown }> };
      const files = new Set(
        Array.isArray(payload.files)
          ? payload.files.map((file) => file.name).filter((name): name is string => typeof name === "string")
          : [],
      );
      return { files, error: null };
    })
    .catch((error) => ({
      files: new Set<string>(),
      error: error instanceof Error ? error.message : "런타임 HWP 폰트 목록을 읽지 못했습니다.",
    }));

  return hwpRuntimeFontManifestPromise;
}

async function ensureRuntimeHwpFontFaces(): Promise<{ files: Set<string>; error: string | null }> {
  const manifest = await fetchRuntimeHwpFontManifest();
  if (hwpRuntimeFontStyleInjected || manifest.files.size === 0) {
    return manifest;
  }

  const rules = HWP_RUNTIME_FONT_FACES
    .map((fontFace) => {
      const fileName = fontFace.files.find((candidate) => manifest.files.has(candidate));
      if (!fileName) {
        return null;
      }
      return `
@font-face {
  font-family: "${fontFace.family}";
  src: url("/studio/hwp-fonts/${encodeURIComponent(fileName)}") format("truetype");
  font-weight: ${fontFace.weight};
  font-style: normal;
  font-display: swap;
}`;
    })
    .filter((rule): rule is string => Boolean(rule));

  if (rules.length > 0) {
    const style = document.createElement("style");
    style.dataset.kumaHwpRuntimeFonts = "true";
    style.textContent = rules.join("\n");
    document.head.appendChild(style);
    hwpRuntimeFontStyleInjected = true;
  }

  return manifest;
}

function ensureMeasureTextWidth() {
  const global = globalThis as typeof globalThis & {
    measureTextWidth?: (font: string, text: string) => number;
  };
  if (typeof global.measureTextWidth === "function") {
    return;
  }
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let lastFont = "";
  global.measureTextWidth = (font, text) => {
    canvas ??= document.createElement("canvas");
    context ??= canvas.getContext("2d");
    if (!context) {
      return text.length * 8;
    }
    const measuredFont = normalizeHwpFont(font);
    if (measuredFont !== lastFont) {
      context.font = measuredFont;
      lastFont = measuredFont;
    }
    return context.measureText(text).width;
  };
}

function normalizeHwpFont(font: string): string {
  const exactFamily = extractFontFamily(font);
  if (exactFamily && isFontFamilyAvailable(exactFamily)) {
    return font;
  }

  const fallback = findHwpFontFallback(exactFamily ?? font);
  if (fallback) {
    return replaceCssFontFamily(font, fallback.family);
  }
  return font;
}

function extractFontFamily(font: string): string | null {
  const parsed = splitCssFont(font);
  if (!parsed) {
    return stripFontQuotes(font.trim()) || null;
  }
  return parseFontFamilyList(parsed.family)[0] ?? stripFontQuotes(parsed.family.trim()) ?? null;
}

function splitCssFont(font: string): { prefix: string; family: string } | null {
  const trimmed = font.trim();
  const quoted = trimmed.match(/^(.*?)(["'])([^"']+)\2\s*$/u);
  if (quoted?.[1] !== undefined && quoted[3]) {
    return { prefix: quoted[1], family: quoted[3] };
  }

  const sized = trimmed.match(/^(.+?(?:\d+(?:\.\d+)?(?:px|pt|em|rem|pc|in|cm|mm|%))(?:\/[^\s]+)?\s+)(.+)$/iu);
  if (sized?.[1] && sized[2]) {
    return { prefix: sized[1], family: sized[2].trim() };
  }

  return null;
}

function replaceCssFontFamily(font: string, family: string): string {
  const parsed = splitCssFont(font);
  return parsed ? `${parsed.prefix}${family}` : font;
}

function stripFontQuotes(value: string): string {
  return value.replace(/^["']|["']$/gu, "").trim();
}

function parseFontFamilyList(value: string): string[] {
  const families: string[] = [];
  const pattern = /"([^"]+)"|'([^']+)'|([^,]+)/gu;
  for (const match of value.matchAll(pattern)) {
    const family = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (family) {
      families.push(stripFontQuotes(family));
    }
  }
  return families;
}

function formatFontFamily(family: string): string {
  return GENERIC_FONT_FAMILIES.has(family.toLowerCase()) ? family : `"${family.replace(/"/gu, '\\"')}"`;
}

function findHwpFontFallback(font: string): { pattern: RegExp; family: string } | null {
  return HWP_FONT_FALLBACKS.find((fallback) => fallback.pattern.test(font)) ?? null;
}

function isFontFamilyAvailable(font: string): boolean {
  if (GENERIC_FONT_FAMILIES.has(font.toLowerCase())) {
    return true;
  }

  // FontFaceSet.check() can still be true when the browser can render through
  // fallback fonts. Compare against impossible-family baselines so missing HWP
  // fonts remain visible instead of silently passing.
  fontProbeCanvas ??= document.createElement("canvas");
  fontProbeContext ??= fontProbeCanvas.getContext("2d");
  if (!fontProbeContext) {
    return false;
  }

  const probeText = "mmmmmmmmmmWWWWW한글테스트0123456789";
  const familyName = formatFontFamily(font);
  return ["monospace", "serif", "sans-serif"].some((genericFamily) => {
    fontProbeContext!.font = `72px ${familyName}, ${genericFamily}`;
    const candidateWidth = fontProbeContext!.measureText(probeText).width;
    fontProbeContext!.font = `72px "__kuma_missing_hwp_font__", ${genericFamily}`;
    const baselineWidth = fontProbeContext!.measureText(probeText).width;
    return Math.abs(candidateWidth - baselineWidth) > 0.5;
  });
}

function normalizeSvgFontFamilyValue(value: string): string {
  const existingFamilies = parseFontFamilyList(value);
  const primaryFamily = existingFamilies[0] ?? value.trim();
  const fallback = findHwpFontFallback(primaryFamily);
  if (!fallback) {
    return value;
  }

  const mergedFamilies = [...existingFamilies, ...parseFontFamilyList(fallback.family)];
  const uniqueFamilies = Array.from(new Set(mergedFamilies.filter(Boolean)));
  return uniqueFamilies.map(formatFontFamily).join(", ");
}

function normalizeSvgFontFamilies(svg: string, textLayout: HwpPageTextLayout, controlLayout: HwpPageControlLayout): string {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(svg, "image/svg+xml");
  if (parsed.querySelector("parsererror")) {
    return svg;
  }

  parsed.querySelectorAll("[font-family], [style]").forEach((element) => {
    const fontFamily = element.getAttribute("font-family");
    if (fontFamily) {
      element.setAttribute("font-family", normalizeSvgFontFamilyValue(fontFamily));
    }

    const style = element.getAttribute("style");
    if (style?.includes("font-family")) {
      element.setAttribute(
        "style",
        style.replace(/font-family\s*:\s*([^;]+)/giu, (_match, family) => `font-family: ${normalizeSvgFontFamilyValue(String(family))}`),
      );
    }
  });

  replaceSvgTextWithLayout(parsed, textLayout, controlLayout);

  return new XMLSerializer().serializeToString(parsed.documentElement);
}

function replaceSvgTextWithLayout(documentNode: XMLDocument, textLayout: HwpPageTextLayout, controlLayout: HwpPageControlLayout) {
  const root = documentNode.documentElement;
  const runs = Array.isArray(textLayout.runs)
    ? textLayout.runs.filter((run) => typeof run.text === "string" && run.text.length > 0 && isFiniteNumber(run.x) && isFiniteNumber(run.y))
    : [];
  const tableCells = collectTableCells(controlLayout);
  const tableGroups = groupTableTextRuns(runs, tableCells);
  const groupedRuns = new Set<HwpTextLayoutRun>();

  root.querySelectorAll("text").forEach((element) => element.remove());

  for (const group of tableGroups) {
    group.runs.forEach((run) => groupedRuns.add(run));
  }

  for (const groupSet of groupTableTextByCell(tableGroups)) {
    appendWrappedTableCellText(root, groupSet);
  }

  for (const run of runs) {
    if (groupedRuns.has(run)) {
      continue;
    }
    appendLayoutText(root, run, run.text ?? "", run.x ?? 0, (run.y ?? 0) + getRunHeight(run) * HWP_TEXT_BASELINE_FACTOR);
  }
}

function collectTableCells(controlLayout: HwpPageControlLayout): HwpResolvedTableCell[] {
  const cells: HwpResolvedTableCell[] = [];
  for (const control of controlLayout.controls ?? []) {
    if (control.type !== "table" || !isFiniteNumber(control.paraIdx) || !isFiniteNumber(control.controlIdx)) {
      continue;
    }
    for (const cell of control.cells ?? []) {
      if (!isFiniteNumber(cell.cellIdx) || !isFiniteNumber(cell.x) || !isFiniteNumber(cell.y) || !isFiniteNumber(cell.w) || !isFiniteNumber(cell.h)) {
        continue;
      }
      cells.push({
        paraIdx: control.paraIdx,
        controlIdx: control.controlIdx,
        cellIdx: cell.cellIdx,
        x: cell.x,
        y: cell.y,
        w: cell.w,
        h: cell.h,
      });
    }
  }
  return cells;
}

function groupTableTextRuns(runs: HwpTextLayoutRun[], cells: HwpResolvedTableCell[]) {
  const groups = new Map<string, { cell: HwpResolvedTableCell; y: number; x: number; runs: HwpTextLayoutRun[] }>();
  const cellByKey = new Map(cells.map((cell) => [getTableCellKey(cell.paraIdx, cell.controlIdx, cell.cellIdx), cell]));

  for (const run of runs) {
    if (!isFiniteNumber(run.parentParaIdx) || !isFiniteNumber(run.controlIdx) || !isFiniteNumber(run.cellIdx) || !isFiniteNumber(run.y) || !isFiniteNumber(run.x)) {
      continue;
    }
    const cell = cellByKey.get(getTableCellKey(run.parentParaIdx, run.controlIdx, run.cellIdx));
    if (!cell) {
      continue;
    }
    const y = Math.round(run.y * 10) / 10;
    const key = `${getTableCellKey(cell.paraIdx, cell.controlIdx, cell.cellIdx)}|${run.cellParaIdx ?? 0}|${y}`;
    const group = groups.get(key) ?? { cell, y: run.y, x: run.x, runs: [] };
    group.y = Math.min(group.y, run.y);
    group.x = Math.min(group.x, run.x);
    group.runs.push(run);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, runs: group.runs.sort((a, b) => (a.x ?? 0) - (b.x ?? 0)) }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function groupTableTextByCell(
  groups: Array<{ cell: HwpResolvedTableCell; y: number; x: number; runs: HwpTextLayoutRun[] }>,
) {
  const byCell = new Map<HwpResolvedTableCell, Array<{ cell: HwpResolvedTableCell; y: number; x: number; runs: HwpTextLayoutRun[] }>>();
  for (const group of groups) {
    const cellGroups = byCell.get(group.cell) ?? [];
    cellGroups.push(group);
    byCell.set(group.cell, cellGroups);
  }
  return Array.from(byCell.values()).map((cellGroups) => cellGroups.sort((a, b) => a.y - b.y || a.x - b.x));
}

function appendWrappedTableCellText(
  root: Element,
  groups: Array<{ cell: HwpResolvedTableCell; y: number; x: number; runs: HwpTextLayoutRun[] }>,
) {
  const firstGroup = groups[0];
  const firstRun = firstGroup?.runs[0];
  if (!firstGroup || !firstRun) {
    return;
  }

  const items = groups.map((group) => {
    const run = group.runs[0]!;
    const text = group.runs.map((layoutRun) => layoutRun.text ?? "").join("");
    const fontSize = getRunFontSize(run);
    const lineHeight = Math.max(getRunHeight(run), fontSize * HWP_TEXT_LINE_HEIGHT_FACTOR);
    const rightEdge = group.cell.x + group.cell.w - HWP_TABLE_RIGHT_PADDING;
    const availableWidth = Math.max(fontSize, (rightEdge - group.x) * HWP_TABLE_WRAP_TOLERANCE);
    const lines = wrapLayoutText(run, text, availableWidth);
    return {
      group,
      run,
      lines,
      lineHeight,
      height: lineHeight * lines.length,
      gap: fontSize * 0.15,
    };
  });

  const totalHeight = items.reduce((sum, item, index) => sum + item.height + (index === items.length - 1 ? 0 : item.gap), 0);
  let top = groups.length === 1
    ? firstGroup.cell.y + Math.max(0, (firstGroup.cell.h - totalHeight) / 2)
    : firstGroup.cell.y + Math.max(4, getRunFontSize(firstRun) * 0.45);

  for (const item of items) {
    item.lines.forEach((line, index) => {
      appendLayoutText(root, item.run, line, item.group.x, top + index * item.lineHeight + getRunHeight(item.run) * HWP_TEXT_BASELINE_FACTOR);
    });
    top += item.height + item.gap;
  }
}

function wrapLayoutText(run: HwpTextLayoutRun, text: string, maxWidth: number): string[] {
  if (measureLayoutTextWidth(run, text) <= maxWidth) {
    return [text];
  }

  const tokens = tokenizeWrapText(text);
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = `${current}${token}`;
    if (!current || measureLayoutTextWidth(run, candidate.trimEnd()) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current.trimEnd());
    current = token.trimStart();
    if (measureLayoutTextWidth(run, current) > maxWidth) {
      const broken = breakLongToken(run, current, maxWidth);
      lines.push(...broken.slice(0, -1));
      current = broken[broken.length - 1] ?? "";
    }
  }
  if (current) {
    lines.push(current.trimEnd());
  }
  return lines.length > 0 ? lines.map((line) => line.replace(/\s+\(/gu, "(")) : [text];
}

function tokenizeWrapText(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of Array.from(text)) {
    if (/\s/u.test(char)) {
      current += char;
      tokens.push(current);
      current = "";
      continue;
    }

    if (/[\uac00-\ud7af\u3130-\u318f\u4e00-\u9fff]/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      tokens.push(char);
      continue;
    }

    current += char;
    if (/[(){}\[\],.;:·/\\-]/u.test(char)) {
      tokens.push(current);
      current = "";
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens.length > 0 ? tokens : [text];
}

function breakLongToken(run: HwpTextLayoutRun, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const char of Array.from(text)) {
    const candidate = `${current}${char}`;
    if (!current || measureLayoutTextWidth(run, candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = char;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function appendLayoutText(root: Element, run: HwpTextLayoutRun, text: string, x: number, y: number) {
  const element = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "text");
  element.textContent = text;
  element.setAttribute("x", String(x));
  element.setAttribute("y", String(y));
  element.setAttribute("font-family", normalizeSvgFontFamilyValue(run.fontFamily ?? "serif"));
  element.setAttribute("font-size", String(getRunFontSize(run)));
  if (run.bold) {
    element.setAttribute("font-weight", "700");
  }
  if (run.italic) {
    element.setAttribute("font-style", "italic");
  }
  element.setAttribute("fill", run.textColor ?? "#000000");
  element.setAttribute("xml:space", "preserve");
  root.appendChild(element);
}

function getTableCellKey(parentParaIdx: number, controlIdx: number, cellIdx: number): string {
  return `${parentParaIdx}|${controlIdx}|${cellIdx}`;
}

function getRunFontSize(run: HwpTextLayoutRun): number {
  return typeof run.fontSize === "number" && Number.isFinite(run.fontSize) ? run.fontSize : 12;
}

function getRunHeight(run: HwpTextLayoutRun): number {
  return typeof run.h === "number" && Number.isFinite(run.h) ? run.h : getRunFontSize(run);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function measureLayoutTextWidth(run: HwpTextLayoutRun, text: string): number {
  fontProbeCanvas ??= document.createElement("canvas");
  fontProbeContext ??= fontProbeCanvas.getContext("2d");
  if (!fontProbeContext) {
    return text.length * getRunFontSize(run) * 0.75;
  }

  const fontStyle = run.italic ? "italic" : "normal";
  const fontWeight = run.bold ? "700" : "400";
  const fontFamily = normalizeSvgFontFamilyValue(run.fontFamily ?? "serif");
  fontProbeContext.font = `${fontStyle} ${fontWeight} ${getRunFontSize(run)}px ${fontFamily}`;
  return fontProbeContext.measureText(text).width;
}

async function ensureHwpFontsReady(): Promise<{ files: Set<string>; error: string | null }> {
  const runtimeFonts = await ensureRuntimeHwpFontFaces();

  if (!hwpFontLinkInjected) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;900&family=Noto+Serif+KR:wght@400;500;600;700;900&family=Nanum+Gothic:wght@400;700;800&family=Nanum+Myeongjo:wght@400;700;800&display=swap";
    document.head.appendChild(link);
    hwpFontLinkInjected = true;
  }

  if (!document.fonts?.load) {
    return runtimeFonts;
  }

  await Promise.allSettled([
    document.fonts.load('12pt "함초롬바탕"'),
    document.fonts.load('12pt "함초롬돋움"'),
    document.fonts.load('12pt "HCR Batang"'),
    document.fonts.load('12pt "HCR Dotum"'),
    document.fonts.load('12pt "Noto Sans KR"'),
    document.fonts.load('12pt "Noto Serif KR"'),
    document.fonts.load('12pt "Nanum Gothic"'),
    document.fonts.load('12pt "Nanum Myeongjo"'),
  ]);
  await document.fonts.ready;
  return runtimeFonts;
}

function parseFontsUsed(documentInfo: string): string[] {
  try {
    const parsed = JSON.parse(documentInfo) as { fontsUsed?: unknown };
    return Array.isArray(parsed.fontsUsed)
      ? parsed.fontsUsed.filter((font): font is string => typeof font === "string" && font.length > 0)
      : [];
  } catch {
    return [];
  }
}

function detectMissingFonts(fontsUsed: string[]): string[] {
  return fontsUsed.filter((font) => !isFontFamilyAvailable(font));
}

function countValidationWarnings(warnings: string): number {
  try {
    const parsed = JSON.parse(warnings) as { count?: unknown };
    return typeof parsed.count === "number" ? parsed.count : 0;
  } catch {
    return 0;
  }
}

function parsePageTextLayout(layout: string): HwpPageTextLayout {
  const parsed = JSON.parse(layout) as HwpPageTextLayout;
  return { runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
}

function parsePageControlLayout(layout: string): HwpPageControlLayout {
  const parsed = JSON.parse(layout) as HwpPageControlLayout;
  return { controls: Array.isArray(parsed.controls) ? parsed.controls : [] };
}

export function HwpViewer({ content, mimeType, filePath, onClose, inline }: HwpViewerProps) {
  const [renderState, setRenderState] = useState<HwpRenderState>({ status: "loading" });
  const fileName = filePath.split("/").pop() || filePath;
  const badge = mimeType === "application/x-hwpx" || fileName.toLowerCase().endsWith(".hwpx") ? "HWPX" : "HWP";
  const byteSize = useMemo(() => Math.floor((content.length * 3) / 4), [content]);

  useEffect(() => {
    let cancelled = false;
    setRenderState({ status: "loading" });

    void (async () => {
      try {
        ensureMeasureTextWidth();
        const runtimeFontStatus = await ensureHwpFontsReady();
        const rhwp = await import("@rhwp/core");
        rhwpInitPromise ??= rhwp.default({ module_or_path: rhwpWasmUrl })
          .then(() => undefined)
          .catch((error) => {
            rhwpInitPromise = null;
            throw error;
          });
        await rhwpInitPromise;
        const doc = new rhwp.HwpDocument(decodeBase64(content));
        try {
          const fontsUsed = parseFontsUsed(doc.getDocumentInfo?.() ?? "{}");
          const validationWarningCount = countValidationWarnings(doc.getValidationWarnings?.() ?? "{}");
          const reflowedLinesegs = validationWarningCount > 0
            ? doc.reflowLinesegs?.() ?? 0
            : 0;
          const missingFonts = detectMissingFonts(fontsUsed);
          const pageCount = doc.pageCount();
          const pages = Array.from(
            { length: pageCount },
            (_, index) => normalizeSvgFontFamilies(
              doc.renderPageSvg(index),
              parsePageTextLayout(doc.getPageTextLayout(index)),
              parsePageControlLayout(doc.getPageControlLayout(index)),
            ),
          );
          if (!cancelled) {
            setRenderState({
              status: "ready",
              pages,
              fontsUsed,
              missingFonts,
              runtimeFontFiles: Array.from(runtimeFontStatus.files).sort(),
              fontAssetError: runtimeFontStatus.error,
              reflowedLinesegs,
              validationWarningCount,
            });
          }
        } finally {
          doc.free?.();
        }
      } catch (error) {
        if (!cancelled) {
          setRenderState({
            status: "error",
            message: error instanceof Error ? error.message : "HWP 렌더링에 실패했습니다.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content]);

  const viewer = (
    <div
      className={
        inline
          ? "flex h-full w-full flex-col overflow-hidden"
          : "relative mx-4 flex max-h-[85vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)]"
      }
      onClick={inline ? undefined : (event) => event.stopPropagation()}
      style={{
        background: "var(--ide-bg-alt)",
        borderColor: "var(--card-border)",
        ...(inline ? {} : { animation: "slideUp 200ms ease-out" }),
      }}
    >
      <div className="flex items-center border-b" style={{ borderColor: "var(--card-border)", background: `linear-gradient(to bottom, var(--ide-header-from), var(--ide-header-to))` }}>
        <div className="flex min-w-0 items-center gap-2 border-b-2 border-amber-400 px-4 py-2" style={{ background: "var(--ide-bg-alt)" }}>
          <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M4.5 1.5h5l3 3v9.5a1 1 0 01-1 1h-7a1 1 0 01-1-1v-11.5a1 1 0 011-1z" />
            <path d="M9.5 1.5v3h3" />
          </svg>
          <span className="truncate text-[12px] font-medium" style={{ color: "var(--t-secondary)" }}>{fileName}</span>
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
            {badge}
          </span>
        </div>
        <div className="flex-1" />
        <span className="mr-2 rounded px-2 py-0.5 text-[10px] font-medium" style={{ color: "var(--t-faint)", background: "var(--badge-bg)" }}>
          읽기 전용
        </span>
        <button
          type="button"
          disabled
          className="mr-1 shrink-0 rounded px-2 py-0.5 text-[10px] font-medium opacity-50"
          style={{ color: "var(--t-faint)" }}
          title="@rhwp/editor 저장/export API 검증 전까지 편집 저장을 열지 않습니다."
        >
          편집 저장 미지원
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mr-2 shrink-0 rounded p-1 transition-colors"
          style={{ color: "var(--t-faint)" }}
          title="닫기 (Esc)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5" style={{ background: "#f8fafc" }}>
        {renderState.status === "loading" && (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-2 rounded-lg border px-4 py-2 shadow-sm" style={{ background: "white", borderColor: "var(--border-subtle)" }}>
              <svg width="14" height="14" viewBox="0 0 12 12" className="animate-spin text-amber-500">
                <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 14" strokeLinecap="round" />
              </svg>
              <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>HWP 렌더링 중...</span>
            </div>
          </div>
        )}

        {renderState.status === "error" && (
          <div className="mx-auto mt-10 max-w-md rounded-xl border bg-white p-5 text-center shadow-sm" style={{ borderColor: "var(--border-subtle)" }}>
            <p className="text-[13px] font-bold text-red-500">HWP 렌더링 실패</p>
            <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>{renderState.message}</p>
            <p className="mt-3 text-[10px]" style={{ color: "var(--t-faint)" }}>
              원본 파일은 변경하지 않았습니다. {byteSize.toLocaleString()} bytes
            </p>
          </div>
        )}

        {renderState.status === "ready" && (
          <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-5">
            {(renderState.fontAssetError || renderState.runtimeFontFiles.length === 0) && (
              <div className="rounded-lg border bg-slate-50 px-4 py-3 text-[11px] text-slate-700" style={{ borderColor: "rgba(100, 116, 139, 0.22)" }}>
                <p className="font-bold">HWP 전용 런타임 폰트</p>
                <p className="mt-1">
                  {renderState.fontAssetError
                    ? `폰트 목록을 읽지 못했습니다: ${renderState.fontAssetError}`
                    : "~/.kuma/studio/fonts/hwp 에 설치된 HWP 전용 폰트가 없습니다."}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  함초롬체 등 원본 폰트를 넣으면 Canvas 측정과 SVG 표시가 같은 파일을 기준으로 맞춰집니다.
                </p>
              </div>
            )}
            {renderState.missingFonts.length > 0 && (
              <div className="rounded-lg border bg-amber-50 px-4 py-3 text-[11px] text-amber-800" style={{ borderColor: "rgba(245, 158, 11, 0.28)" }}>
                <p className="font-bold">누락 폰트 감지</p>
                <p className="mt-1">
                  {renderState.missingFonts.join(", ")}
                </p>
                <p className="mt-1 text-[10px] text-amber-700/80">
                  현재는 rhwp 권장 Noto/Nanum 계열을 로드한 뒤 렌더링합니다. 원본 폰트를 설치하면 배치 정확도가 더 좋아질 수 있습니다.
                </p>
              </div>
            )}
            {(renderState.reflowedLinesegs > 0 || renderState.validationWarningCount > 0) && (
              <div className="rounded-lg border bg-emerald-50 px-4 py-3 text-[11px] text-emerald-800" style={{ borderColor: "rgba(16, 185, 129, 0.22)" }}>
                <p className="font-bold">{renderState.reflowedLinesegs > 0 ? "레이아웃 보정 적용" : "원본 줄 배치 유지"}</p>
                <p className="mt-1">
                  {renderState.reflowedLinesegs > 0
                    ? `줄 배치 정보를 현재 브라우저 폰트 측정값 기준으로 다시 계산했습니다. reflow ${renderState.reflowedLinesegs.toLocaleString()}문단`
                    : "WebHWP와 같은 원본 HWP 줄 배치값을 우선 사용하고, 브라우저 기준 자동 재계산은 적용하지 않았습니다."}
                  {renderState.validationWarningCount > 0 ? ` 원본 lineseg 경고 ${renderState.validationWarningCount.toLocaleString()}건` : ""}
                </p>
              </div>
            )}
            {renderState.pages.map((svg, index) => (
              <div key={index} className="w-fit max-w-full rounded-lg bg-white p-4 shadow-[0_8px_30px_-18px_rgba(15,23,42,0.45)]">
                <div className="mb-2 text-[10px] font-semibold text-slate-400">Page {index + 1}</div>
                <div
                  className="hwp-page overflow-hidden"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t px-4 py-1.5" style={{ borderColor: "var(--border-subtle)", background: `linear-gradient(to bottom, var(--ide-header-to), var(--ide-header-from))` }}>
        <span className="truncate text-[10px]" style={{ color: "var(--t-faint)" }}>{filePath}</span>
        <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
          {byteSize.toLocaleString()} bytes
        </span>
      </div>

      <style>{`
        .hwp-page svg { display: block; width: auto; max-width: 100%; height: auto; }
      `}</style>
    </div>
  );

  if (inline) return viewer;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[6px]"
      onClick={onClose}
      style={{ animation: "fadeIn 150ms ease-out" }}
    >
      {viewer}
    </div>
  );
}
