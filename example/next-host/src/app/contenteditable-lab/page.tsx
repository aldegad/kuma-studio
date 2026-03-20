"use client";

import { useState } from "react";

function readEditorText(element: HTMLDivElement | null) {
  if (!element) {
    return "";
  }

  return typeof element.innerText === "string" ? element.innerText.replace(/\r\n?/g, "\n") : element.textContent ?? "";
}

export default function ContentEditableLabPage() {
  const [value, setValue] = useState("");

  return (
    <main className="min-h-screen bg-[#f7f1e7] px-6 py-10 text-[#3f2a18]">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="rounded-[2rem] border border-[#d9c5aa] bg-white/80 px-6 py-5 shadow-[0_20px_45px_rgba(93,57,20,0.08)]">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#a36d38]">Contenteditable Lab</p>
          <h1 className="mt-2 text-3xl font-semibold">멀티라인 입력 기본기 점검용 surface</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6f5337]">
            `browser-fill`의 줄바꿈 보존과 `browser-sequence`의 `insertText` step을 검증하기 위한 가장 작은 실험실입니다.
          </p>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[2rem] border border-[#d9c5aa] bg-white px-6 py-6 shadow-[0_20px_45px_rgba(93,57,20,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#8d5b2b]">Editor</p>
                <p className="text-sm text-[#7b6249]">Enter와 이어쓰기 동작을 그대로 확인할 수 있습니다.</p>
              </div>
              <button
                type="button"
                data-testid="contenteditable-lab-reset"
                className="rounded-full border border-[#d0b18b] px-4 py-2 text-sm font-medium text-[#7b4f24] transition hover:bg-[#fff6ea]"
                onClick={() => {
                  const editor = document.querySelector<HTMLDivElement>("[data-testid='contenteditable-lab-editor']");
                  if (editor) {
                    editor.innerHTML = "";
                  }
                  setValue("");
                }}
              >
                Reset
              </button>
            </div>

            <div
              role="textbox"
              aria-multiline="true"
              contentEditable
              suppressContentEditableWarning
              data-testid="contenteditable-lab-editor"
              className="mt-5 min-h-[220px] whitespace-pre-wrap rounded-[1.5rem] border border-dashed border-[#d3b38a] bg-[#fffaf2] px-5 py-4 text-[15px] leading-7 shadow-inner outline-none transition focus:border-[#c57d31] focus:ring-2 focus:ring-[#f4c787]"
              onInput={(event) => {
                setValue(readEditorText(event.currentTarget));
              }}
            />
          </div>

          <aside className="rounded-[2rem] border border-[#d9c5aa] bg-white px-6 py-6 shadow-[0_20px_45px_rgba(93,57,20,0.08)]">
            <p className="text-sm font-semibold text-[#8d5b2b]">Readback</p>
            <p className="mt-1 text-sm text-[#7b6249]">브릿지가 입력한 값이 줄바꿈까지 유지되는지 바로 비교합니다.</p>
            <div className="mt-5 rounded-[1.5rem] bg-[#342315] px-4 py-4 text-[#fff6e8]">
              <pre
                data-testid="contenteditable-lab-readback"
                className="min-h-[220px] whitespace-pre-wrap break-words text-sm leading-6"
              >
                {value}
              </pre>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-[#f8efe3] px-4 py-3">
                <dt className="text-[#8d5b2b]">문자 수</dt>
                <dd data-testid="contenteditable-lab-length" className="mt-1 text-lg font-semibold">
                  {value.length}
                </dd>
              </div>
              <div className="rounded-2xl bg-[#f8efe3] px-4 py-3">
                <dt className="text-[#8d5b2b]">줄 수</dt>
                <dd data-testid="contenteditable-lab-lines" className="mt-1 text-lg font-semibold">
                  {value ? value.split("\n").length : 0}
                </dd>
              </div>
            </dl>
          </aside>
        </section>
      </div>
    </main>
  );
}
