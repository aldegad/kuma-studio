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

export function CodeViewer({ content, language, filePath, onClose, onSave, inline }: CodeViewerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [saving, setSaving] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileName = filePath.split("/").pop() || filePath;
  const badgeColor = LANG_COLOR[language] || "bg-stone-100 text-stone-500";

  useEffect(() => { setEditContent(content); setIsEditing(false); }, [content]);

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
      setIsEditing(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };

  // Highlight the whole buffer once, then pair per-line HTML with a gutter so
  // span state across multi-line strings/comments stays intact.
  const highlightedHtml = useMemo(() => {
    const lang = normalizeLang(language);
    if (!lang) return escapeHtml(content);
    try {
      return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(content);
    }
  }, [content, language]);

  const lineCount = useMemo(() => {
    if (!content) return 1;
    // A trailing newline should not render an extra empty gutter row.
    const raw = content.split("\n");
    if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop();
    return Math.max(raw.length, 1);
  }, [content]);

  const gutterWidth = `${Math.max(2, String(lineCount).length) * 0.62 + 1.2}rem`;

  const viewer = (
    <div
      className={
        inline
          ? "flex h-full w-full flex-col overflow-hidden"
          : "relative mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)]"
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
        {!isEditing && (
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
              onClick={() => void handleCopy()}
              className="shrink-0 mr-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{ color: copied ? "#10b981" : "var(--t-faint)" }}
              title="전체 복사"
            >
              {copied ? "✓ 복사됨" : "복사"}
            </button>
          </>
        )}
        {isEditing ? (
          <div className="flex items-center gap-1 mr-2">
            <button type="button" onClick={() => { setEditContent(content); setIsEditing(false); }} className="rounded px-2 py-0.5 text-[10px] font-medium transition-colors" style={{ color: "var(--t-muted)" }}>취소</button>
            <button type="button" onClick={() => void handleSave()} disabled={saving} className="rounded px-2.5 py-0.5 text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 transition-colors">{saving ? "저장 중..." : "저장"}</button>
          </div>
        ) : (
          <button type="button" onClick={() => setIsEditing(true)} className="shrink-0 mr-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors" style={{ color: "var(--t-faint)" }} title="편집">편집</button>
        )}
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
      {isEditing ? (
        <div className="flex-1 overflow-auto" style={{ background: "var(--ide-bg-alt)" }}>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-full min-h-[200px] p-4 font-mono text-[12px] leading-[1.65] outline-none resize-none"
            style={{ background: "var(--ide-bg-alt)", color: "var(--t-primary)", tabSize: 2 }}
            spellCheck={false}
          />
        </div>
      ) : (
        <div
          ref={scrollerRef}
          className="kuma-code-scroll flex-1 overflow-auto"
          style={{ background: "var(--ide-bg-alt)" }}
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
              <code
                className="hljs"
                style={{ background: "transparent", padding: 0 }}
                dangerouslySetInnerHTML={{ __html: highlightedHtml || "&nbsp;" }}
              />
            </pre>
          </div>
        </div>
      )}

      {/* Status bar footer */}
      <div className="flex items-center justify-between border-t px-4 py-1.5" style={{ borderColor: "var(--border-subtle)", background: `linear-gradient(to bottom, var(--ide-header-to), var(--ide-header-from))` }}>
        <span className="text-[10px] truncate" style={{ color: "var(--t-faint)" }}>{filePath}</span>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--t-faint)" }}>
          {isEditing && <span className="text-amber-500 font-medium">편집 중</span>}
          <span>{lineCount} lines</span>
          <span>{new Blob([isEditing ? editContent : content]).size.toLocaleString()} bytes</span>
        </div>
      </div>

      {/* Scoped dark-theme overrides for highlight.js (github.css is tuned for light). */}
      <style>{`
        .kuma-code-scroll pre { font-family: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace; }
        .kuma-code-scroll ::selection { background: rgba(245, 158, 11, 0.25); }
        .kuma-code-body code.hljs { display: block; }
        [data-theme="night"] .kuma-code-scroll .hljs { color: #e2e8f0; background: transparent; }
        [data-theme="night"] .kuma-code-scroll .hljs-comment,
        [data-theme="night"] .kuma-code-scroll .hljs-quote { color: #7a8aa3; font-style: italic; }
        [data-theme="night"] .kuma-code-scroll .hljs-keyword,
        [data-theme="night"] .kuma-code-scroll .hljs-selector-tag,
        [data-theme="night"] .kuma-code-scroll .hljs-literal,
        [data-theme="night"] .kuma-code-scroll .hljs-meta-keyword { color: #c4b5fd; }
        [data-theme="night"] .kuma-code-scroll .hljs-string,
        [data-theme="night"] .kuma-code-scroll .hljs-regexp,
        [data-theme="night"] .kuma-code-scroll .hljs-addition { color: #86efac; }
        [data-theme="night"] .kuma-code-scroll .hljs-number,
        [data-theme="night"] .kuma-code-scroll .hljs-symbol,
        [data-theme="night"] .kuma-code-scroll .hljs-meta { color: #fcd34d; }
        [data-theme="night"] .kuma-code-scroll .hljs-title,
        [data-theme="night"] .kuma-code-scroll .hljs-title.function_,
        [data-theme="night"] .kuma-code-scroll .hljs-section { color: #93c5fd; }
        [data-theme="night"] .kuma-code-scroll .hljs-attr,
        [data-theme="night"] .kuma-code-scroll .hljs-attribute,
        [data-theme="night"] .kuma-code-scroll .hljs-name,
        [data-theme="night"] .kuma-code-scroll .hljs-variable,
        [data-theme="night"] .kuma-code-scroll .hljs-template-variable { color: #fca5a5; }
        [data-theme="night"] .kuma-code-scroll .hljs-type,
        [data-theme="night"] .kuma-code-scroll .hljs-built_in,
        [data-theme="night"] .kuma-code-scroll .hljs-class .hljs-title { color: #67e8f9; }
        [data-theme="night"] .kuma-code-scroll .hljs-deletion { color: #fca5a5; }
        [data-theme="night"] .kuma-code-scroll .hljs-tag,
        [data-theme="night"] .kuma-code-scroll .hljs-punctuation { color: #cbd5e1; }
        [data-theme="night"] .kuma-code-scroll ::selection { background: rgba(251, 191, 36, 0.30); }
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
