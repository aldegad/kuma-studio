"use client";

import Image from "next/image";
import { Download, PanelTop, Sparkles, Wand2 } from "lucide-react";

import { KUMA_CAFE_ICON_SRC } from "../../lib/kuma-assets";
import { CafeGameStage } from "./CafeGameStage";
import {
  CAFE_GUESTS,
  CAFE_TABS,
  CREW_STATION_OPTIONS,
  PASTRY_SHOWCASE_ITEMS,
  type CafeOrder,
  type CafeTabId,
  type CafeStageAction,
  type CrewStation,
  type SeasonalDrink,
} from "./cafe-model";

export function CafePanels({
  activeTab,
  currentStation,
  stationMenuOpen,
  seasonalDrink,
  orders,
  currentAction,
  lastExportedAt,
  downloadReady,
  downloadHref,
  downloadFilename,
  menuId,
  onTabChange,
  onOpenSeasonalDialog,
  onStationMenuToggle,
  onStationSelect,
  onBrewDrink,
  onPlateDessert,
  onServeReady,
  onPrepareReceipts,
  onDownloadReceipts,
}: {
  activeTab: CafeTabId;
  currentStation: CrewStation;
  stationMenuOpen: boolean;
  seasonalDrink: SeasonalDrink;
  orders: CafeOrder[];
  currentAction: CafeStageAction;
  lastExportedAt: string | null;
  downloadReady: boolean;
  downloadHref: string | null;
  downloadFilename: string;
  menuId: string;
  onTabChange: (tab: CafeTabId) => void;
  onOpenSeasonalDialog: () => void;
  onStationMenuToggle: () => void;
  onStationSelect: (value: CrewStation) => void;
  onBrewDrink: () => void;
  onPlateDessert: () => void;
  onServeReady: () => void;
  onPrepareReceipts: () => void;
  onDownloadReceipts: () => void;
}) {
  const visibleOrders = orders;
  const nextDrinkOrder = orders.find((order) => order.type === "drink" && order.status === "queued");
  const nextDessertOrder = orders.find((order) => order.type === "dessert" && order.status === "queued");
  const nextReadyOrder = orders.find((order) => order.status === "ready");
  const stationAction =
    currentStation === "Espresso Bar"
      ? {
          buttonLabel: nextDrinkOrder ? `Brew ${nextDrinkOrder.itemName}` : "No drink order waiting",
          hint: "Only drink orders can move forward from the espresso bar.",
          detail: nextDrinkOrder
            ? `${nextDrinkOrder.guestName} is waiting for ${nextDrinkOrder.itemName}.`
            : "Switch stations or wait for a new drink ticket.",
          disabled: !nextDrinkOrder,
          onClick: onBrewDrink,
          testId: "brew-next-drink",
          icon: Wand2,
        }
      : currentStation === "Bakery Shelf"
        ? {
            buttonLabel: nextDessertOrder ? `Plate ${nextDessertOrder.itemName}` : "No dessert order waiting",
            hint: "Desserts only move here after they are plated on the shelf.",
            detail: nextDessertOrder
              ? `${nextDessertOrder.guestName} is waiting for ${nextDessertOrder.itemName}.`
              : "Switch stations or wait for a new dessert ticket.",
            disabled: !nextDessertOrder,
            onClick: onPlateDessert,
            testId: "plate-next-dessert",
            icon: Sparkles,
          }
        : {
            buttonLabel: nextReadyOrder ? `Serve ${nextReadyOrder.guestName}` : "Nothing ready to serve",
            hint: "Only ready orders can be handed over at the service counter.",
            detail: nextReadyOrder
              ? `${nextReadyOrder.itemName} is waiting on the ledge for ${nextReadyOrder.guestName}.`
              : "Finish a drink or dessert first, then come back here.",
            disabled: !nextReadyOrder,
            onClick: onServeReady,
            testId: "serve-ready-order",
            icon: Wand2,
          };
  const StationActionIcon = stationAction.icon;

  return (
    <div className="kuma-board-card rounded-[2.2rem] p-5 shadow-[0_30px_90px_rgba(91,58,19,0.14)] sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#8b5a25]">Game Floor</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-0.06em] text-[#42220c]">Toy-shop cafe, real browser checks</h2>
          <p className="mt-3 max-w-[65ch] text-sm leading-7 text-[#78502b]">
            The bear barista moves through the floor like a tiny game, but every important control still lives in the DOM:
            tabs, the custom station dropdown, the seasonal recipe dialog, toast feedback, and the real CSV export.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-[1.5rem] bg-[#fff8ea] p-3">
          <CafeMetric label="Queue" value={String(orders.filter((order) => order.status !== "served").length)} accent="gold" />
          <CafeMetric label="Ready" value={String(orders.filter((order) => order.status === "ready").length)} accent="mint" />
          <CafeMetric label="Served" value={String(orders.filter((order) => order.status === "served").length)} accent="rose" />
          <CafeMetric label="Station" value={currentStation} accent="cream" />
        </div>
      </div>

      <div className="mt-6">
        <CafeGameStage guests={CAFE_GUESTS} orders={orders} selectedStation={currentStation} currentAction={currentAction} />
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
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="rounded-[1.5rem] border border-[#8f6333]/12 bg-white/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8e5d2b]">Mission Queue</p>
                    <h3 className="mt-2 text-2xl font-black tracking-[-0.05em] text-[#47280d]">Animal guest orders</h3>
                  </div>
                  <button type="button" className="kuma-tool" data-testid="open-seasonal-dialog" onClick={onOpenSeasonalDialog}>
                    <Sparkles className="h-4 w-4" />
                    New Signature Recipe
                  </button>
                </div>

                <div className="mt-4 grid gap-3">
                  {visibleOrders.map((order) => (
                    <article key={order.id} className="rounded-[1.3rem] border border-[#8f6333]/10 bg-[#fff9ef] px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                      <div>
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#92602b]">{order.guestName}</p>
                          <h4 className="mt-2 text-lg font-black tracking-[-0.04em] text-[#49290f]">{order.itemName}</h4>
                          <div className="mt-2 text-sm leading-6 text-[#734b22]">{order.note}</div>
                          <div className="mt-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#9a6c3a]">
                            Go to {order.station}
                          </div>
                        </div>
                        <span className="rounded-full bg-[#f7e0aa] px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-[#7d4a17]">
                          {order.status}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="space-y-4 rounded-[1.5rem] border border-[#8f6333]/12 bg-white/72 p-4">
                <div className="rounded-[1.35rem] border border-[#8f6333]/10 bg-[#fff8ea] p-4">
                  <div className="text-sm font-black tracking-[-0.03em] text-[#4d2e11]">Shift Rules</div>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-[#6f461f]">
                    <div>Guests arrive in a random order every time a tray gets served.</div>
                    <div>Espresso Bar brews drinks, Bakery Shelf plates desserts, Service Counter serves only ready orders.</div>
                    <div>The station dropdown decides which action is legal right now.</div>
                  </div>
                </div>

                <div className="space-y-3" data-menu-root={menuId}>
                  <div className="text-sm font-black tracking-[-0.03em] text-[#4d2e11]">Crew Station</div>
                  <button
                    type="button"
                    role="combobox"
                    aria-label="Crew Station"
                    aria-haspopup="listbox"
                    aria-controls={`crew-station-list-${menuId}`}
                    aria-expanded={stationMenuOpen}
                    className="kuma-field kuma-field-button"
                    data-testid="crew-station-button"
                    onClick={onStationMenuToggle}
                  >
                    <span>{currentStation}</span>
                    <PanelTop className="h-4 w-4" />
                  </button>
                  <div
                    id={`crew-station-list-${menuId}`}
                    role="listbox"
                    aria-label="Crew Station options"
                    className="kuma-menu-list"
                    data-testid="crew-station-list"
                    hidden={!stationMenuOpen}
                  >
                    {CREW_STATION_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={currentStation === option}
                        className={`kuma-menu-option ${currentStation === option ? "kuma-menu-option-active" : ""}`}
                        onClick={() => onStationSelect(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 rounded-[1.35rem] border border-[#8f6333]/10 bg-[#fff8ea] p-4">
                  <div className="text-sm font-black tracking-[-0.03em] text-[#4d2e11]">Station Action</div>
                  <div className="rounded-[1.2rem] bg-white/80 px-4 py-3 text-sm leading-6 text-[#6f461f]">
                    <div className="font-black tracking-[-0.03em] text-[#47280d]">{currentStation}</div>
                    <div className="mt-1">{stationAction.hint}</div>
                    <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#9a6c3a]">{stationAction.detail}</div>
                  </div>
                  <button
                    type="button"
                    className="kuma-tool w-full justify-center"
                    data-testid={stationAction.testId}
                    onClick={stationAction.onClick}
                    disabled={stationAction.disabled}
                  >
                    <StationActionIcon className="h-4 w-4" />
                    {stationAction.buttonLabel}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section id="cafe-panel-menu" role="tabpanel" hidden={activeTab !== "menu"} aria-labelledby="cafe-tab-menu" className="kuma-cafe-panel">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[1.5rem] border border-[#8f6333]/12 bg-white/80 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8e5d2b]">Signature Board</p>
                <h3 className="mt-2 text-2xl font-black tracking-[-0.05em] text-[#47280d]">Bear-crafted specials</h3>
                <div className="mt-4 overflow-hidden rounded-[1.3rem] border border-[#8f6333]/10 bg-[#fff9ef]">
                  <div className="relative aspect-[5/3] bg-[#f6e2b7]">
                    <Image
                      src={seasonalDrink.artworkUrl || KUMA_CAFE_ICON_SRC}
                      alt={`${seasonalDrink.name} promo artwork`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 1024px) 100vw, 420px"
                    />
                  </div>
                  <div className="space-y-2 px-4 py-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.24em] text-[#91612f]">Signature Recipe</div>
                    <h4 className="text-xl font-black tracking-[-0.05em] text-[#47280d]">{seasonalDrink.name}</h4>
                    <p className="text-sm leading-7 text-[#70451d]">{seasonalDrink.controlMessage}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {PASTRY_SHOWCASE_ITEMS.map((item) => (
                    <article
                      key={item.name}
                      className="overflow-hidden rounded-[1.2rem] border border-[#8f6333]/10 bg-white/88"
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
                        <h4 className="text-sm font-black tracking-[-0.03em] text-[#48270d]">{item.name}</h4>
                        <p className="text-xs leading-5 text-[#7a4a19]">{item.note}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-[#8f6333]/12 bg-[#4d3112] p-4 text-[#fff7e6]">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#f0d59f]">Semantic Hooks</p>
                <div className="mt-4 space-y-3 text-sm leading-7">
                  <div className="rounded-[1.15rem] bg-white/8 px-4 py-3">Tabs still expose `role=tab` and `aria-selected` for locator-based checks.</div>
                  <div className="rounded-[1.15rem] bg-white/8 px-4 py-3">Crew Station is the custom dropdown to hit with `page.getByRole` and readback checks.</div>
                  <div className="rounded-[1.15rem] bg-white/8 px-4 py-3">The recipe editor dialog remains a real form flow with toast feedback after save.</div>
                </div>
              </div>
            </div>
          </section>

          <section id="cafe-panel-delivery" role="tabpanel" hidden={activeTab !== "delivery"} aria-labelledby="cafe-tab-delivery" className="kuma-cafe-panel">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-[1.5rem] border border-[#8f6333]/12 bg-white/80 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8e5d2b]">Dispatch Desk</p>
                <h3 className="mt-2 text-2xl font-black tracking-[-0.05em] text-[#47280d]">Visible receipt export</h3>
                <p className="mt-3 text-sm leading-7 text-[#6f461f]">
                  Keep this explicit. Prepare the file first, then click the visible download link so the same `page` script can verify a real user-facing action.
                </p>
                <div className="mt-4 rounded-[1.25rem] border border-[#8f6333]/12 bg-[#fff7e8] px-4 py-3 text-sm leading-6 text-[#6f461f]">
                  If Chrome asks about repeated downloads, allow it once and retry the same visible link.
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
                <p className="mt-3 text-sm leading-7 text-[#6f461f]">Use the explicit download link right after prep so the path is easy to verify.</p>
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
