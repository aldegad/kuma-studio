import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { MarkdownBody } from "../components/dashboard/MarkdownBody";

const KUMA_PORT = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
const BASE_URL = `http://${window.location.hostname}:${KUMA_PORT}`;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; content: string; filePath: string }
  | { status: "error"; message: string; filePath: string | null };

function displayNameFromPath(filePath: string) {
  return filePath.split("/").filter(Boolean).pop() || "markdown";
}

export function MarkdownPrintPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const filePath = params.get("path");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    if (!filePath) {
      setState({ status: "error", message: "Missing markdown path.", filePath: null });
      return () => { cancelled = true; };
    }

    void (async () => {
      try {
        const response = await fetch(`${BASE_URL}/studio/fs/read?path=${encodeURIComponent(filePath)}`);
        const data = await response.json();
        if (cancelled) return;

        if (!response.ok || data.error) {
          setState({ status: "error", message: data.error || "Failed to read markdown file.", filePath });
          return;
        }

        if (typeof data.content !== "string" || data.language !== "markdown") {
          setState({ status: "error", message: "The selected file is not a Markdown document.", filePath });
          return;
        }

        document.title = `${displayNameFromPath(filePath).replace(/\.(md|mdx)$/iu, "")}.pdf`;
        setState({ status: "ready", content: data.content, filePath });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Failed to prepare markdown PDF.",
            filePath,
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [filePath]);

  if (state.status === "loading") {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-white text-sm text-stone-500"
        data-markdown-print-ready="false"
      >
        PDF 렌더링 준비 중...
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-white px-8 text-center"
        data-markdown-print-ready="error"
      >
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-6 py-5 text-rose-700">
          <h1 className="text-base font-bold">Markdown PDF 생성 실패</h1>
          <p className="mt-2 text-sm">{state.message}</p>
          {state.filePath && <p className="mt-2 text-xs text-rose-500">{state.filePath}</p>}
        </section>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-white"
      data-markdown-print-ready="true"
      style={{
        "--t-primary": "#111827",
        "--t-secondary": "#374151",
        "--t-muted": "#6b7280",
        "--t-faint": "#9ca3af",
        "--t-accent": "#2563eb",
        "--input-bg": "#f8fafc",
        "--card-border": "#d1d5db",
        "--border-subtle": "#e5e7eb",
      } as CSSProperties}
    >
      <article className="mx-auto min-h-screen w-full max-w-[920px] bg-white px-12 py-10 text-stone-900">
        <header className="mb-6 border-b border-stone-200 pb-4">
          <h1 className="text-xl font-extrabold tracking-tight text-stone-950">
            {displayNameFromPath(state.filePath).replace(/\.(md|mdx)$/iu, "")}
          </h1>
          <p className="mt-1 break-all text-xs text-stone-400">{state.filePath}</p>
        </header>
        <MarkdownBody content={state.content} />
      </article>
      <style>{`
        html, body, #root {
          min-height: 100%;
          background: #ffffff;
        }

        .markdown-body {
          color: #374151;
          font-family: "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif;
        }

        @page {
          size: A4;
          margin: 16mm 15mm 18mm;
        }

        @media print {
          article {
            max-width: none !important;
            min-height: auto !important;
            padding: 0 !important;
          }

          header {
            break-after: avoid;
          }

          table, pre, blockquote {
            break-inside: avoid;
          }
        }
      `}</style>
    </main>
  );
}
