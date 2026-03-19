"use client";

import { toPng } from "html-to-image";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_KUMA_PICKER_NOTE_SESSION_ID,
  fetchKumaPickerAgentNote,
  parseKumaPickerAgentNoteEvent,
  type KumaPickerAgentNoteRecord,
  getKumaPickerAgentNoteStatusLabel,
} from "../../lib/devtools/agent-note";
import {
  type DevSelectionCollection,
  type DevSelectionElementRecord,
  type DevSelectionRecord,
  type DevSelectionRect,
  type DevSelectionSaveElementRecord,
  type DevSelectionSaveRecord,
  type DevSelectionSessionRecord,
  type DevSelectionSnapshotPayload,
  type DevSelectionSnapshotRecord,
  getKumaPickerDevSelectionAssetUrl,
  getKumaPickerDevSelectionEndpoint,
  getKumaPickerDevSelectionSessionEndpoint,
} from "../../lib/devtools/dev-selection";
import { createSceneEventSource } from "../../lib/scene-daemon";

interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SelectionEdges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface SelectionBoxModel {
  margin: SelectionEdges;
  padding: SelectionEdges;
  border: SelectionEdges;
  marginRect: SelectionRect;
  paddingRect: SelectionRect;
  contentRect: SelectionRect;
}

interface SelectionTypography {
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
}

interface SelectionGapRect extends SelectionRect {
  axis: "row" | "column";
  size: number;
}

interface SelectionGapInfo {
  row: number;
  column: number;
  rects: SelectionGapRect[];
}

interface SelectionPreview {
  id: string;
  label: string;
  selector: string;
  rect: SelectionRect;
  boxModel: SelectionBoxModel;
  gap: SelectionGapInfo;
  typography: SelectionTypography | null;
  snapshot: DevSelectionSnapshotRecord | null;
}

interface SavedSelectionTarget {
  id: string;
  liveElement: Element | null;
  record: DevSelectionElementRecord;
  snapshot: DevSelectionSnapshotRecord | null;
}

interface FloatingPosition {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startPosition: FloatingPosition;
  lastPosition: FloatingPosition;
  lastTimestamp: number;
  velocityX: number;
  velocityY: number;
  moved: boolean;
}

interface AreaSelectionDragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  shiftKey: boolean;
  dragging: boolean;
}

const ROOT_MARGIN = 20;
const DRAG_THRESHOLD = 6;
const FLING_STOP_SPEED = 0.008;
const FLING_VELOCITY_LIMIT = 2.8;
const PICKER_POSITION_STORAGE_KEYS = ["kuma-picker:picker-position"] as const;
const PICKER_SESSION_ID_STORAGE_KEYS = ["kuma-picker:session-id"] as const;
const SNAPSHOT_MAX_PIXELS = 2_400_000;
const SNAPSHOT_MIN_PIXEL_RATIO = 0.75;
const SNAPSHOT_MAX_PIXEL_RATIO = 2;
const PRECISE_TEXT_TAGS = new Set([
  "p",
  "span",
  "strong",
  "em",
  "small",
  "code",
  "pre",
  "blockquote",
  "li",
  "dt",
  "dd",
  "figcaption",
  "caption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "label",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[aria-controls]",
].join(", ");

function FilledCursorIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
    </svg>
  );
}

function parseStoredPosition(rawValue: string | null): FloatingPosition | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<FloatingPosition>;
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y)
    ) {
      return null;
    }

    return {
      x: parsed.x,
      y: parsed.y,
    };
  } catch {
    return null;
  }
}

function cssEscape(value: string) {
  if (typeof window !== "undefined" && typeof window.CSS?.escape === "function") {
    return window.CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function createSessionId() {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readStoredValue(storage: Storage, keys: readonly string[]) {
  for (const key of keys) {
    const value = storage.getItem(key);
    if (value) {
      return value;
    }
  }

  return null;
}

function writeStoredValue(storage: Storage, keys: readonly string[], value: string) {
  storage.setItem(keys[0], value);

  for (const key of keys.slice(1)) {
    storage.removeItem(key);
  }
}

function clearStoredValues(storage: Storage, keys: readonly string[]) {
  for (const key of keys) {
    storage.removeItem(key);
  }
}

function getOrCreateSessionId() {
  if (typeof window === "undefined") {
    return createSessionId();
  }

  const stored = readStoredValue(
    window.sessionStorage,
    PICKER_SESSION_ID_STORAGE_KEYS,
  );
  if (stored) {
    return stored;
  }

  const nextId = createSessionId();
  writeStoredValue(
    window.sessionStorage,
    PICKER_SESSION_ID_STORAGE_KEYS,
    nextId,
  );
  return nextId;
}

function findElementForRecord(record: DevSelectionElementRecord): Element | null {
  if (record.selector.startsWith("area:")) {
    return null;
  }

  const selectors = [record.selectorPath, record.selector].filter(Boolean);

  for (const selector of selectors) {
    try {
      const target = document.querySelector(selector);
      if (target) {
        return target;
      }
    } catch {
      // Ignore invalid selectors and keep trying fallbacks.
    }
  }

  return null;
}

function createLabel(element: Element) {
  const tagName = element.tagName.toLowerCase();
  const id = "id" in element && element.id ? `#${element.id}` : "";
  const className =
    "classList" in element && element.classList.length > 0 ? `.${Array.from(element.classList).slice(0, 2).join(".")}` : "";

  return `${tagName}${id}${className}`;
}

function createLabelFromRecord(record: DevSelectionElementRecord) {
  if (record.selector.startsWith("area:")) {
    return `area ${Math.round(record.rect.width)}x${Math.round(record.rect.height)}`;
  }

  const id = record.id ? `#${record.id}` : "";
  const className = record.classNames.length > 0 ? `.${record.classNames.slice(0, 2).join(".")}` : "";
  return `${record.tagName}${id}${className}`;
}

function getCandidateArea(element: Element) {
  const rect = element.getBoundingClientRect();
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function isInteractiveElement(element: Element) {
  const tagName = element.tagName.toLowerCase();
  return (
    tagName === "button" ||
    tagName === "a" ||
    tagName === "label" ||
    tagName === "summary" ||
    Boolean(element.getAttribute("role")) ||
    element.hasAttribute("contenteditable")
  );
}

function getTextPointTarget(clientX: number, clientY: number) {
  if (typeof document.caretPositionFromPoint === "function") {
    const caretPosition = document.caretPositionFromPoint(clientX, clientY);
    const node = caretPosition?.offsetNode;
    if (node instanceof Element) {
      return node;
    }

    if (node?.parentElement) {
      return node.parentElement;
    }
  }

  if (typeof document.caretRangeFromPoint === "function") {
    const caretRange = document.caretRangeFromPoint(clientX, clientY);
    const node = caretRange?.startContainer;
    if (node instanceof Element) {
      return node;
    }

    if (node?.parentElement) {
      return node.parentElement;
    }
  }

  return null;
}

function isMeaningfulTarget(element: Element) {
  if (isPickerElement(element)) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === "html" || tagName === "body" || tagName === "main") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return false;
  }

  if (
    tagName === "textarea" ||
    tagName === "input" ||
    tagName === "button" ||
    tagName === "select" ||
    tagName === "label" ||
    tagName === "img" ||
    tagName === "video" ||
    tagName === "canvas" ||
    tagName === "svg" ||
    tagName === "a"
  ) {
    return true;
  }

  const styles = window.getComputedStyle(element);
  const hasVisibleBorder =
    parsePixels(styles.borderTopWidth) +
      parsePixels(styles.borderRightWidth) +
      parsePixels(styles.borderBottomWidth) +
      parsePixels(styles.borderLeftWidth) >
    0;
  const hasVisibleFill =
    styles.backgroundColor !== "rgba(0, 0, 0, 0)" && styles.backgroundColor !== "transparent";
  const hasText = getTextPreview(element).length > 0;
  const hasSemanticHook =
    Boolean(element.getAttribute("role")) ||
    Boolean(element.getAttribute("data-agent-id")) ||
    Boolean(element.getAttribute("data-testid")) ||
    ("id" in element && Boolean(element.id));
  const isLargeGenericContainer =
    (tagName === "div" || tagName === "section") &&
    element.children.length > 0 &&
    getCandidateArea(element) > window.innerWidth * window.innerHeight * 0.45 &&
    !hasVisibleBorder &&
    !hasVisibleFill;

  if (isLargeGenericContainer) {
    return false;
  }

  return hasVisibleBorder || hasVisibleFill || hasSemanticHook || hasText;
}

function shouldPreferPresentationContainer(element: Element) {
  const tagName = element.tagName.toLowerCase();
  if (
    tagName === "textarea" ||
    tagName === "input" ||
    tagName === "select" ||
    element.getAttribute("role") === "textbox" ||
    element.hasAttribute("contenteditable")
  ) {
    return true;
  }

  const hasText = getTextPreview(element).length > 0;
  const isLeafLike = element.children.length <= 1;
  return hasText && isLeafLike && (tagName === "p" || tagName === "span" || tagName === "div");
}

function shouldKeepPreciseTextTarget(element: Element) {
  const tagName = element.tagName.toLowerCase();
  if (!PRECISE_TEXT_TAGS.has(tagName)) {
    return false;
  }

  if (isInteractiveElement(element)) {
    return false;
  }

  const textPreview = getTextPreview(element);
  if (!textPreview) {
    return false;
  }

  const parent = element.parentElement;
  if (parent && isInteractiveElement(parent)) {
    return false;
  }

  const area = getCandidateArea(element);
  const viewportArea = window.innerWidth * window.innerHeight;
  return area > 0 && area <= viewportArea * 0.2;
}

function getPresentationContainer(element: Element) {
  const interactiveAncestor = element.closest(INTERACTIVE_SELECTOR);
  if (interactiveAncestor && !isPickerElement(interactiveAncestor)) {
    return interactiveAncestor;
  }

  if (shouldKeepPreciseTextTarget(element)) {
    return element;
  }

  if (!shouldPreferPresentationContainer(element)) {
    return element;
  }

  const baseArea = getCandidateArea(element);
  let current = element.parentElement;

  while (current && current.tagName.toLowerCase() !== "body") {
    if (isPickerElement(current)) {
      break;
    }

    const styles = window.getComputedStyle(current);
    const paddingTotal =
      parsePixels(styles.paddingTop) +
      parsePixels(styles.paddingRight) +
      parsePixels(styles.paddingBottom) +
      parsePixels(styles.paddingLeft);
    const borderTotal =
      parsePixels(styles.borderTopWidth) +
      parsePixels(styles.borderRightWidth) +
      parsePixels(styles.borderBottomWidth) +
      parsePixels(styles.borderLeftWidth);
    const hasVisibleFill =
      styles.backgroundColor !== "rgba(0, 0, 0, 0)" && styles.backgroundColor !== "transparent";
    const hasFrame = borderTotal > 0 || hasVisibleFill || paddingTotal >= 8;
    const area = getCandidateArea(current);

    if (
      hasFrame &&
      area >= baseArea * 1.05 &&
      area <= window.innerWidth * window.innerHeight * 0.8 &&
      isMeaningfulTarget(current)
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return element;
}

function getPreferredSelectionTarget(
  clientX: number,
  clientY: number,
  eventTarget?: EventTarget | null,
  eventPath?: EventTarget[],
) {
  if (
    (eventTarget instanceof Element && isPickerElement(eventTarget)) ||
    (eventPath ?? []).some(
      (entry) => entry instanceof Element && isPickerElement(entry),
    )
  ) {
    return null;
  }

  const directTarget = eventTarget instanceof Element ? eventTarget : null;
  const textPointTarget = getTextPointTarget(clientX, clientY);
  const shouldPrioritizeTextPointTarget = Boolean(
    textPointTarget &&
      directTarget &&
      (textPointTarget === directTarget || textPointTarget.contains(directTarget)),
  );
  const candidates = [
    ...(shouldPrioritizeTextPointTarget ? [textPointTarget] : []),
    ...(eventPath ?? []),
    eventTarget,
    ...document.elementsFromPoint(clientX, clientY),
    ...(!shouldPrioritizeTextPointTarget && textPointTarget ? [textPointTarget] : []),
  ].filter((value): value is Element => value instanceof Element);

  const uniqueCandidates = Array.from(new Set(candidates)).filter(
    (element) => !isPickerElement(element),
  );
  const preferred =
    uniqueCandidates.find((element) => isMeaningfulTarget(element)) ??
    uniqueCandidates[0] ??
    null;

  return preferred ? getPresentationContainer(preferred) : null;
}

function createSelector(element: Element) {
  if ("id" in element && element.id) {
    return `#${cssEscape(element.id)}`;
  }

  const dataAgentId = element.getAttribute("data-agent-id");
  if (dataAgentId) {
    return `[data-agent-id="${dataAgentId}"]`;
  }

  const dataTestId = element.getAttribute("data-testid");
  if (dataTestId) {
    return `[data-testid="${dataTestId}"]`;
  }

  const classList = "classList" in element ? Array.from(element.classList).filter(Boolean) : [];
  if (classList.length > 0) {
    return `${element.tagName.toLowerCase()}.${classList.slice(0, 2).map(cssEscape).join(".")}`;
  }

  return element.tagName.toLowerCase();
}

function createSelectorPath(element: Element) {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current.tagName.toLowerCase() !== "html") {
    const currentElement: Element = current;
    const tagName = currentElement.tagName.toLowerCase();
    const id = "id" in currentElement && currentElement.id ? `#${cssEscape(currentElement.id)}` : "";

    if (id) {
      segments.unshift(`${tagName}${id}`);
      break;
    }

    const parent: Element | null = currentElement.parentElement;
    if (!parent) {
      segments.unshift(tagName);
      break;
    }

    const siblings = Array.from(parent.children).filter((child) => child.tagName === currentElement.tagName);
    const position = siblings.indexOf(currentElement) + 1;
    segments.unshift(`${tagName}:nth-of-type(${position})`);
    current = parent;
  }

  return segments.join(" > ");
}

function getDataset(element: Element) {
  return Object.fromEntries(
    Array.from(element.attributes)
      .filter((attribute) => attribute.name.startsWith("data-"))
      .map((attribute) => [attribute.name, attribute.value]),
  );
}

function getTextPreview(element: Element) {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function getRect(element: Element): SelectionRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function parsePixels(value: string) {
  const next = Number.parseFloat(value);
  return Number.isFinite(next) ? next : 0;
}

function toViewportRect(
  left: number,
  top: number,
  width: number,
  height: number,
): SelectionRect {
  return {
    left,
    top,
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

function getBoxModel(element: Element, rect = getRect(element)): SelectionBoxModel {
  const styles = window.getComputedStyle(element);
  const margin = {
    top: parsePixels(styles.marginTop),
    right: parsePixels(styles.marginRight),
    bottom: parsePixels(styles.marginBottom),
    left: parsePixels(styles.marginLeft),
  };
  const padding = {
    top: parsePixels(styles.paddingTop),
    right: parsePixels(styles.paddingRight),
    bottom: parsePixels(styles.paddingBottom),
    left: parsePixels(styles.paddingLeft),
  };
  const border = {
    top: parsePixels(styles.borderTopWidth),
    right: parsePixels(styles.borderRightWidth),
    bottom: parsePixels(styles.borderBottomWidth),
    left: parsePixels(styles.borderLeftWidth),
  };

  return {
    margin,
    padding,
    border,
    marginRect: toViewportRect(
      rect.left - margin.left,
      rect.top - margin.top,
      rect.width + margin.left + margin.right,
      rect.height + margin.top + margin.bottom,
    ),
    paddingRect: toViewportRect(
      rect.left + border.left,
      rect.top + border.top,
      rect.width - border.left - border.right,
      rect.height - border.top - border.bottom,
    ),
    contentRect: toViewportRect(
      rect.left + border.left + padding.left,
      rect.top + border.top + padding.top,
      rect.width - border.left - border.right - padding.left - padding.right,
      rect.height - border.top - border.bottom - padding.top - padding.bottom,
    ),
  };
}

function getTypography(element: Element): SelectionTypography | null {
  const textPreview = getTextPreview(element);
  if (!textPreview) {
    return null;
  }

  const styles = window.getComputedStyle(element);
  const fontSize = styles.fontSize.trim();
  const fontFamily = styles.fontFamily.trim();
  const fontWeight = styles.fontWeight.trim();

  if (!fontSize || !fontFamily || !fontWeight) {
    return null;
  }

  return {
    fontSize,
    fontFamily,
    fontWeight,
  };
}

function getGapInfo(element: Element): SelectionGapInfo {
  const styles = window.getComputedStyle(element);
  const row = parsePixels(styles.rowGap);
  const column = parsePixels(styles.columnGap);

  if (row <= 0 && column <= 0) {
    return { row: 0, column: 0, rects: [] };
  }

  const children = Array.from(element.children).filter(
    (child) =>
      !isPickerElement(child) &&
      child.getBoundingClientRect().width > 0 &&
      child.getBoundingClientRect().height > 0,
  );
  const rects: SelectionGapRect[] = [];

  for (let index = 0; index < children.length - 1; index += 1) {
    const current = children[index]?.getBoundingClientRect();
    const next = children[index + 1]?.getBoundingClientRect();

    if (!current || !next) {
      continue;
    }

    const currentRight = current.left + current.width;
    const nextRight = next.left + next.width;
    const currentBottom = current.top + current.height;
    const nextBottom = next.top + next.height;
    const horizontalGap = next.left - currentRight;
    const verticalGap = next.top - currentBottom;
    const verticalOverlap =
      Math.min(currentBottom, nextBottom) - Math.max(current.top, next.top);
    const horizontalOverlap =
      Math.min(currentRight, nextRight) - Math.max(current.left, next.left);

    if (column > 0 && horizontalGap > 0.5 && verticalOverlap > 0.5) {
      rects.push({
        axis: "column",
        size: Math.round(horizontalGap),
        left: currentRight,
        top: Math.max(current.top, next.top),
        width: horizontalGap,
        height: verticalOverlap,
      });
    }

    if (row > 0 && verticalGap > 0.5 && horizontalOverlap > 0.5) {
      rects.push({
        axis: "row",
        size: Math.round(verticalGap),
        left: Math.max(current.left, next.left),
        top: currentBottom,
        width: horizontalOverlap,
        height: verticalGap,
      });
    }
  }

  return { row, column, rects };
}

function createSelectionId(element: Element) {
  return createSelectorPath(element);
}

function createSelectionIdFromRecord(record: DevSelectionElementRecord) {
  return record.selectorPath || record.selector || `${record.tagName}:${record.rect.x}:${record.rect.y}:${record.rect.width}:${record.rect.height}`;
}

function getSnapshotPixelRatio(rect: { width: number; height: number }) {
  const baseRatio =
    typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
      ? Math.min(window.devicePixelRatio, SNAPSHOT_MAX_PIXEL_RATIO)
      : 1;
  const area = rect.width * rect.height;
  if (area <= 0) {
    return 1;
  }

  return Math.max(
    SNAPSHOT_MIN_PIXEL_RATIO,
    Math.min(baseRatio, Math.sqrt(SNAPSHOT_MAX_PIXELS / area)),
  );
}

async function captureSelectionSnapshot(element: Element): Promise<DevSelectionSnapshotPayload | null> {
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return null;
  }

  try {
    const pixelRatio = getSnapshotPixelRatio(rect);
    const dataUrl = await toPng(element as HTMLElement, {
      backgroundColor: "transparent",
      cacheBust: true,
      pixelRatio,
      filter: (node) => !(node instanceof Element && isPickerElement(node)),
    });

    return {
      dataUrl,
      mimeType: "image/png",
      width: Math.round(rect.width * pixelRatio),
      height: Math.round(rect.height * pixelRatio),
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function captureAreaSnapshot(rect: DevSelectionRect): Promise<DevSelectionSnapshotPayload | null> {
  if (rect.width < 2 || rect.height < 2) {
    return null;
  }

  const wrapper = document.createElement("div");
  const clone = document.body.cloneNode(true) as HTMLElement;
  const pageWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
  const pageHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);

  Object.assign(wrapper.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
    opacity: "0",
  });

  Object.assign(clone.style, {
    margin: "0",
    width: `${pageWidth}px`,
    height: `${pageHeight}px`,
    transform: `translate(${-rect.x}px, ${-rect.y}px)`,
    transformOrigin: "top left",
  });

  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  try {
    const pixelRatio = getSnapshotPixelRatio(rect);
    const dataUrl = await toPng(wrapper, {
      backgroundColor: "transparent",
      cacheBust: true,
      pixelRatio,
      canvasWidth: Math.round(rect.width * pixelRatio),
      canvasHeight: Math.round(rect.height * pixelRatio),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      filter: (node) => !(node instanceof Element && isPickerElement(node)),
    });

    return {
      dataUrl,
      mimeType: "image/png",
      width: Math.round(rect.width * pixelRatio),
      height: Math.round(rect.height * pixelRatio),
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    wrapper.remove();
  }
}

function buildSelectionPreview(
  element: Element,
  snapshot: DevSelectionSnapshotRecord | null = null,
): SelectionPreview {
  const rect = getRect(element);

  return {
    id: createSelectionId(element),
    label: createLabel(element),
    selector: createSelector(element),
    rect,
    boxModel: getBoxModel(element, rect),
    gap: getGapInfo(element),
    typography: getTypography(element),
    snapshot,
  };
}

function buildSelectionPreviewFromRecord(
  record: DevSelectionElementRecord,
  snapshot: DevSelectionSnapshotRecord | null = null,
): SelectionPreview {
  return {
    id: createSelectionIdFromRecord(record),
    label: createLabelFromRecord(record),
    selector: record.selector,
    rect: {
      left: record.rect.x,
      top: record.rect.y,
      width: record.rect.width,
      height: record.rect.height,
    },
    boxModel: {
      margin: record.boxModel.margin,
      padding: record.boxModel.padding,
      border: record.boxModel.border,
      marginRect: {
        left: record.boxModel.marginRect.x,
        top: record.boxModel.marginRect.y,
        width: record.boxModel.marginRect.width,
        height: record.boxModel.marginRect.height,
      },
      paddingRect: {
        left: record.boxModel.paddingRect.x,
        top: record.boxModel.paddingRect.y,
        width: record.boxModel.paddingRect.width,
        height: record.boxModel.paddingRect.height,
      },
      contentRect: {
        left: record.boxModel.contentRect.x,
        top: record.boxModel.contentRect.y,
        width: record.boxModel.contentRect.width,
        height: record.boxModel.contentRect.height,
      },
    },
    gap: {
      row: 0,
      column: 0,
      rects: [],
    },
    typography: record.typography ?? null,
    snapshot,
  };
}

function toSelectionElementRecord(element: Element): DevSelectionSaveElementRecord {
  const rect = element.getBoundingClientRect();
  const viewportRect = getRect(element);
  const boxModel = getBoxModel(element, viewportRect);

  return {
    tagName: element.tagName.toLowerCase(),
    id: "id" in element && element.id ? element.id : null,
    classNames: "classList" in element ? Array.from(element.classList) : [],
    role: element.getAttribute("role"),
    textPreview: getTextPreview(element),
    selector: createSelector(element),
    selectorPath: createSelectorPath(element),
    dataset: getDataset(element),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    boxModel: {
      margin: boxModel.margin,
      padding: boxModel.padding,
      border: boxModel.border,
      marginRect: {
        x: rect.x - boxModel.margin.left,
        y: rect.y - boxModel.margin.top,
        width: boxModel.marginRect.width,
        height: boxModel.marginRect.height,
      },
      paddingRect: {
        x: rect.x + boxModel.border.left,
        y: rect.y + boxModel.border.top,
        width: boxModel.paddingRect.width,
        height: boxModel.paddingRect.height,
      },
      contentRect: {
        x: rect.x + boxModel.border.left + boxModel.padding.left,
        y: rect.y + boxModel.border.top + boxModel.padding.top,
        width: boxModel.contentRect.width,
        height: boxModel.contentRect.height,
      },
    },
    typography: getTypography(element),
    outerHTMLSnippet: element.outerHTML.slice(0, 1200),
  };
}

function createAreaSelectionRecord(rect: SelectionRect): DevSelectionSaveElementRecord {
  const normalizedRect = {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };

  return {
    tagName: "area-selection",
    id: null,
    classNames: [],
    role: null,
    textPreview: "",
    selector: `area:${normalizedRect.x},${normalizedRect.y},${normalizedRect.width},${normalizedRect.height}`,
    selectorPath: `area:${normalizedRect.x},${normalizedRect.y},${normalizedRect.width},${normalizedRect.height}`,
    dataset: {},
    rect: normalizedRect,
    boxModel: {
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      marginRect: normalizedRect,
      paddingRect: normalizedRect,
      contentRect: normalizedRect,
    },
    typography: null,
    outerHTMLSnippet: "<!-- area selection -->",
  };
}

function createSavedSelectionTarget(
  record: DevSelectionElementRecord,
  snapshot: DevSelectionSnapshotRecord | null = null,
): SavedSelectionTarget {
  return {
    id: createSelectionIdFromRecord(record),
    liveElement: findElementForRecord(record),
    record,
    snapshot,
  };
}

function createSavedSelectionTargetFromElement(element: Element): SavedSelectionTarget {
  const record = toSelectionElementRecord(element) as DevSelectionElementRecord;
  return {
    id: createSelectionId(element),
    liveElement: element,
    record,
    snapshot: null,
  };
}

function buildSelectionPreviewFromTarget(target: SavedSelectionTarget): SelectionPreview {
  if (target.liveElement && !target.record.selector.startsWith("area:")) {
    return buildSelectionPreview(target.liveElement, target.snapshot);
  }

  return buildSelectionPreviewFromRecord(target.record, target.snapshot);
}

function toPayload(
  targets: SavedSelectionTarget[],
  session: DevSelectionSessionRecord,
  snapshots: Array<DevSelectionSnapshotPayload | null>,
): DevSelectionSaveRecord {
  const selectionElements = targets.map((target, index) => ({
    ...(target.liveElement ? toSelectionElementRecord(target.liveElement) : target.record),
    snapshot: snapshots[index] ?? null,
  }));

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    page: {
      url: window.location.href,
      pathname: window.location.pathname,
      title: document.title,
    },
    session,
    element: selectionElements[selectionElements.length - 1],
    elements: selectionElements,
  };
}

function isPickerElement(element: Element | null) {
  return Boolean(
    element?.closest(
      "[data-kuma-picker-root='true'], [data-kuma-picker-ui='true']",
    ),
  );
}

function createAgentNoteKey(note: KumaPickerAgentNoteRecord | null) {
  if (!note) {
    return null;
  }

  return [
    note.author,
    note.status,
    note.message,
    note.updatedAt,
    note.sessionId,
    note.selectionId ?? "",
  ].join("::");
}

export default function AgentDomPicker() {
  const [sessionAgentNote, setSessionAgentNote] = useState<KumaPickerAgentNoteRecord | null>(null);
  const [globalAgentNote, setGlobalAgentNote] = useState<KumaPickerAgentNoteRecord | null>(null);
  const [renderedAgentNote, setRenderedAgentNote] = useState<KumaPickerAgentNoteRecord | null>(null);
  const [isAgentNoteTransitionVisible, setIsAgentNoteTransitionVisible] = useState(false);
  const [dismissedAgentNoteKey, setDismissedAgentNoteKey] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragSelectionRect, setDragSelectionRect] = useState<SelectionRect | null>(null);
  const [hoveredPreview, setHoveredPreview] = useState<SelectionPreview | null>(null);
  const [selectedPreviews, setSelectedPreviews] = useState<SelectionPreview[]>([]);
  const [sessionInfo, setSessionInfo] = useState<DevSelectionSessionRecord | null>(null);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const hoveredElementRef = useRef<Element | null>(null);
  const selectedTargetsRef = useRef<SavedSelectionTarget[]>([]);
  const sessionIdRef = useRef<string>("");
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<FloatingPosition>({ x: ROOT_MARGIN, y: ROOT_MARGIN });
  const dragStateRef = useRef<DragState | null>(null);
  const areaSelectionDragRef = useRef<AreaSelectionDragState | null>(null);
  const flingFrameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const selectedSnapshotMapRef = useRef<Map<string, DevSelectionSnapshotRecord | null>>(new Map());

  const activePreview = hoveredPreview ?? selectedPreviews[selectedPreviews.length - 1] ?? null;
  const activeSessionId = sessionInfo?.id ?? null;
  const agentNote = sessionAgentNote ?? globalAgentNote;
  const syncSavedTargets = useCallback((nextTargets: SavedSelectionTarget[]) => {
    selectedTargetsRef.current = nextTargets;
    selectedSnapshotMapRef.current = new Map(
      nextTargets.map((target) => [target.id, target.snapshot]),
    );
    setSelectedPreviews(nextTargets.map((target) => buildSelectionPreviewFromTarget(target)));
  }, []);

  const getWidgetSize = useCallback(() => {
    const rect = widgetRef.current?.getBoundingClientRect();
    return {
      width: rect?.width ?? 48,
      height: rect?.height ?? 48,
    };
  }, []);

  const activeSnapshotUrl = useMemo(() => {
    if (!activePreview?.snapshot) {
      return null;
    }

    return getKumaPickerDevSelectionAssetUrl(activePreview.snapshot.assetUrl);
  }, [activePreview?.snapshot]);

  const clampToViewport = useCallback(
    (x: number, y: number, size = getWidgetSize()) => {
      const maxX = Math.max(ROOT_MARGIN, window.innerWidth - size.width - ROOT_MARGIN);
      const maxY = Math.max(ROOT_MARGIN, window.innerHeight - size.height - ROOT_MARGIN);

      return {
        x: Math.min(Math.max(ROOT_MARGIN, x), maxX),
        y: Math.min(Math.max(ROOT_MARGIN, y), maxY),
      };
    },
    [getWidgetSize],
  );

  const stopFling = useCallback(() => {
    if (flingFrameRef.current !== null) {
      window.cancelAnimationFrame(flingFrameRef.current);
      flingFrameRef.current = null;
    }
  }, []);

  const startFling = useCallback(
    (initialVelocityX: number, initialVelocityY: number) => {
      stopFling();

      let velocityX = Math.max(-FLING_VELOCITY_LIMIT, Math.min(FLING_VELOCITY_LIMIT, initialVelocityX));
      let velocityY = Math.max(-FLING_VELOCITY_LIMIT, Math.min(FLING_VELOCITY_LIMIT, initialVelocityY));
      let lastTimestamp: number | null = null;

      const animate = (timestamp: number) => {
        if (lastTimestamp === null) {
          lastTimestamp = timestamp;
          flingFrameRef.current = window.requestAnimationFrame(animate);
          return;
        }

        const delta = Math.min(32, timestamp - lastTimestamp);
        lastTimestamp = timestamp;

        let nextX = positionRef.current.x + velocityX * delta;
        let nextY = positionRef.current.y + velocityY * delta;
        const size = getWidgetSize();
        const clamped = clampToViewport(nextX, nextY, size);

        if (clamped.x !== nextX) {
          nextX = clamped.x;
          velocityX *= -0.18;
        }

        if (clamped.y !== nextY) {
          nextY = clamped.y;
          velocityY *= -0.18;
        }

        velocityX *= Math.pow(0.84, delta / 16);
        velocityY *= Math.pow(0.84, delta / 16);

        const nextPosition = { x: nextX, y: nextY };
        positionRef.current = nextPosition;
        setPosition(nextPosition);

        if (Math.abs(velocityX) < FLING_STOP_SPEED && Math.abs(velocityY) < FLING_STOP_SPEED) {
          flingFrameRef.current = null;
          return;
        }

        flingFrameRef.current = window.requestAnimationFrame(animate);
      };

      flingFrameRef.current = window.requestAnimationFrame(animate);
    },
    [clampToViewport, getWidgetSize, stopFling],
  );

  useEffect(() => {
    const sessionId = getOrCreateSessionId();
    sessionIdRef.current = sessionId;
    setSessionInfo((current) =>
      current ?? {
        id: sessionId,
        label: "New session",
        index: 0,
        updatedAt: new Date().toISOString(),
      },
    );
  }, []);

  const syncAgentNotes = useCallback(async (sessionId: string | null) => {
    const sessionNotePromise = sessionId ? fetchKumaPickerAgentNote(sessionId).catch(() => null) : Promise.resolve(null);
    const globalNotePromise =
      sessionId === DEFAULT_KUMA_PICKER_NOTE_SESSION_ID
        ? Promise.resolve(null)
        : fetchKumaPickerAgentNote(DEFAULT_KUMA_PICKER_NOTE_SESSION_ID).catch(() => null);

    const [nextSessionNote, nextGlobalNote] = await Promise.all([
      sessionNotePromise,
      globalNotePromise,
    ]);

    setSessionAgentNote(nextSessionNote);
    setGlobalAgentNote(nextGlobalNote);
  }, []);

  const syncSelectionState = useCallback(
    async (options?: { restoreSessionSelection?: boolean }) => {
      const sessionId = sessionIdRef.current || getOrCreateSessionId();
      sessionIdRef.current = sessionId;

      const response = await fetch(getKumaPickerDevSelectionEndpoint(), {
        cache: "no-store",
      });

      if (response.status === 204) {
        setSessionInfo({
          id: sessionId,
          label: "Session 1",
          index: 1,
          updatedAt: new Date().toISOString(),
        });
        if (options?.restoreSessionSelection) {
          syncSavedTargets([]);
        }
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to load selection collection");
      }

      const collection = (await response.json()) as DevSelectionCollection;
      const sessionIndex = collection.sessions.findIndex((entry) => entry.session.id === sessionId);
      const currentSession = sessionIndex >= 0 ? collection.sessions[sessionIndex] : null;

      setSessionInfo(
        currentSession?.session ?? {
          id: sessionId,
          label: `Session ${collection.sessions.length + 1}`,
          index: collection.sessions.length + 1,
          updatedAt: new Date().toISOString(),
        },
      );

      if (options?.restoreSessionSelection) {
        if (!currentSession) {
          syncSavedTargets([]);
          return;
        }

        syncSavedTargets(
          currentSession.elements.map((record) =>
            createSavedSelectionTarget(record, record.snapshot ?? null),
          ),
        );
      }
    },
    [syncSavedTargets],
  );

  useEffect(() => {
    void syncSelectionState({ restoreSessionSelection: true }).catch(() => {});
  }, [syncSelectionState]);

  useEffect(() => {
    void syncAgentNotes(activeSessionId);
  }, [activeSessionId, syncAgentNotes]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
      return;
    }

    const eventSource = createSceneEventSource();
    const handleAgentNoteEvent = (event: MessageEvent<string>) => {
      const payload = parseKumaPickerAgentNoteEvent(event.data);
      if (!payload) {
        return;
      }

      if (payload.sessionId === activeSessionId) {
        setSessionAgentNote(payload.deleted ? null : payload.note);
      }

      if (payload.sessionId === DEFAULT_KUMA_PICKER_NOTE_SESSION_ID) {
        setGlobalAgentNote(payload.deleted ? null : payload.note);
      }
    };

    eventSource.addEventListener("agent-note", handleAgentNoteEvent as EventListener);

    return () => {
      eventSource.removeEventListener("agent-note", handleAgentNoteEvent as EventListener);
      eventSource.close();
    };
  }, [activeSessionId]);

  useEffect(() => {
    const handleWindowFocus = () => {
      void syncSelectionState().catch(() => {});
      void syncAgentNotes(activeSessionId).catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncSelectionState().catch(() => {});
        void syncAgentNotes(activeSessionId).catch(() => {});
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeSessionId, syncAgentNotes, syncSelectionState]);

  const activeAgentNoteKey = useMemo(() => createAgentNoteKey(agentNote), [agentNote]);
  const isAgentNoteVisible = Boolean(agentNote && activeAgentNoteKey !== dismissedAgentNoteKey);

  useEffect(() => {
    if (agentNote && isAgentNoteVisible) {
      setRenderedAgentNote(agentNote);
      const frameId = window.requestAnimationFrame(() => {
        setIsAgentNoteTransitionVisible(true);
      });

      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    setIsAgentNoteTransitionVisible(false);

    if (!renderedAgentNote) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRenderedAgentNote(null);
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [agentNote, isAgentNoteVisible, renderedAgentNote]);

  useEffect(() => {
    const sessionId = sessionIdRef.current || getOrCreateSessionId();
    sessionIdRef.current = sessionId;

    const cleanup = () => {
      void fetch(getKumaPickerDevSelectionSessionEndpoint(sessionId), {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener("beforeunload", cleanup);
    return () => window.removeEventListener("beforeunload", cleanup);
  }, []);

  useEffect(() => {
    if (selectedPreviews.length === 0) return;

    const handleWindowChange = () => {
      const nextTargets = selectedTargetsRef.current.map((target) => {
        if (target.record.selector.startsWith("area:")) {
          return target;
        }

        const nextLiveElement =
          target.liveElement && document.contains(target.liveElement)
            ? target.liveElement
            : findElementForRecord(target.record);

        return {
          ...target,
          liveElement: nextLiveElement,
        };
      });
      syncSavedTargets(nextTargets);
    };

    window.addEventListener("scroll", handleWindowChange, true);
    window.addEventListener("resize", handleWindowChange);
    return () => {
      window.removeEventListener("scroll", handleWindowChange, true);
      window.removeEventListener("resize", handleWindowChange);
    };
  }, [selectedPreviews.length, syncSavedTargets]);

  useEffect(() => {
    if (!widgetRef.current) return;

    const storedPosition =
      typeof window !== "undefined"
        ? parseStoredPosition(
            readStoredValue(
              window.localStorage,
              PICKER_POSITION_STORAGE_KEYS,
            ),
          )
        : null;
    const size = getWidgetSize();
    const nextPosition = position
      ? clampToViewport(position.x, position.y, size)
      : storedPosition
        ? clampToViewport(storedPosition.x, storedPosition.y, size)
        : clampToViewport(
            window.innerWidth - size.width - ROOT_MARGIN,
            window.innerHeight - size.height - ROOT_MARGIN,
            size,
          );

    positionRef.current = nextPosition;
    setPosition((current) => {
      if (current && current.x === nextPosition.x && current.y === nextPosition.y) {
        return current;
      }

      return nextPosition;
    });
  }, [clampToViewport, getWidgetSize, position]);

  useEffect(() => {
    if (!position || typeof window === "undefined") {
      return;
    }

    writeStoredValue(
      window.localStorage,
      PICKER_POSITION_STORAGE_KEYS,
      JSON.stringify(position),
    );
  }, [position]);

  useEffect(() => {
    const handleResize = () => {
      const size = getWidgetSize();
      const nextPosition = clampToViewport(positionRef.current.x, positionRef.current.y, size);
      positionRef.current = nextPosition;
      setPosition(nextPosition);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampToViewport, getWidgetSize]);

  useEffect(() => {
    if (!isActive) {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("-webkit-user-select");
      return;
    }

    document.body.style.cursor = "crosshair";
    document.body.style.setProperty("user-select", "none");
    document.body.style.setProperty("-webkit-user-select", "none");

    const updateHoveredElement = (element: Element | null) => {
      if (!element || isPickerElement(element)) return;

      hoveredElementRef.current = element;
      setHoveredPreview(buildSelectionPreview(element));
    };

    const normalizeDragRect = (dragState: AreaSelectionDragState): SelectionRect => ({
      left: Math.min(dragState.startX, dragState.currentX),
      top: Math.min(dragState.startY, dragState.currentY),
      width: Math.abs(dragState.currentX - dragState.startX),
      height: Math.abs(dragState.currentY - dragState.startY),
    });

    const saveTargets = async (
      nextTargets: SavedSelectionTarget[],
      options?: { multiSelect?: boolean },
    ) => {
      const sessionId = sessionIdRef.current || getOrCreateSessionId();
      sessionIdRef.current = sessionId;

      setIsSaving(true);
      try {
        const snapshots = await Promise.all(
          nextTargets.map((target) => {
            if (target.record.selector.startsWith("area:")) {
              return captureAreaSnapshot(target.record.rect);
            }

            return target.liveElement ? captureSelectionSnapshot(target.liveElement) : null;
          }),
        );
        const payload = toPayload(
          nextTargets,
          {
            id: sessionId,
            label: sessionInfo?.label ?? "New session",
            index: sessionInfo?.index ?? 0,
            updatedAt: new Date().toISOString(),
          },
          snapshots,
        );
        const response = await fetch(getKumaPickerDevSelectionEndpoint(sessionId), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error("Failed to save selection");
        }

        const savedRecord = (await response.json()) as DevSelectionRecord;
        syncSavedTargets(
          savedRecord.elements.map((record) =>
            createSavedSelectionTarget(record, record.snapshot ?? null),
          ),
        );
        setSessionInfo(savedRecord.session);
        if (!options?.multiSelect) {
          setIsActive(false);
          setHoveredPreview(null);
          hoveredElementRef.current = null;
        }
        await syncSelectionState();
      } finally {
        setIsSaving(false);
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (isPickerElement(target)) {
        return;
      }

      areaSelectionDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        shiftKey: event.shiftKey,
        dragging: false,
      };
    };

    const handleMouseMove = (event: MouseEvent) => {
      const areaDrag = areaSelectionDragRef.current;
      if (areaDrag) {
        areaDrag.currentX = event.clientX;
        areaDrag.currentY = event.clientY;
        const nextRect = normalizeDragRect(areaDrag);
        const hasDragged =
          nextRect.width >= DRAG_THRESHOLD || nextRect.height >= DRAG_THRESHOLD;

        if (hasDragged) {
          areaDrag.dragging = true;
          hoveredElementRef.current = null;
          setHoveredPreview(null);
          setDragSelectionRect(nextRect);
          event.preventDefault();
          return;
        }
      }

      const element = getPreferredSelectionTarget(
        event.clientX,
        event.clientY,
        event.target,
        event.composedPath(),
      );
      if (!element || isPickerElement(element)) return;
      updateHoveredElement(element);
    };

    const handleMouseUp = async (event: MouseEvent) => {
      const areaDrag = areaSelectionDragRef.current;
      if (!areaDrag) {
        return;
      }

      areaSelectionDragRef.current = null;
      const nextRect = normalizeDragRect(areaDrag);

      if (!areaDrag.dragging || nextRect.width < 2 || nextRect.height < 2) {
        setDragSelectionRect(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      suppressClickRef.current = true;
      setDragSelectionRect(null);

      const areaRecord = createAreaSelectionRecord(nextRect) as DevSelectionElementRecord;
      const nextTarget = createSavedSelectionTarget(areaRecord, null);
      const nextTargets = areaDrag.shiftKey
        ? [
            ...selectedTargetsRef.current.filter((target) => target.id !== nextTarget.id),
            nextTarget,
          ]
        : [nextTarget];

      await saveTargets(nextTargets, { multiSelect: areaDrag.shiftKey });
    };

    const handleClick = async (event: MouseEvent) => {
      if (suppressClickRef.current) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        suppressClickRef.current = false;
        return;
      }

      const element = getPreferredSelectionTarget(
        event.clientX,
        event.clientY,
        event.target,
        event.composedPath(),
      );
      if (!element || isPickerElement(element)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const isMultiSelect = event.shiftKey;
      const selectionId = createSelectionId(element);
      const nextTargets = isMultiSelect
        ? [
            ...selectedTargetsRef.current.filter(
              (current) => current.id !== selectionId,
            ),
            createSavedSelectionTargetFromElement(element),
          ]
        : [createSavedSelectionTargetFromElement(element)];

      await saveTargets(nextTargets, { multiSelect: isMultiSelect });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsActive(false);
        setHoveredPreview(null);
        setDragSelectionRect(null);
        areaSelectionDragRef.current = null;
        hoveredElementRef.current = null;
      }
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("-webkit-user-select");
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("mouseup", handleMouseUp, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isActive, sessionInfo, syncSavedTargets, syncSelectionState]);

  useEffect(() => {
    const handleHotkey = (event: KeyboardEvent) => {
      const usesModifier = event.metaKey || event.ctrlKey;
      if (!usesModifier || !event.shiftKey || event.key.toLowerCase() !== "x") return;

      event.preventDefault();
      setIsActive((current) => {
        const next = !current;
        if (!next) {
          setHoveredPreview(null);
          hoveredElementRef.current = null;
        }
        return next;
      });
    };

    window.addEventListener("keydown", handleHotkey);
    return () => window.removeEventListener("keydown", handleHotkey);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;

      if (!dragState.moved && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
        dragState.moved = true;
        suppressClickRef.current = true;
        setIsDragging(true);
        stopFling();
        document.body.style.userSelect = "none";
      }

      if (!dragState.moved) {
        return;
      }

      event.preventDefault();

      const unclamped = {
        x: dragState.startPosition.x + deltaX,
        y: dragState.startPosition.y + deltaY,
      };
      const nextPosition = clampToViewport(unclamped.x, unclamped.y);
      const timestamp = performance.now();
      const deltaTime = Math.max(1, timestamp - dragState.lastTimestamp);

      dragState.velocityX = (nextPosition.x - dragState.lastPosition.x) / deltaTime;
      dragState.velocityY = (nextPosition.y - dragState.lastPosition.y) / deltaTime;
      dragState.lastTimestamp = timestamp;
      dragState.lastPosition = nextPosition;

      positionRef.current = nextPosition;
      setPosition(nextPosition);
    };

    const finishDrag = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      dragStateRef.current = null;
      document.body.style.removeProperty("user-select");

      if (!dragState.moved) {
        return;
      }

      setIsDragging(false);
      startFling(dragState.velocityX * 1.35, dragState.velocityY * 1.35);

      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);

    return () => {
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [clampToViewport, startFling, stopFling]);

  useEffect(
    () => () => {
      stopFling();
      document.body.style.removeProperty("user-select");
    },
    [stopFling],
  );

  const buttonTone = useMemo(() => {
    if (isActive) {
      return "border-[#25C69C] bg-[#25C69C] text-white shadow-[0_14px_30px_rgba(37,198,156,0.28)]";
    }

    if (selectedPreviews.length > 0) {
      return "border-[#bfe9dc] bg-white text-[#25C69C] shadow-[0_14px_30px_rgba(37,198,156,0.16)]";
    }

    return "border-white/80 bg-white text-[#25C69C] shadow-[0_14px_30px_rgba(15,23,42,0.08)]";
  }, [isActive, selectedPreviews.length]);
  const agentNoteTone = useMemo(() => {
    switch (renderedAgentNote?.status) {
      case "fixed":
        return "border-[#25C69C]/40 bg-[#effcf7] text-[#16624f]";
      case "in_progress":
        return "border-[#f0d58a] bg-[#fff8df] text-[#7b5a12]";
      case "needs_reselect":
        return "border-[#f3b3b3] bg-[#fff1f1] text-[#8f2f2f]";
      default:
        return "border-[#bdd8ff] bg-[#f2f7ff] text-[#285ea8]";
    }
  }, [renderedAgentNote?.status]);
  const agentNoteTimeLabel = useMemo(() => {
    if (!renderedAgentNote?.updatedAt) {
      return null;
    }

    const parsed = new Date(renderedAgentNote.updatedAt);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [renderedAgentNote?.updatedAt]);
  const agentNoteKey = useMemo(() => {
    return createAgentNoteKey(renderedAgentNote);
  }, [renderedAgentNote]);
  const spacingMessage = useMemo(() => {
    if (!activePreview) {
      return null;
    }

    const formatEdges = (edges: SelectionEdges) =>
      `${edges.top} ${edges.right} ${edges.bottom} ${edges.left}`;
    const formatGap = (gap: SelectionGapInfo) => {
      if (gap.row <= 0 && gap.column <= 0) {
        return "0";
      }
      if (gap.row > 0 && gap.column > 0) {
        return gap.row === gap.column
          ? `${gap.row}`
          : `row ${gap.row} / column ${gap.column}`;
      }

      return gap.row > 0 ? `row ${gap.row}` : `column ${gap.column}`;
    };

    return {
      margin: formatEdges(activePreview.boxModel.margin),
      padding: formatEdges(activePreview.boxModel.padding),
      gap: formatGap(activePreview.gap),
      size: `${Math.round(activePreview.rect.width)} x ${Math.round(activePreview.rect.height)}`,
      typography: activePreview.typography,
    };
  }, [activePreview]);
  const hoveredIsSelected = useMemo(
    () =>
      Boolean(
        hoveredPreview &&
          selectedPreviews.some((preview) => preview.id === hoveredPreview.id),
      ),
    [hoveredPreview, selectedPreviews],
  );
  const activeSelectionNumber = useMemo(() => {
    const previewIndex = selectedPreviews.findIndex((preview) => preview.id === activePreview?.id);
    return previewIndex >= 0 ? previewIndex + 1 : selectedPreviews.length + 1;
  }, [activePreview?.id, selectedPreviews]);
  const handleToggleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    setIsActive((current) => {
      const next = !current;
      if (!next) {
        setHoveredPreview(null);
        hoveredElementRef.current = null;
      }
      return next;
    });
  };

  const handleClearClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    setIsActive(false);
    setHoveredPreview(null);
    setDragSelectionRect(null);
    hoveredElementRef.current = null;
    syncSavedTargets([]);
    setSessionAgentNote(null);
    if (typeof window !== "undefined") {
      clearStoredValues(
        window.sessionStorage,
        PICKER_SESSION_ID_STORAGE_KEYS,
      );
    }

    const nextSessionId = getOrCreateSessionId();
    sessionIdRef.current = nextSessionId;
    setSessionInfo({
      id: nextSessionId,
      label: "Session 1",
      index: 1,
      updatedAt: new Date().toISOString(),
    });

    void fetch(getKumaPickerDevSelectionEndpoint(), {
      method: "DELETE",
      keepalive: true,
    })
      .then(() => syncSelectionState({ restoreSessionSelection: true }))
      .catch(() => {});
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    stopFling();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: positionRef.current,
      lastPosition: positionRef.current,
      lastTimestamp: performance.now(),
      velocityX: 0,
      velocityY: 0,
      moved: false,
    };
  };

  return (
    <>
      {dragSelectionRect ? (
        <div
          className="pointer-events-none fixed border border-dashed border-[#25C69C] bg-[rgba(37,198,156,0.12)]"
          style={{
            zIndex: 2147482995,
            left: dragSelectionRect.left,
            top: dragSelectionRect.top,
            width: dragSelectionRect.width,
            height: dragSelectionRect.height,
          }}
        />
      ) : null}

      {selectedPreviews.map((preview, index) => (
        <div key={preview.id}>
          <div
            className="pointer-events-none fixed border border-[#f59e0b]/70 bg-[rgba(245,158,11,0.12)]"
            style={{
              zIndex: 2147482992 + index * 6,
              left: preview.boxModel.marginRect.left,
              top: preview.boxModel.marginRect.top,
              width: preview.boxModel.marginRect.width,
              height: preview.boxModel.marginRect.height,
            }}
          />

          <div
            className="pointer-events-none fixed bg-[rgba(56,189,248,0.14)]"
            style={{
              zIndex: 2147482993 + index * 6,
              left: preview.boxModel.paddingRect.left,
              top: preview.boxModel.paddingRect.top,
              width: preview.boxModel.paddingRect.width,
              height: preview.boxModel.paddingRect.height,
            }}
          />

          <div
            className="pointer-events-none fixed bg-[rgba(14,165,233,0.18)]"
            style={{
              zIndex: 2147482994 + index * 6,
              left: preview.boxModel.contentRect.left,
              top: preview.boxModel.contentRect.top,
              width: preview.boxModel.contentRect.width,
              height: preview.boxModel.contentRect.height,
            }}
          />

          {preview.gap.rects.map((gapRect, gapIndex) => (
            <div
              key={`${preview.id}-gap-${gapIndex}`}
              className="pointer-events-none fixed border border-fuchsia-400/60 bg-[rgba(217,70,239,0.16)]"
              style={{
                zIndex: 2147482995 + index * 6,
                left: gapRect.left,
                top: gapRect.top,
                width: gapRect.width,
                height: gapRect.height,
              }}
            />
          ))}

          <div
            className="pointer-events-none fixed border border-[#25C69C] bg-transparent shadow-[0_0_0_1px_rgba(37,198,156,0.2)]"
            style={{
              zIndex: 2147482996 + index * 6,
              left: preview.rect.left,
              top: preview.rect.top,
              width: preview.rect.width,
              height: preview.rect.height,
            }}
          />

          <div
            className="pointer-events-none fixed flex h-6 w-6 items-center justify-center bg-[#17242b] text-[11px] font-semibold text-white shadow-[0_10px_20px_rgba(15,23,42,0.24)]"
            style={{
              zIndex: 2147482997 + index * 6,
              left: Math.max(8, preview.rect.left - 6),
              top: Math.max(8, preview.rect.top - 6),
            }}
          >
            {index + 1}
          </div>
        </div>
      ))}

      {isActive && hoveredPreview && !hoveredIsSelected ? (
        <>
          <div
            className="pointer-events-none fixed border border-[#f59e0b]/60 bg-[rgba(245,158,11,0.08)]"
            style={{
              zIndex: 2147482997,
              left: hoveredPreview.boxModel.marginRect.left,
              top: hoveredPreview.boxModel.marginRect.top,
              width: hoveredPreview.boxModel.marginRect.width,
              height: hoveredPreview.boxModel.marginRect.height,
            }}
          />
          <div
            className="pointer-events-none fixed bg-[rgba(56,189,248,0.1)]"
            style={{
              zIndex: 2147482998,
              left: hoveredPreview.boxModel.paddingRect.left,
              top: hoveredPreview.boxModel.paddingRect.top,
              width: hoveredPreview.boxModel.paddingRect.width,
              height: hoveredPreview.boxModel.paddingRect.height,
            }}
          />
          <div
            className="pointer-events-none fixed bg-[rgba(14,165,233,0.12)]"
            style={{
              zIndex: 2147482999,
              left: hoveredPreview.boxModel.contentRect.left,
              top: hoveredPreview.boxModel.contentRect.top,
              width: hoveredPreview.boxModel.contentRect.width,
              height: hoveredPreview.boxModel.contentRect.height,
            }}
          />
          {hoveredPreview.gap.rects.map((gapRect, gapIndex) => (
            <div
              key={`hovered-gap-${gapIndex}`}
              className="pointer-events-none fixed border border-fuchsia-400/55 bg-[rgba(217,70,239,0.12)]"
              style={{
                zIndex: 2147483000,
                left: gapRect.left,
                top: gapRect.top,
                width: gapRect.width,
                height: gapRect.height,
              }}
            />
          ))}
          <div
            className="pointer-events-none fixed border border-[#25C69C] bg-transparent"
            style={{
              zIndex: 2147483001,
              left: hoveredPreview.rect.left,
              top: hoveredPreview.rect.top,
              width: hoveredPreview.rect.width,
              height: hoveredPreview.rect.height,
            }}
          />
          <div
            className="pointer-events-none fixed bg-[#25C69C] px-1.5 py-0.5 text-[10px] font-semibold text-white"
            style={{
              zIndex: 2147483002,
              left: Math.max(8, hoveredPreview.rect.left),
              top: Math.max(8, hoveredPreview.rect.top - 18),
            }}
          >
            {selectedPreviews.length + 1}
          </div>
        </>
      ) : null}

      {activePreview ? (
        <>
          <div
            data-kuma-picker-ui="true"
            className={`fixed z-[2147483004] max-w-[320px] border border-white/10 bg-[rgba(23,36,43,0.2)] px-3 py-2 text-xs text-white shadow-[0_16px_36px_rgba(15,23,42,0.24)] transition-colors duration-200 hover:bg-[rgba(23,36,43,0.9)] ${
              isActive ? "pointer-events-none" : "pointer-events-auto"
            }`}
            style={{
              left: Math.max(12, activePreview.rect.left),
              top:
                activePreview.rect.top > 88
                  ? activePreview.rect.top - 84
                  : activePreview.rect.top + activePreview.rect.height + 12,
            }}
          >
            <p className="truncate font-semibold">{activePreview.label}</p>
            <p className="mt-1 truncate text-[11px] text-white/70">{activePreview.selector}</p>
            {spacingMessage ? (
              <div className="mt-2 space-y-1 text-[11px] text-white/78">
                <p className="font-mono text-white">#{activeSelectionNumber}</p>
                <p className="font-mono">margin {spacingMessage.margin}</p>
                <p className="font-mono">padding {spacingMessage.padding}</p>
                <p className="font-mono">gap {spacingMessage.gap}</p>
                <p className="font-mono text-white/60">size {spacingMessage.size}</p>
                {spacingMessage.typography ? (
                  <>
                    <p className="font-mono text-white/60">
                      font-size {spacingMessage.typography.fontSize}
                    </p>
                    <p className="truncate font-mono text-white/60">
                      font-family {spacingMessage.typography.fontFamily}
                    </p>
                    <p className="font-mono text-white/60">
                      font-weight {spacingMessage.typography.fontWeight}
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            {activeSnapshotUrl ? (
              <div className={`mt-3 ${isActive ? "pointer-events-none" : "pointer-events-auto"}`}>
                <a
                  href={activeSnapshotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-full border border-white/12 bg-white/10 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-white/16"
                >
                  Open snapshot
                </a>
                <img
                  src={activeSnapshotUrl}
                  alt={`${activePreview.label} snapshot`}
                  className="mt-2 max-h-[128px] w-full rounded-[10px] border border-white/10 bg-white/5 object-contain"
                />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {position && renderedAgentNote ? (
        <div
          data-kuma-picker-ui="true"
          className={`pointer-events-none fixed z-[2147483002] max-w-[260px] rounded-[1rem] border px-3 py-2 text-[11px] shadow-[0_14px_32px_rgba(15,23,42,0.14)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform] ${agentNoteTone} ${
            isAgentNoteTransitionVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
          }`}
          style={{
            left: Math.max(12, position.x - 208),
            top: position.y > 112 ? position.y - 88 : position.y + 56,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">
              {renderedAgentNote.author} · {getKumaPickerAgentNoteStatusLabel(renderedAgentNote.status)}
            </p>
            <div className="flex items-center gap-2">
              {agentNoteTimeLabel ? <p className="text-[10px] opacity-70">{agentNoteTimeLabel}</p> : null}
              <button
                type="button"
                onClick={() => setDismissedAgentNoteKey(agentNoteKey)}
                className="pointer-events-auto inline-flex h-5 w-5 items-center justify-center rounded-full border border-current/15 bg-white/55 transition hover:bg-white/80"
                aria-label="Dismiss agent note"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
          <p className="mt-1 leading-5">{renderedAgentNote.message}</p>
        </div>
      ) : null}

      <div
        ref={widgetRef}
        data-kuma-picker-root="true"
        data-kuma-picker-ui="true"
        onPointerDown={handlePointerDown}
        className={`fixed left-0 top-0 isolate z-[2147483000] h-12 w-12 touch-none select-none transition-opacity duration-300 ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          opacity: position ? 1 : 0,
          pointerEvents: position ? "auto" : "none",
          transform: position ? `translate3d(${position.x}px, ${position.y}px, 0)` : "translate3d(-9999px, -9999px, 0)",
        }}
      >
        <button
          type="button"
          onClick={handleToggleClick}
          className={`absolute bottom-0 left-0 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border transition-[background-color,border-color,box-shadow,color,transform] duration-300 ${buttonTone}`}
          aria-pressed={isActive}
          aria-label="Toggle Kuma Picker"
          title="Toggle Kuma Picker (Cmd/Ctrl+Shift+X)"
          disabled={isSaving}
        >
          <FilledCursorIcon className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={handleClearClick}
          className={`absolute right-0 top-0 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#17242b] bg-[#17242b] text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)] transition-[opacity,transform] duration-200 ${
            selectedPreviews.length > 0 ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-75"
          }`}
          aria-label="Clear saved selection highlight"
          tabIndex={selectedPreviews.length > 0 ? 0 : -1}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </>
  );
}
