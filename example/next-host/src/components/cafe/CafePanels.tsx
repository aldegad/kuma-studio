"use client";

import Image from "next/image";
import { Download, PanelTop, Sparkles } from "lucide-react";

import { KUMA_CAFE_ICON_SRC } from "../../lib/kuma-assets";
import type { CafeTabId, SeasonalDrink, ShiftFocus } from "./cafe-model";
import { CAFE_TABS, PASTRY_SHOWCASE_ITEMS, SHIFT_OPTIONS } from "./cafe-model";

export function CafePanels({
  activeTab,
  ordersReady,
  queueMode,
  pastryDrop,
  shiftFocus,
  shiftMenuOpen,
  seasonalDrink,
  lastExportedAt,
  downloadReady,
  downloadHref,
  downloadFilename,
  menuId,
  onTabChange,
  onOpenSeasonalDialog,
  onQueueModeChange,
  onPastryDropChange,
  onShiftMenuToggle,
  onShiftFocusSelect,
  onPrepareReceipts,
  onDownloadReceipts,
}: {
  activeTab: CafeTabId;
  ordersReady: number;
  queueMode: string;
  pastryDrop: string;
  shiftFocus: ShiftFocus;
  shiftMenuOpen: boolean;
  seasonalDrink: SeasonalDrink;
  lastExportedAt: string | null;
  downloadReady: boolean;
  downloadHref: string | null;
  downloadFilename: string;
  menuId: string;
  onTabChange: (tab: CafeTabId) => void;
  onOpenSeasonalDialog: () => void;
  onQueueModeChange: (value: string) => void;
  onPastryDropChange: (value: string) => void;
  onShiftMenuToggle: () => void;
  onShiftFocusSelect: (value: ShiftFocus) => void;
  onPrepareReceipts: () => void;
  onDownloadReceipts: () => void;
}) {
  return (
    <div className="kuma-board-card rounded-[2.2rem] p-5 shadow-[0_30px_90px_rgba(91,58,19,0.14)] sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#8b5a25]">Control Deck</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-0.06em] text-[#42220c]">Cafe Workflow Playground</h2>
          <p className="mt-3 max-w-[60ch] text-sm leading-7 text-[#78502b]">
            Swap tabs, open the custom queue menu, launch the seasonal drink dialog, then export receipts to validate download detection.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-[1.5rem] bg-[#fff8ea] p-3">
          <CafeMetric label="Ready" value={String(ordersReady)} accent="gold" />
          <CafeMetric label="Shift" value={shiftFocus} accent="mint" />
          <CafeMetric label="Queue" value={queueMode} accent="cream" />
          <CafeMetric label="Export" value={lastExportedAt ?? "Waiting"} accent="rose" />
        </div>
      </div>

      <div className="mt-6 rounded-[1.8rem] border border-[#9b6b36]/12 bg-[#fffaf1] p-4">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Cafe workspace tabs">
          {CAFE_TABS.map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`cafe-tab-${tab.id}`}
                type="button"
                role="tab"
                data-testid={`cafe-tab-${tab.id}`}
                aria-selected={isSelected}
                aria-controls={`cafe-panel-${tab.id}`}
                className={`kuma-cafe-tab ${isSelected ? "kuma-cafe-tab-active" : ""}`}
                onClick={() => onTabChange(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mt-5 space-y-4">
          <section id="cafe-panel-orders" role="tabpanel" hidden={activeTab !== "orders"} aria-labelledby="cafe-tab-orders" className="kuma-cafe-panel">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-[1.5rem] border border-[#8f6333]/12 bg-white/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8e5d2b]">Order Queue</p>
                    <h3 className="mt-2 text-2xl font-black tracking-[-0.05em] text-[#47280d]">Front counter board</h3>
                  </div>
                  <button type="button" className="kuma-tool" data-testid="open-seasonal-dialog" onClick={onOpenSeasonalDialog}>
                    <Sparkles className="h-4 w-4" />
                    New Seasonal Drink
                  </button>
                </div>

                <div className="mt-4 grid gap-3">
                  {[
                    ["A-1024", "Honey Oat Latte", "Ready for pickup"],
                    ["A-1025", seasonalDrink.name, "Steaming now"],
                    ["A-1026", "Cloud Cocoa", "Queued for delivery"],
                  ].map(([orderId, drink, status]) => (
                    <article key={orderId} className="rounded-[1.3rem] border border-[#8f6333]/10 bg-[#fff9ef] px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#92602b]">{orderId}</p>
                          <h4 className="mt-2 text-lg font-black tracking-[-0.04em] text-[#49290f]">{drink}</h4>
                        </div>
                        <span className="rounded-full bg-[#f7e0aa] px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-[#7d4a17]">
                          {status}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="space-y-4 rounded-[1.5rem] border border-[#8f6333]/12 bg-white/72 p-4">
                <label className="block">
                  <span className="text-sm font-black tracking-[-0.03em] text-[#4d2e11]">Queue Mode</span>
                  <select className="kuma-field mt-3" value={queueMode} onChange={(event) => onQueueModeChange(event.target.value)}>
                    <option>Balanced</option>
                    <option>Faster drinks first</option>
                    <option>Pastries first</option>
                  </select>
                </label>

                <div className="space-y-3" data-menu-root={menuId}>
                  <div className="text-sm font-black tracking-[-0.03em] text-[#4d2e11]">Shift Focus</div>
                  <button
                    type="button"
                    role="combobox"
                    aria-label="Shift Focus"
                    aria-haspopup="listbox"
                    aria-controls={`shift-focus-list-${menuId}`}
                    aria-expanded={shiftMenuOpen}
                    className="kuma-field kuma-field-button"
                    data-testid="shift-focus-button"
                    onClick={onShiftMenuToggle}
                  >
                    <span>{shiftFocus}</span>
                    <PanelTop className="h-4 w-4" />
                  </button>
                  <div id={`shift-focus-list-${menuId}`} role="listbox" aria-label="Shift Focus options" className="kuma-menu-list" data-testid="shift-focus-list" hidden={!shiftMenuOpen}>
                    {SHIFT_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={shiftFocus === option}
                        className={`kuma-menu-option ${shiftFocus === option ? "kuma-menu-option-active" : ""}`}
                        onClick={() => onShiftFocusSelect(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="cafe-panel-menu" role="tabpanel" hidden={activeTab !== "menu"} aria-labelledby="cafe-tab-menu" className="kuma-cafe-panel">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[1.5rem] border border-[#8f6333]/12 bg-white/80 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8e5d2b]">Menu Builder</p>
                <h3 className="mt-2 text-2xl font-black tracking-[-0.05em] text-[#47280d]">Seasonal board</h3>
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="text-sm font-black tracking-[-0.03em] text-[#4d2e11]">Featured Pastry</span>
                    <select className="kuma-field mt-3" value={pastryDrop} onChange={(event) => onPastryDropChange(event.target.value)}>
                      <option>Honey Bun</option>
                      <option>Berry Scone</option>
                      <option>Maple Financier</option>
                    </select>
                  </label>
                  <div className="rounded-[1.3rem] border border-[#8f6333]/10 bg-[#fff9ef] px-4 py-4 text-sm leading-7 text-[#6f461f]">
                    Current board pairing: <strong>{shiftFocus}</strong> shift with <strong>{pastryDrop}</strong>.
                    <br />
                    Seasonal artwork
                    <div className="mt-3 overflow-hidden rounded-[1.15rem] border border-[#8f6333]/12 bg-white/70">
                      <div className="relative aspect-[4/3] w-full bg-[#f5e3bc]">
                        <Image
                          src={seasonalDrink.artworkUrl || KUMA_CAFE_ICON_SRC}
                          alt={`${seasonalDrink.name} promo artwork`}
                          fill
                          className="object-cover"
                          sizes="(max-width: 1024px) 100vw, 320px"
                        />
                      </div>
                      <div className="px-4 py-3 text-xs font-semibold text-[#7a4a19]">{seasonalDrink.controlMessage}</div>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {PASTRY_SHOWCASE_ITEMS.map((item) => {
                      const selected = item.name === pastryDrop;
                      return (
                        <article
                          key={item.name}
                          className={`overflow-hidden rounded-[1.2rem] border bg-white/88 transition-transform duration-150 ${
                            selected ? "border-[#ba7b33] shadow-[0_18px_38px_rgba(122,74,25,0.16)]" : "border-[#8f6333]/10"
                          }`}
                        >
                          <div className="relative aspect-square bg-[#f6e2b7]">
                            <Image
                              src={item.artworkUrl}
                              alt={`${item.name} pastry artwork`}
                              fill
                              className="object-cover"
                              sizes="(max-width: 768px) 100vw, 220px"
                            />
                          </div>
                          <div className="space-y-1 px-3 py-3">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-sm font-black tracking-[-0.03em] text-[#48270d]">{item.name}</h4>
                              {selected ? (
                                <span className="rounded-full bg-[#f8dfaa] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#8a561f]">
                                  Active
                                </span>
                              ) : null}
                            </div>
                            <p className="text-xs leading-5 text-[#7a4a19]">{item.note}</p>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-[#8f6333]/12 bg-[#4d3112] p-4 text-[#fff7e6]">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#f0d59f]">Automation Notes</p>
                <div className="mt-4 space-y-3 text-sm leading-7">
                  <div className="rounded-[1.15rem] bg-white/8 px-4 py-3">Read `tab-state` against the active Menu tab.</div>
                  <div className="rounded-[1.15rem] bg-white/8 px-4 py-3">Use `selected-option` with `Shift Focus` or `Featured Pastry`.</div>
                  <div className="rounded-[1.15rem] bg-white/8 px-4 py-3">Save a seasonal drink, then wait for the toast to disappear.</div>
                </div>
              </div>
            </div>
          </section>

          <section id="cafe-panel-delivery" role="tabpanel" hidden={activeTab !== "delivery"} aria-labelledby="cafe-tab-delivery" className="kuma-cafe-panel">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-[1.5rem] border border-[#8f6333]/12 bg-white/80 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8e5d2b]">Dispatch Desk</p>
                <h3 className="mt-2 text-2xl font-black tracking-[-0.05em] text-[#47280d]">Receipt and route exports</h3>
                <p className="mt-3 text-sm leading-7 text-[#6f461f]">
                  Prepare a CSV first, then click the visible download link so automation stays on a single explicit file action.
                </p>
                <div className="mt-4 rounded-[1.25rem] border border-[#8f6333]/12 bg-[#fff7e8] px-4 py-3 text-sm leading-6 text-[#6f461f]">
                  Chrome may still ask this site for repeated-download permission on some setups. If a permission bubble appears, allow it, then retry the visible download link.
                </div>
                <button type="button" className="kuma-tool mt-5" data-testid="prepare-receipts" onClick={onPrepareReceipts}>
                  <Download className="h-4 w-4" />
                  Prepare Receipts CSV
                </button>
                {downloadReady && downloadHref ? (
                  <a
                    href={downloadHref}
                    download={downloadFilename}
                    className="kuma-tool mt-3 inline-flex"
                    data-testid="download-receipts"
                    onClick={onDownloadReceipts}
                  >
                    <Download className="h-4 w-4" />
                    Download Prepared CSV
                  </a>
                ) : null}
              </div>

              <div className="rounded-[1.5rem] border border-[#8f6333]/12 bg-white/72 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8e5d2b]">Last Export</p>
                <div className="mt-3 text-2xl font-black tracking-[-0.05em] text-[#47280d]">{lastExportedAt ?? "No file yet"}</div>
                <p className="mt-3 text-sm leading-7 text-[#6f461f]">
                  Use `browser-wait-for-download` right after pressing the visible download link.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function CafeMetric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "gold" | "cream" | "mint" | "rose";
}) {
  return (
    <div className={`kuma-metric kuma-metric-${accent}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.26em] opacity-70">{label}</div>
      <div className="mt-2 text-lg font-black tracking-[-0.05em]">{value}</div>
    </div>
  );
}
