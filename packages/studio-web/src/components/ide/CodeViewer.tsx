import { useEffect, useRef } from "react";
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
  inline?: boolean;
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

export function CodeViewer({ content, language, filePath, onClose, inline }: CodeViewerProps) {
  const codeRef = useRef<HTMLElement>(null);
  const fileName = filePath.split("/").pop() || filePath;
  const badgeColor = LANG_COLOR[language] || "bg-stone-100 text-stone-500";

  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.removeAttribute("data-highlighted");
      try {
        hljs.highlightElement(codeRef.current);
      } catch {
        // language not registered — show plain text
      }
    }
  }, [content, language]);

  const lines = content.split("\n");

  const viewer = (
    <div
      className={
        inline
          ? "flex h-full w-full flex-col overflow-hidden bg-white"
          : "relative mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-stone-200/80 bg-white shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)]"
      }
      onClick={inline ? undefined : (e) => e.stopPropagation()}
      style={inline ? undefined : { animation: "slideUp 200ms ease-out" }}
    >
      {/* Tab bar header */}
      <div className="flex items-center border-b border-stone-200/80 bg-gradient-to-b from-stone-100 to-stone-50">
        <div className="flex items-center gap-2 px-4 py-2 border-b-2 border-amber-400 bg-white min-w-0">
          <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-stone-400" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M4.5 1.5h5l3 3v9.5a1 1 0 01-1 1h-7a1 1 0 01-1-1v-11.5a1 1 0 011-1z" />
            <path d="M9.5 1.5v3h3" />
          </svg>
          <span className="truncate text-[12px] font-medium text-stone-700">{fileName}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${badgeColor}`}>
            {language}
          </span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 mr-2 rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/80 hover:text-stone-600"
          title="닫기 (Esc)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Code area */}
      <div className="flex-1 overflow-auto bg-white">
        <table className="w-full border-collapse text-[12px] leading-[1.65]">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-amber-50/40 transition-colors duration-75">
                <td
                  className="select-none border-r border-stone-100/80 px-3 py-0 text-right font-mono text-[10px] text-stone-300 align-top"
                  style={{ minWidth: 44, width: 44 }}
                >
                  {i + 1}
                </td>
                <td className="px-4 py-0 font-mono whitespace-pre">
                  {line || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status bar footer */}
      <div className="flex items-center justify-between border-t border-stone-100 bg-gradient-to-b from-stone-50 to-stone-100/50 px-4 py-1.5">
        <span className="text-[10px] text-stone-400 truncate">{filePath}</span>
        <div className="flex items-center gap-3 text-[10px] text-stone-400">
          <span>{lines.length} lines</span>
          <span>{new Blob([content]).size.toLocaleString()} bytes</span>
        </div>
      </div>
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
