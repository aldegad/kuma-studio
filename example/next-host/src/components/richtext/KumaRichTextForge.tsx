"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import { KUMA_RICHTEXT_ICON_SRC } from "../../lib/kuma-assets";
import { KumaSurfaceFrame } from "../lab/KumaSurfaceFrame";

function readEditorText(element: HTMLDivElement | null) {
  if (!element) {
    return "";
  }

  return typeof element.innerText === "string" ? element.innerText.replace(/\r\n?/g, "\n") : element.textContent ?? "";
}

function normalizeEditorHtml(element: HTMLDivElement | null) {
  if (!element) {
    return "";
  }

  return element.innerHTML.replace(/\s*style="[^"]*"/g, "").trim();
}

const TOOLBAR_ACTIONS = [
  { id: "bold", label: "Bold", command: "bold" },
  { id: "italic", label: "Italic", command: "italic" },
  { id: "quote", label: "Quote", command: "formatBlock", value: "blockquote" },
  { id: "h2", label: "Heading", command: "formatBlock", value: "h2" },
  { id: "bullets", label: "Bullets", command: "insertUnorderedList" },
] as const;

function readToolbarValue(action: (typeof TOOLBAR_ACTIONS)[number]) {
  return "value" in action ? action.value : undefined;
}

const STARTER_HTML = [
  "<h2>Bear Notes</h2>",
  "<p>Rich text surfaces are useful when Kuma Picker needs to preserve line breaks, formatting, and selection-aware commands.</p>",
  "<ul><li>Bold or italic formatting</li><li>Structured lists</li><li>Plain text + HTML readback</li></ul>",
].join("");

export function KumaRichTextForge() {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [plainText, setPlainText] = useState("");
  const [htmlValue, setHtmlValue] = useState("");

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    editorRef.current.innerHTML = STARTER_HTML;
    setPlainText(readEditorText(editorRef.current));
    setHtmlValue(normalizeEditorHtml(editorRef.current));
  }, []);

  function syncReadback() {
    setPlainText(readEditorText(editorRef.current));
    setHtmlValue(normalizeEditorHtml(editorRef.current));
  }

  function applyToolbarCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncReadback();
  }

  function resetEditor() {
    if (!editorRef.current) {
      return;
    }

    editorRef.current.innerHTML = "";
    syncReadback();
  }

  function seedStarterDocument() {
    if (!editorRef.current) {
      return;
    }

    editorRef.current.innerHTML = STARTER_HTML;
    syncReadback();
  }

  return (
    <KumaSurfaceFrame
      appName="Kuma Rich Text Forge"
      eyebrow="Rich text input surface"
      headline={<>Kuma Rich Text Forge</>}
      description="A richer contenteditable testbed for Kuma Picker. It keeps plain-text and HTML readback side by side so formatting actions, multiline paste, insertText flows, and browser-fill edge cases are easy to verify."
      pills={[
        "contenteditable",
        "Toolbar commands",
        "Plain-text readback",
        "HTML readback",
        "Selection-aware checks",
      ]}
      visual={
        <div className="kuma-story-visual-stack">
          <Image
            src={KUMA_RICHTEXT_ICON_SRC}
            alt="Kuma Rich Text Forge icon"
            width={180}
            height={180}
            className="kuma-story-icon"
            priority
          />
        </div>
      }
      sidekickTitle="Why a Rich Text Surface?"
      sidekickBody="Plain inputs are only half the story. Real agents eventually hit editable canvases, list formatting, block quotes, and inline emphasis where DOM state matters as much as visible text."
      sidekickItems={[
        "Toolbar buttons change structure so command success is easy to assert",
        "Plain text readback proves line breaks survived",
        "HTML readback exposes block tags and list structure for richer checks",
        "Reset and starter document buttons make repeated automation loops fast",
      ]}
    >
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_390px]">
        <div className="kuma-board-card rounded-[2rem] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#9c6532]">Editor Deck</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-[#4a2810]">Selection-aware toolbar</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="contenteditable-lab-seed"
                className="rounded-full border border-[#ddb780] bg-white/80 px-4 py-2 text-sm font-bold text-[#8a5422] transition hover:bg-[#fff6e6]"
                onClick={seedStarterDocument}
              >
                Starter Doc
              </button>
              <button
                type="button"
                data-testid="contenteditable-lab-reset"
                className="rounded-full border border-[#ddb780] bg-[#4f2e15] px-4 py-2 text-sm font-bold text-[#fff2da] transition hover:bg-[#3c210d]"
                onClick={resetEditor}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {TOOLBAR_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                data-testid={`contenteditable-toolbar-${action.id}`}
                className="rounded-full border border-[#d8af74] bg-[#fff8ee] px-4 py-2 text-sm font-semibold text-[#7d4a1d] transition hover:-translate-y-0.5 hover:bg-white"
                onClick={() => applyToolbarCommand(action.command, readToolbarValue(action))}
              >
                {action.label}
              </button>
            ))}
          </div>

          <div
            ref={editorRef}
            role="textbox"
            aria-multiline="true"
            contentEditable
            suppressContentEditableWarning
            data-testid="contenteditable-lab-editor"
            className="mt-5 min-h-[360px] whitespace-pre-wrap rounded-[1.7rem] border border-dashed border-[#d3b38a] bg-[#fffaf2] px-5 py-5 text-[15px] leading-7 text-[#45270d] shadow-inner outline-none transition focus:border-[#c57d31] focus:ring-2 focus:ring-[#f4c787]"
            onInput={syncReadback}
          />
        </div>

        <aside className="flex flex-col gap-5">
          <section className="kuma-surface-card">
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#9c6532]">Plain Text</p>
            <pre
              data-testid="contenteditable-lab-readback"
              className="mt-4 min-h-[180px] whitespace-pre-wrap break-words rounded-[1.4rem] bg-[#3b2416] px-4 py-4 text-sm leading-6 text-[#fff4df]"
            >
              {plainText}
            </pre>
          </section>

          <section className="kuma-surface-card">
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#9c6532]">HTML Readback</p>
            <pre
              data-testid="contenteditable-lab-html"
              className="mt-4 min-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-[1.4rem] bg-[#fff7ea] px-4 py-4 text-sm leading-6 text-[#6e431d]"
            >
              {htmlValue}
            </pre>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div className="kuma-surface-card">
              <dt className="text-sm font-semibold text-[#8d5b2b]">Characters</dt>
              <dd data-testid="contenteditable-lab-length" className="mt-2 text-3xl font-black tracking-[-0.06em] text-[#47280d]">
                {plainText.length}
              </dd>
            </div>
            <div className="kuma-surface-card">
              <dt className="text-sm font-semibold text-[#8d5b2b]">Lines</dt>
              <dd data-testid="contenteditable-lab-lines" className="mt-2 text-3xl font-black tracking-[-0.06em] text-[#47280d]">
                {plainText ? plainText.split("\n").length : 0}
              </dd>
            </div>
          </section>
        </aside>
      </section>
    </KumaSurfaceFrame>
  );
}
