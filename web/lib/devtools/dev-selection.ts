import { getKumaPickerDaemonUrl } from "../scene-daemon";

export interface DevSelectionEdges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DevSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DevSelectionTypographyRecord {
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
}

export interface DevSelectionSnapshotRecord {
  assetUrl: string;
  mimeType: string;
  width: number;
  height: number;
  capturedAt: string;
}

export interface DevSelectionSnapshotPayload {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  capturedAt?: string;
}

export interface DevSelectionSessionRecord {
  id: string;
  label: string;
  index: number;
  updatedAt: string;
}

export interface DevSelectionRecord {
  version: 1;
  capturedAt: string;
  page: {
    url: string;
    pathname: string;
    title: string;
  };
  session: DevSelectionSessionRecord;
  element: DevSelectionElementRecord;
  elements: DevSelectionElementRecord[];
}

export interface DevSelectionSaveRecord extends Omit<DevSelectionRecord, "element" | "elements"> {
  element: DevSelectionSaveElementRecord;
  elements: DevSelectionSaveElementRecord[];
}

export interface DevSelectionCollection {
  version: 1;
  updatedAt: string;
  latestSessionId: string | null;
  sessions: DevSelectionRecord[];
}

export interface DevSelectionElementRecord {
  tagName: string;
  id: string | null;
  classNames: string[];
  role: string | null;
  label?: string | null;
  textPreview: string;
  value?: string | null;
  valuePreview?: string | null;
  checked?: boolean | null;
  selectedValue?: string | null;
  selectedValues?: string[];
  placeholder?: string | null;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  multiple?: boolean;
  inputType?: string | null;
  selector: string;
  selectorPath: string;
  dataset: Record<string, string>;
  rect: DevSelectionRect;
  boxModel: {
    margin: DevSelectionEdges;
    padding: DevSelectionEdges;
    border: DevSelectionEdges;
    marginRect: DevSelectionRect;
    paddingRect: DevSelectionRect;
    contentRect: DevSelectionRect;
  };
  typography?: DevSelectionTypographyRecord | null;
  snapshot?: DevSelectionSnapshotRecord | null;
  outerHTMLSnippet: string;
}

export interface DevSelectionSaveElementRecord extends Omit<DevSelectionElementRecord, "snapshot"> {
  snapshot?: DevSelectionSnapshotPayload | null;
}

export function getKumaPickerDevSelectionEndpoint(sessionId?: string): string {
  const endpoint = new URL(`${getKumaPickerDaemonUrl()}/dev-selection`);
  if (sessionId) {
    endpoint.searchParams.set("sessionId", sessionId);
  }

  return endpoint.toString();
}

export function getKumaPickerDevSelectionSessionEndpoint(sessionId: string): string {
  const endpoint = new URL(`${getKumaPickerDaemonUrl()}/dev-selection/session`);
  endpoint.searchParams.set("sessionId", sessionId);
  return endpoint.toString();
}

export function getKumaPickerDevSelectionAssetUrl(assetUrl: string): string {
  return new URL(assetUrl, getKumaPickerDaemonUrl()).toString();
}
