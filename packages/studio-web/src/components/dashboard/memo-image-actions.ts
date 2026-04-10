const MEMO_IMAGE_FETCH_ERROR = "메모 이미지를 불러오지 못했습니다.";
const MEMO_IMAGE_COPY_UNSUPPORTED_ERROR = "이 브라우저에서는 이미지 클립보드 복사가 지원되지 않습니다.";

export interface MemoImageActionOptions {
  fetchImpl?: typeof fetch;
  clipboard?: Pick<Clipboard, "write">;
  clipboardItemCtor?: typeof ClipboardItem;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  createAnchor?: () => Pick<HTMLAnchorElement, "href" | "download" | "click" | "rel">;
}

function sanitizeFilename(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "memo-image";
  }

  return trimmed
    .replace(/[\\/:*?"<>|]/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "memo-image";
}

function inferImageMimeType(url: string) {
  const normalized = url.toLowerCase();
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }
  return "image/png";
}

export function buildMemoImageFilename(url: string, fallbackTitle = "memo-image") {
  try {
    const resolved = new URL(url, "http://localhost");
    const fileName = resolved.pathname.split("/").pop()?.trim() ?? "";
    if (fileName) {
      return sanitizeFilename(fileName);
    }
  } catch {
    // Fall through to the title-based fallback.
  }

  const safeBaseName = sanitizeFilename(fallbackTitle);
  return safeBaseName.includes(".") ? safeBaseName : `${safeBaseName}.png`;
}

async function fetchMemoImageBlob(url: string, fetchImpl?: typeof fetch) {
  const activeFetch = fetchImpl ?? globalThis.fetch;
  if (typeof activeFetch !== "function") {
    throw new Error(MEMO_IMAGE_FETCH_ERROR);
  }

  const response = await activeFetch(url);
  if (!response.ok) {
    throw new Error(MEMO_IMAGE_FETCH_ERROR);
  }

  return response.blob();
}

export async function downloadMemoImage(url: string, fallbackTitle?: string, options: MemoImageActionOptions = {}) {
  const blob = await fetchMemoImageBlob(url, options.fetchImpl);
  const createObjectUrl = options.createObjectUrl ?? URL.createObjectURL;
  const revokeObjectUrl = options.revokeObjectUrl ?? URL.revokeObjectURL;
  const createAnchor = options.createAnchor ?? (() => document.createElement("a"));
  const filename = buildMemoImageFilename(url, fallbackTitle);
  const objectUrl = createObjectUrl(blob);
  const anchor = createAnchor();

  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  revokeObjectUrl(objectUrl);

  return filename;
}

export async function copyMemoImageToClipboard(url: string, options: MemoImageActionOptions = {}) {
  const clipboard = options.clipboard ?? globalThis.navigator?.clipboard;
  const ClipboardItemCtor = options.clipboardItemCtor ?? globalThis.ClipboardItem;
  if (!clipboard?.write || !ClipboardItemCtor) {
    throw new Error(MEMO_IMAGE_COPY_UNSUPPORTED_ERROR);
  }

  const blob = await fetchMemoImageBlob(url, options.fetchImpl);
  const mimeType = blob.type || inferImageMimeType(url);
  const clipboardBlob = blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType);

  await clipboard.write([
    new ClipboardItemCtor({
      [clipboardBlob.type]: clipboardBlob,
    }),
  ]);

  return clipboardBlob.type;
}
