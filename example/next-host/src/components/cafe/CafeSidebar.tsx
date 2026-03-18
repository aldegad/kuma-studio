export function CafeSidebar() {
  return (
    <aside className="space-y-4">
      <div className="rounded-[2rem] border border-[#91612f]/15 bg-[#fff9f0] p-5 shadow-[0_24px_72px_rgba(89,58,19,0.12)]">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#8e5d2b]">Agent Picker Checklist</p>
        <div className="mt-4 space-y-3 text-sm leading-6 text-[#6f461f]">
          <CafeCheck title="Read the tabs" body="Use `browser-query-dom --kind tab-state --text Orders`." />
          <CafeCheck title="Inspect menu state" body="Open Shift Focus, then query `menu-state` or `selected-option`." />
          <CafeCheck title="Dialog flow" body="Open the seasonal modal, fill the URL, save, then wait for toast/dialog close." />
          <CafeCheck title="Download flow" body="Prepare the file, click the visible download link, then verify the CSV path with `browser-wait-for-download`." />
          <CafeCheck title="Permission hint" body="If Chrome shows a multiple-downloads bubble, allow it and retry the visible link." />
        </div>
      </div>

      <div className="rounded-[2rem] border border-[#8d6137]/15 bg-[#4b3014] p-5 text-[#fff4dd] shadow-[0_24px_72px_rgba(75,48,20,0.22)]">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#f0d59f]">E2E Hooks</p>
        <div className="mt-4 space-y-3 text-sm leading-6">
          <div className="rounded-2xl bg-white/8 px-4 py-3">Tabs expose `role=tab` and `aria-selected`.</div>
          <div className="rounded-2xl bg-white/8 px-4 py-3">The custom Shift Focus menu exposes `aria-expanded`, `aria-controls`, and `role=listbox`.</div>
          <div className="rounded-2xl bg-white/8 px-4 py-3">The delivery panel now uses a visible download link for `kuma-cafe-receipts.csv` instead of a hidden auto-download.</div>
        </div>
      </div>
    </aside>
  );
}

function CafeCheck({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.35rem] border border-[#8f6333]/12 bg-white/72 px-4 py-3">
      <div className="text-sm font-black tracking-[-0.03em] text-[#46270c]">{title}</div>
      <div className="mt-1 text-sm text-[#6f461f]">{body}</div>
    </div>
  );
}
