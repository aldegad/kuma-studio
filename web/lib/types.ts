import type { ComponentType } from "react";

export type KumaPickerSourceKind = "project" | "draft" | "page-import";
export type KumaPickerViewport = "desktop" | "mobile" | "original";
export type KumaPickerSyncState = "connecting" | "connected" | "saving" | "offline" | "conflict";
export type KumaPickerRenderKind = "component" | "asset";

export interface KumaPickerViewportConfig {
  key: KumaPickerViewport;
  label: string;
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  frameHeight: number;
  nodeWidth: number;
  nodeHeight: number;
}

interface KumaPickerItemBase {
  id: string;
  title: string;
  shortLabel: string;
  description?: string | null;
  sourceKind: KumaPickerSourceKind;
  category: string;
  componentPath: string;
  sourceRoute?: string | null;
  sourceFilePath?: string | null;
  tags: string[];
  recommendedViewport: KumaPickerViewport;
  renderKind: KumaPickerRenderKind;
}

export interface KumaPickerComponentDraftItem extends KumaPickerItemBase {
  renderKind: "component";
  Component: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
}

export interface KumaPickerAssetDraftItem extends KumaPickerItemBase {
  renderKind: "asset";
  assetUrl: string;
}

export type KumaPickerComponentItem = KumaPickerComponentDraftItem | KumaPickerAssetDraftItem;

export interface KumaPickerStudy {
  id: string;
  itemId: string;
  title: string;
  viewport: KumaPickerViewport;
  x: number;
  y: number;
  zIndex: number;
  hidden?: boolean;
  locked?: boolean;
  propsPatch?: Record<string, unknown>;
}

export interface KumaPickerSceneMeta {
  zoom?: number;
  revision?: number;
  updatedAt?: string;
  selectedStudyId?: string | null;
}

export interface KumaPickerSceneNode {
  id: string;
  itemId: string;
  title: string;
  viewport: KumaPickerViewport;
  x: number;
  y: number;
  zIndex: number;
  hidden?: boolean;
  locked?: boolean;
  propsPatch?: Record<string, unknown>;
}

export interface KumaPickerScene {
  version: number;
  meta: KumaPickerSceneMeta;
  nodes: KumaPickerSceneNode[];
}

export const kumaPickerCanvas = {
  minWidth: 1080,
  minHeight: 640,
  maxWidth: 3200,
  maxHeight: 3200,
  padding: 24,
};

export const kumaPickerViewports: Record<KumaPickerViewport, KumaPickerViewportConfig> = {
  desktop: {
    key: "desktop",
    label: "Desktop",
    canvasWidth: 1440,
    canvasHeight: 2080,
    scale: 0.2,
    frameHeight: 280,
    nodeWidth: 360,
    nodeHeight: 280,
  },
  mobile: {
    key: "mobile",
    label: "Mobile",
    canvasWidth: 390,
    canvasHeight: 844,
    scale: 0.56,
    frameHeight: 332,
    nodeWidth: 260,
    nodeHeight: 380,
  },
  original: {
    key: "original",
    label: "Original",
    canvasWidth: 720,
    canvasHeight: 720,
    scale: 0.3,
    frameHeight: 200,
    nodeWidth: 200,
    nodeHeight: 200,
  },
};

export const kumaPickerViewportList = Object.values(kumaPickerViewports);

export function clampCanvasPosition(viewport: KumaPickerViewport, x: number, y: number) {
  const config = kumaPickerViewports[viewport];
  const maxX = kumaPickerCanvas.maxWidth - config.nodeWidth;
  const maxY = kumaPickerCanvas.maxHeight - config.nodeHeight;

  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

export function getCanvasBounds(studies: Pick<KumaPickerStudy, "viewport" | "x" | "y">[]) {
  let width = studies.length > 0 ? 0 : kumaPickerCanvas.minWidth;
  let height = studies.length > 0 ? 0 : kumaPickerCanvas.minHeight;

  for (const study of studies) {
    const config = kumaPickerViewports[study.viewport];
    width = Math.max(width, study.x + config.nodeWidth + kumaPickerCanvas.padding);
    height = Math.max(height, study.y + config.nodeHeight + kumaPickerCanvas.padding);
  }

  return {
    width: Math.min(kumaPickerCanvas.maxWidth, Math.round(width)),
    height: Math.min(kumaPickerCanvas.maxHeight, Math.round(height)),
  };
}
