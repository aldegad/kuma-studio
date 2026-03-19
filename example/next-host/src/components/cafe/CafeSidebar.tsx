import type { CrewStation } from "./cafe-model";

export function CafeSidebar({
  currentStation,
}: {
  currentStation: CrewStation;
}) {
  return (
    <aside className="space-y-4">
      <div className="rounded-[2rem] border border-[#91612f]/15 bg-[#fff9f0] p-5 shadow-[0_24px_72px_rgba(89,58,19,0.12)]">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#8e5d2b]">Live Mission Board</p>
        <div className="mt-4 space-y-3 text-sm leading-6 text-[#6f461f]">
          <CafeCheck title="Pick the floor" body="Use `Pick With Job` on a guest card, a station control, or the action console." />
          <CafeCheck title="Dropdown focus" body="Crew Station is the custom listbox for `menu-state` and `selected-option` checks." />
          <CafeCheck title="Station rule" body="Drinks only move at Espresso Bar, desserts only move at Bakery Shelf, and serving only happens at Service Counter." />
          <CafeCheck title="Recipe flow" body="Open the signature recipe dialog, edit the drink, save it, then wait for the toast to disappear." />
          <CafeCheck title="Delivery flow" body="Prepare the receipts CSV, click the visible download link, then verify it with `browser-wait-for-download`." />
        </div>
      </div>

      <div className="rounded-[2rem] border border-[#8d6137]/15 bg-[#4b3014] p-5 text-[#fff4dd] shadow-[0_24px_72px_rgba(75,48,20,0.22)]">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#f0d59f]">Current Station</p>
        <div className="mt-4 rounded-[1.35rem] bg-white/8 px-4 py-4">
          <div className="text-xs font-black uppercase tracking-[0.22em] text-[#f9cf86]">Selected</div>
          <div className="mt-2 text-xl font-black tracking-[-0.05em] text-[#fff8ea]">{currentStation}</div>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-6">
          <div className="rounded-2xl bg-white/8 px-4 py-3">Tabs still expose `role=tab` and `aria-selected`.</div>
          <div className="rounded-2xl bg-white/8 px-4 py-3">The game stage is canvas-only decoration; the actionable controls stay semantic DOM.</div>
          <div className="rounded-2xl bg-white/8 px-4 py-3">New guest orders keep arriving randomly, so the queue always feels alive while Kuma Picker stays strong on dropdowns, dialogs, toast waits, and downloads.</div>
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
