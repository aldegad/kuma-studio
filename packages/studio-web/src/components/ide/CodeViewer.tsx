import { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import "highlight.js/styles/github.css";
import { MarkdownBody } from "../dashboard/MarkdownBody";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("sql", sql);

interface CodeViewerProps {
  content: string;
  language: string;
  filePath: string;
  onClose: () => void;
  onSave?: (newContent: string) => void;
  inline?: boolean;
  initialScroll?: { top: number; left: number };
  onScrollPositionChange?: (position: { top: number; left: number }) => void;
}

// Map server-reported language tokens to the hljs identifiers we registered above.
const LANG_ALIAS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  htm: "html",
};

function normalizeLang(raw: string): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "plaintext" || lower === "text" || lower === "txt") return null;
  const mapped = LANG_ALIAS[lower] ?? lower;
  return hljs.getLanguage(mapped) ? mapped : null;
}

// Language badge color
const LANG_COLOR: Record<string, string> = {
  typescript: "bg-blue-100 text-blue-700",
  javascript: "bg-yellow-100 text-yellow-700",
  json: "bg-emerald-100 text-emerald-700",
  python: "bg-sky-100 text-sky-700",
  css: "bg-purple-100 text-purple-700",
  html: "bg-orange-100 text-orange-700",
  markdown: "bg-stone-200 text-stone-600",
  bash: "bg-lime-100 text-lime-700",
  yaml: "bg-rose-100 text-rose-700",
  sql: "bg-indigo-100 text-indigo-700",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readEditableText(element: HTMLElement): string {
  return element.innerText.replace(/\u00a0/g, " ");
}

function focusEditableEnd(element: HTMLElement) {
  element.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertTextAtSelection(text: string): boolean {
  if (typeof document !== "undefined" && typeof document.execCommand === "function") {
    return document.execCommand("insertText", false, text);
  }
  return false;
}

export function CodeViewer({
  content,
  language,
  filePath,
  onClose,
  onSave,
  inline,
  initialScroll,
  onScrollPositionChange,
}: CodeViewerProps) {
  const initialViewMode = normalizeLang(language) === "markdown" ? "preview" : "code";
  const [editContent, setEditContent] = useState(content);
  const [saving, setSaving] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"code" | "preview">(initialViewMode);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const previewScrollerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const appliedScrollKeyRef = useRef("");
  const fileName = filePath.split("/").pop() || filePath;
  const badgeColor = LANG_COLOR[language] || "bg-stone-100 text-stone-500";
  const isDirty = editContent !== content;

  useEffect(() => {
    setEditContent(content);
    setViewMode(normalizeLang(language) === "markdown" ? "preview" : "code");
    setPdfError(null);
  }, [content, language]);

  useEffect(() => {
    const element = viewMode === "preview" ? previewScrollerRef.current : scrollerRef.current;
    if (!element || !initialScroll) {
      return;
    }
    const scrollKey = `${filePath}:${viewMode}`;
    if (appliedScrollKeyRef.current === scrollKey) {
      return;
    }
    appliedScrollKeyRef.current = scrollKey;
    window.requestAnimationFrame(() => {
      element.scrollTop = initialScroll.top;
      element.scrollLeft = initialScroll.left;
    });
  }, [filePath, initialScroll, viewMode]);

  useEffect(() => {
    if (!editorRef.current || viewMode !== "code") return;
    if (readEditableText(editorRef.current) !== editContent) {
      editorRef.current.textContent = editContent;
    }
  }, [editContent, viewMode]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const port = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
      const base = `http://${window.location.hostname}:${port}`;
      const r = await fetch(`${base}/studio/fs/write`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content: editContent }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || "Save failed");
      onSave?.(editContent);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };

  // Highlight the whole buffer once, then pair per-line HTML with a gutter so
  // span state across multi-line strings/comments stays intact.
  const highlightedHtml = useMemo(() => {
    const lang = normalizeLang(language);
    if (!lang) return escapeHtml(editContent);
    try {
      return hljs.highlight(editContent, { language: lang, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(editContent);
    }
  }, [editContent, language]);

  const normalizedLanguage = useMemo(() => normalizeLang(language), [language]);
  const canPreviewMarkdown = normalizedLanguage === "markdown";

  const handleDownloadMarkdownPdf = async () => {
    if (!canPreviewMarkdown || isDirty || pdfDownloading) return;
    setPdfDownloading(true);
    setPdfError(null);

    try {
      const port = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
      const base = `http://${window.location.hostname}:${port}`;
      const response = await fetch(`${base}/studio/fs/markdown-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });

      if (!response.ok) {
        let message = "PDF 다운로드 실패";
        try {
          const data = await response.json();
          message = data.details || data.error || message;
        } catch {
          message = await response.text();
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName.replace(/\.(md|mdx)$/iu, ".pdf");
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "PDF 다운로드 실패");
    } finally {
      setPdfDownloading(false);
    }
  };

  const lineCount = useMemo(() => {
    if (!editContent) return 1;
    // A trailing newline should not render an extra empty gutter row.
    const raw = editContent.split("\n");
    if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop();
    return Math.max(raw.length, 1);
  }, [editContent]);

  const gutterWidth = `${Math.max(2, String(lineCount).length) * 0.62 + 1.2}rem`;

  const syncFromEditor = () => {
    if (!editorRef.current) return;
    setEditContent(readEditableText(editorRef.current));
  };

  const handleUndo = () => {
    if (!editorRef.current) return;
    focusEditableEnd(editorRef.current);
    document.execCommand?.("undo");
    window.requestAnimationFrame(syncFromEditor);
  };

  const handleRedo = () => {
    if (!editorRef.current) return;
    focusEditableEnd(editorRef.current);
    document.execCommand?.("redo");
    window.requestAnimationFrame(syncFromEditor);
  };

  const viewer = (
    <div
      className={
        inline
          ? "flex h-full w-full flex-col overflow-hidden"
          : "relative mx-4 flex max-h-[85vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)]"
      }
      onClick={inline ? undefined : (e) => e.stopPropagation()}
      style={{
        background: "var(--ide-bg-alt)",
        borderColor: "var(--card-border)",
        ...(inline ? {} : { animation: "slideUp 200ms ease-out" }),
      }}
    >
      {/* Tab bar header */}
      <div className="flex items-center border-b" style={{ borderColor: "var(--card-border)", background: `linear-gradient(to bottom, var(--ide-header-from), var(--ide-header-to))` }}>
        <div className="flex items-center gap-2 px-4 py-2 border-b-2 border-amber-400 min-w-0" style={{ background: "var(--ide-bg-alt)" }}>
          <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0" style={{ color: "var(--t-faint)" }} fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M4.5 1.5h5l3 3v9.5a1 1 0 01-1 1h-7a1 1 0 01-1-1v-11.5a1 1 0 011-1z" />
            <path d="M9.5 1.5v3h3" />
          </svg>
          <span className="truncate text-[12px] font-medium" style={{ color: "var(--t-secondary)" }}>{fileName}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${badgeColor}`}>
            {language}
          </span>
        </div>
        <div className="flex-1" />
        {viewMode === "code" && (
          <>
            <button
              type="button"
              onClick={() => setWrap((v) => !v)}
              className="shrink-0 mr-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{ color: wrap ? "var(--t-primary)" : "var(--t-faint)", background: wrap ? "var(--badge-bg)" : "transparent" }}
              title={wrap ? "줄바꿈 끄기" : "줄바꿈 켜기"}
            >
              {wrap ? "↵ 줄바꿈" : "→ 한 줄"}
            </button>
            <button
              type="button"
              onClick={handleUndo}
              className="shrink-0 mr-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{ color: "var(--t-faint)" }}
              title="되돌리기"
            >
              되돌리기
            </button>
            <button
              type="button"
              onClick={handleRedo}
              className="shrink-0 mr-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{ color: "var(--t-faint)" }}
              title="다시 실행"
            >
              다시실행
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="shrink-0 mr-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{ color: copied ? "#10b981" : "var(--t-faint)" }}
              title="전체 복사"
            >
              {copied ? "✓ 복사됨" : "복사"}
            </button>
          </>
        )}
        {canPreviewMarkdown && (
          <>
            <button
              type="button"
              onClick={() => void handleDownloadMarkdownPdf()}
              disabled={isDirty || pdfDownloading}
              className="shrink-0 mr-1 rounded px-2 py-0.5 text-[10px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                color: pdfError ? "#dc2626" : "var(--t-primary)",
                background: pdfError ? "rgba(220,38,38,0.1)" : "var(--badge-bg)",
              }}
              title={isDirty ? "수정 내용을 저장한 뒤 PDF로 받을 수 있습니다." : pdfError || "Markdown을 PDF로 다운로드"}
            >
              {pdfDownloading ? "PDF 생성 중" : pdfError ? "PDF 실패" : "PDF"}
            </button>
            <button
              type="button"
              onClick={() => setViewMode((current) => (current === "preview" ? "code" : "preview"))}
              className="shrink-0 mr-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{
                color: viewMode === "preview" ? "var(--t-primary)" : "var(--t-faint)",
                background: viewMode === "preview" ? "var(--badge-bg)" : "transparent",
              }}
              title={viewMode === "preview" ? "코드 보기" : "프리뷰 보기"}
            >
              {viewMode === "preview" ? "코드" : "프리뷰"}
            </button>
          </>
        )}
        {isDirty || saving ? (
          <div className="flex items-center gap-1 mr-2">
            <button
              type="button"
              onClick={() => {
                setEditContent(content);
                if (editorRef.current) {
                  editorRef.current.textContent = content;
                }
              }}
              className="rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{ color: "var(--t-muted)" }}
            >
              취소
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={saving} className="rounded px-2.5 py-0.5 text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 transition-colors">{saving ? "저장 중..." : "저장"}</button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 mr-2 rounded p-1 transition-colors"
          style={{ color: "var(--t-faint)" }}
          title="닫기 (Esc)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Code area */}
      {viewMode === "preview" && canPreviewMarkdown ? (
        <div
          ref={previewScrollerRef}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          style={{ background: "var(--ide-bg-alt)" }}
          onScroll={(event) => {
            onScrollPositionChange?.({
              top: event.currentTarget.scrollTop,
              left: event.currentTarget.scrollLeft,
            });
          }}
        >
          {editContent ? (
            <MarkdownBody content={editContent} />
          ) : (
            <p className="text-[11px] italic" style={{ color: "var(--t-faint)" }}>(내용 없음)</p>
          )}
        </div>
      ) : (
        <div
          ref={scrollerRef}
          className="kuma-code-scroll flex-1 overflow-auto"
          style={{ background: "var(--ide-bg-alt)" }}
          onScroll={(event) => {
            onScrollPositionChange?.({
              top: event.currentTarget.scrollTop,
              left: event.currentTarget.scrollLeft,
            });
          }}
        >
          <div className="flex min-h-full items-stretch">
            {/* Line-number gutter — sticky on horizontal scroll so numbers stay visible. */}
            <pre
              aria-hidden="true"
              className="kuma-code-gutter sticky left-0 z-[1] select-none text-right font-mono text-[11px] leading-[1.65] py-3 pl-3 pr-3 border-r"
              style={{
                width: gutterWidth,
                minWidth: gutterWidth,
                color: "var(--t-faint)",
                borderColor: "var(--border-subtle)",
                background: "var(--ide-bg)",
                margin: 0,
              }}
            >
              {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
            </pre>
            {/* Highlighted code */}
            <pre
              className={`kuma-code-body flex-1 font-mono text-[12px] leading-[1.65] py-3 px-4 ${wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
              style={{ margin: 0, tabSize: 2, color: "var(--t-primary)" }}
            >
              <div className="relative min-h-full">
                <code
                  aria-hidden="true"
                  className="hljs pointer-events-none block"
                  style={{ background: "transparent", padding: 0 }}
                  dangerouslySetInnerHTML={{ __html: highlightedHtml || "&nbsp;" }}
                />
                <div
                  ref={editorRef}
                  contentEditable="plaintext-only"
                  suppressContentEditableWarning
                  spellCheck={false}
                  onInput={syncFromEditor}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                      event.preventDefault();
                      if (isDirty && !saving) {
                        void handleSave();
                      }
                      return;
                    }

                    if (event.key === "Tab") {
                      event.preventDefault();
                      if (!insertTextAtSelection("\t")) {
                        const selection = window.getSelection();
                        if (selection?.rangeCount) {
                          const range = selection.getRangeAt(0);
                          range.deleteContents();
                          range.insertNode(document.createTextNode("\t"));
                          range.collapse(false);
                          selection.removeAllRanges();
                          selection.addRange(range);
                        }
                      }
                      window.requestAnimationFrame(syncFromEditor);
                    }
                  }}
                  className={`absolute inset-0 font-mono text-[12px] leading-[1.65] outline-none ${wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
                  style={{
                    margin: 0,
                    padding: 0,
                    tabSize: 2,
                    color: "transparent",
                    caretColor: "var(--t-primary)",
                    background: "transparent",
                  }}
                />
              </div>
            </pre>
          </div>
        </div>
      )}

      {/* Status bar footer */}
      <div className="flex items-center justify-between border-t px-4 py-1.5" style={{ borderColor: "var(--border-subtle)", background: `linear-gradient(to bottom, var(--ide-header-to), var(--ide-header-from))` }}>
        <span className="text-[10px] truncate" style={{ color: "var(--t-faint)" }}>{filePath}</span>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--t-faint)" }}>
          {isDirty && <span className="text-amber-500 font-medium">수정됨</span>}
          {canPreviewMarkdown && viewMode === "preview" && <span>preview mode</span>}
          <span>{lineCount} lines</span>
          <span>{new Blob([editContent]).size.toLocaleString()} bytes</span>
        </div>
      </div>

      <style>{`
        .kuma-code-scroll pre { font-family: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace; }
        .kuma-code-scroll ::selection { background: rgba(245, 158, 11, 0.25); }
        .kuma-code-body [contenteditable="plaintext-only"]::selection { background: rgba(245, 158, 11, 0.25); }
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
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
    </div>
  );
}
