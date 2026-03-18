"use client";

import Image from "next/image";
import { useEffect, useId, useState } from "react";

import { KumaSurfaceFrame } from "../lab/KumaSurfaceFrame";
import { CafePanels } from "./CafePanels";
import { CafeSeasonalDialog } from "./CafeSeasonalDialog";
import { CafeSidebar } from "./CafeSidebar";
import {
  createDefaultSeasonalDraft,
  createReceiptCsvDownloadUrl,
  formatTimeLabel,
  getOrdersReadyCount,
  getReceiptExportFilename,
  revokeReceiptCsvDownloadUrl,
} from "./cafe-helpers";
import { DEFAULT_SEASONAL_DRINK, type CafeTabId, type SeasonalDrink, type ShiftFocus } from "./cafe-model";

export function KumaCafeControlRoom() {
  const [activeTab, setActiveTab] = useState<CafeTabId>("orders");
  const [queueMode, setQueueMode] = useState("Balanced");
  const [pastryDrop, setPastryDrop] = useState("Honey Bun");
  const [shiftFocus, setShiftFocus] = useState<ShiftFocus>("Morning Rush");
  const [shiftMenuOpen, setShiftMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seasonalDrink, setSeasonalDrink] = useState<SeasonalDrink>(DEFAULT_SEASONAL_DRINK);
  const [seasonalDraft, setSeasonalDraft] = useState<SeasonalDrink>(createDefaultSeasonalDraft);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastExportedAt, setLastExportedAt] = useState<string | null>(null);
  const [preparedDownloadUrl, setPreparedDownloadUrl] = useState<string | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 2200);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    return () => {
      revokeReceiptCsvDownloadUrl(preparedDownloadUrl);
    };
  }, [preparedDownloadUrl]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }

      if (!event.target.closest(`[data-menu-root="${menuId}"]`)) {
        setShiftMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuId]);

  const ordersReady = getOrdersReadyCount(seasonalDrink);

  function openSeasonalDialog() {
    setSeasonalDraft(seasonalDrink);
    setDialogOpen(true);
  }

  function updateSeasonalDraft(field: keyof SeasonalDrink, value: string) {
    setSeasonalDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function saveSeasonalDrink() {
    setSeasonalDrink(seasonalDraft);
    setDialogOpen(false);
    setToastMessage(
      seasonalDraft.name.trim() ? `${seasonalDraft.name.trim()} is now on the board.` : "Seasonal board updated.",
    );
  }

  function prepareReceipts() {
    revokeReceiptCsvDownloadUrl(preparedDownloadUrl);
    setPreparedDownloadUrl(createReceiptCsvDownloadUrl());
    setToastMessage("Receipts CSV is ready to download.");
  }

  function downloadPreparedReceipts() {
    setLastExportedAt(formatTimeLabel());
    setToastMessage("Receipts download started.");
    window.setTimeout(() => {
      setPreparedDownloadUrl((current) => {
        revokeReceiptCsvDownloadUrl(current);
        return null;
      });
    }, 1500);
  }

  return (
    <KumaSurfaceFrame
      appName="Kuma Cafe Control Room"
      eyebrow="Kuma Cafe Control Room"
      headline={
        <>
          Cozy ops.
          <br />
          Real browser flows.
        </>
      }
      description="This playful control room is built for the next Agent Picker batch: semantic tabs, menu state reads, selected-option checks, dialog workflows, toast waits, and a real CSV download."
      pills={[
        "Tab state is visible and queryable",
        "Custom menu exposes open and selected state",
        "Dialog, toast, and download flows are all live",
      ]}
      visual={
        <div className="kuma-cafe-visual">
          <Image
            src="/kuma-cafe-hero.png"
            alt="Kuma bear barista in a cafe control room"
            width={420}
            height={320}
            className="kuma-cafe-hero-image"
            priority
          />
          <div className="kuma-cafe-icon-float">
            <Image src="/kuma-cafe-icon.png" alt="Kuma Cafe icon" width={112} height={112} className="rounded-[28px]" />
          </div>
        </div>
      }
      sidekickTitle="A fun surface for serious automation checks"
      sidekickBody="Everything here is intentionally testable by Agent Picker without feeling like a sterile fixture board."
      sidekickItems={[
        "Use the Orders / Menu / Delivery tabs to test tab-state readback.",
        "Open Shift Focus to inspect menu-state and selected-option results.",
        "Open the seasonal drink dialog, save it, and verify the toast and CSV export.",
      ]}
    >
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <CafePanels
          activeTab={activeTab}
          ordersReady={ordersReady}
          queueMode={queueMode}
          pastryDrop={pastryDrop}
          shiftFocus={shiftFocus}
          shiftMenuOpen={shiftMenuOpen}
          seasonalDrink={seasonalDrink}
          lastExportedAt={lastExportedAt}
          downloadReady={Boolean(preparedDownloadUrl)}
          downloadHref={preparedDownloadUrl}
          downloadFilename={getReceiptExportFilename()}
          menuId={menuId}
          onTabChange={setActiveTab}
          onOpenSeasonalDialog={openSeasonalDialog}
          onQueueModeChange={setQueueMode}
          onPastryDropChange={setPastryDrop}
          onShiftMenuToggle={() => setShiftMenuOpen((current) => !current)}
          onShiftFocusSelect={(value) => {
            setShiftFocus(value);
            setShiftMenuOpen(false);
          }}
          onPrepareReceipts={prepareReceipts}
          onDownloadReceipts={downloadPreparedReceipts}
        />
        <CafeSidebar />
      </section>

      {dialogOpen ? (
        <CafeSeasonalDialog
          draft={seasonalDraft}
          onChange={updateSeasonalDraft}
          onClose={() => setDialogOpen(false)}
          onSave={saveSeasonalDrink}
        />
      ) : null}

      {toastMessage ? (
        <div className="fixed bottom-5 right-5 z-50 rounded-[1.4rem] border border-[#8d6137]/18 bg-[#fff7e9] px-5 py-4 shadow-[0_18px_44px_rgba(75,48,20,0.22)]" data-testid="cafe-toast">
          <div className="text-[11px] font-black uppercase tracking-[0.26em] text-[#8b5a25]">Cafe Toast</div>
          <div className="mt-2 text-sm font-semibold text-[#533114]">{toastMessage}</div>
        </div>
      ) : null}
    </KumaSurfaceFrame>
  );
}
