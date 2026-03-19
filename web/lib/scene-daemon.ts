import type { KumaPickerScene, KumaPickerStudy, KumaPickerSyncState, KumaPickerViewport } from "./types";

const DEFAULT_DAEMON_URL = "http://127.0.0.1:4312";
type RawViewport = KumaPickerViewport | "mark";

export interface KumaPickerSceneEvent {
  type: "scene.updated";
  source: string;
  revision?: number;
  updatedAt?: string;
}

function isViewport(value: unknown): value is RawViewport {
  return value === "desktop" || value === "mobile" || value === "original" || value === "mark";
}

function normalizeZoom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

function normalizeSelectedStudyId(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeNode(rawNode: unknown): KumaPickerStudy | null {
  if (!rawNode || typeof rawNode !== "object") return null;

  const candidate = rawNode as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.itemId !== "string" ||
    typeof candidate.title !== "string" ||
    !isViewport(candidate.viewport)
  ) {
    return null;
  }

  const x = typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : 0;
  const y = typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : 0;
  const zIndex = typeof candidate.zIndex === "number" && Number.isFinite(candidate.zIndex) ? candidate.zIndex : 1;

  return {
    id: candidate.id,
    itemId: candidate.itemId,
    title: candidate.title,
    viewport: (candidate.viewport === "mark" ? "original" : candidate.viewport) as KumaPickerViewport,
    x,
    y,
    zIndex,
    hidden: Boolean(candidate.hidden),
    locked: Boolean(candidate.locked),
    propsPatch:
      candidate.propsPatch && typeof candidate.propsPatch === "object"
        ? (candidate.propsPatch as Record<string, unknown>)
        : {},
  };
}

export function getKumaPickerDaemonUrl() {
  const raw = process.env.NEXT_PUBLIC_KUMA_PICKER_DAEMON_URL ?? DEFAULT_DAEMON_URL;
  return raw.replace(/\/$/, "");
}

export function getKumaPickerEventsUrl() {
  return `${getKumaPickerDaemonUrl()}/events`;
}

export function normalizeScene(scene: unknown): KumaPickerScene {
  if (!scene || typeof scene !== "object") {
    return {
      version: 1,
      meta: { zoom: 1, revision: 0 },
      nodes: [],
    };
  }

  const candidate = scene as Record<string, unknown>;
  const version =
    typeof candidate.version === "number" && Number.isInteger(candidate.version) && candidate.version > 0
      ? candidate.version
      : 1;

  const meta = candidate.meta && typeof candidate.meta === "object" ? (candidate.meta as Record<string, unknown>) : {};
  const rawNodes = Array.isArray(candidate.nodes) ? candidate.nodes : [];
  const nodes = rawNodes
    .map((rawNode) => normalizeNode(rawNode))
    .filter((node): node is KumaPickerStudy => Boolean(node))
    .sort((left, right) => left.zIndex - right.zIndex);

  return {
    version,
    meta: {
      zoom: normalizeZoom(meta.zoom),
      revision:
        typeof meta.revision === "number" && Number.isInteger(meta.revision) && meta.revision >= 0 ? meta.revision : 0,
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : undefined,
      selectedStudyId: normalizeSelectedStudyId(meta.selectedStudyId),
    },
    nodes,
  };
}

async function requestScene(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return normalizeScene(null);
  }

  return normalizeScene(await response.json());
}

export async function fetchScene(signal?: AbortSignal) {
  return requestScene(`${getKumaPickerDaemonUrl()}/scene`, {
    method: "GET",
    signal,
  });
}

export async function updateSceneMeta(
  updates: Partial<Pick<KumaPickerScene["meta"], "selectedStudyId">>,
  signal?: AbortSignal,
) {
  return requestScene(`${getKumaPickerDaemonUrl()}/scene/meta`, {
    method: "PATCH",
    body: JSON.stringify(updates),
    signal,
  });
}

export async function addSceneNode(node: KumaPickerStudy, signal?: AbortSignal) {
  return requestScene(`${getKumaPickerDaemonUrl()}/scene/nodes`, {
    method: "POST",
    body: JSON.stringify({
      id: node.id,
      itemId: node.itemId,
      title: node.title,
      viewport: node.viewport,
      x: node.x,
      y: node.y,
      zIndex: node.zIndex,
      hidden: Boolean(node.hidden),
      locked: Boolean(node.locked),
      propsPatch: node.propsPatch ?? {},
    }),
    signal,
  });
}

export async function updateSceneNode(
  nodeId: string,
  updates: Partial<Pick<KumaPickerStudy, "title" | "viewport" | "x" | "y" | "zIndex" | "hidden" | "locked" | "propsPatch">>,
  signal?: AbortSignal,
) {
  return requestScene(`${getKumaPickerDaemonUrl()}/scene/nodes/${nodeId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
    signal,
  });
}

export async function removeSceneNode(nodeId: string, signal?: AbortSignal) {
  return requestScene(`${getKumaPickerDaemonUrl()}/scene/nodes/${nodeId}`, {
    method: "DELETE",
    signal,
  });
}

export function createSceneEventSource() {
  return new EventSource(getKumaPickerEventsUrl());
}

export function parseSceneEvent(raw: string): KumaPickerSceneEvent | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type !== "scene.updated") return null;

    return {
      type: "scene.updated",
      source: typeof parsed.source === "string" ? parsed.source : "unknown",
      revision: typeof parsed.revision === "number" ? parsed.revision : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function getSyncStateLabel(state: KumaPickerSyncState) {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "saving":
      return "Saving";
    case "offline":
      return "Daemon Offline";
    case "conflict":
      return "Remote Changed";
    default:
      return "Synced";
  }
}
