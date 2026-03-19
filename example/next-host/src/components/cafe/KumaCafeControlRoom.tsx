"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useState } from "react";

import { KUMA_CAFE_BEAR_BARISTA_SRC, KUMA_CAFE_ICON_SRC } from "../../lib/kuma-assets";
import { KumaSurfaceFrame } from "../lab/KumaSurfaceFrame";
import { CafePanels } from "./CafePanels";
import { CafeSeasonalDialog } from "./CafeSeasonalDialog";
import { CafeSidebar } from "./CafeSidebar";
import {
  createDefaultSeasonalDraft,
  createInitialCafeOrders,
  createReceiptCsvDownloadUrl,
  createStarterCafeOrders,
  createSeasonalOrder,
  formatTimeLabel,
  getOrdersReadyCount,
  getQueueCount,
  getReceiptExportFilename,
  replaceServedOrderWithRandom,
  revokeReceiptCsvDownloadUrl,
} from "./cafe-helpers";
import {
  DEFAULT_SEASONAL_DRINK,
  ORDER_QUEUE_LIMIT,
  type CafeOrder,
  type CafeTabId,
  type CafeStageAction,
  type CrewStation,
  type SeasonalDrink,
} from "./cafe-model";

const IDLE_STAGE_ACTION: CafeStageAction = {
  kind: "idle",
  label: "Waiting for the next cafe task.",
  startedAt: Date.now(),
  station: "Service Counter",
};

export function KumaCafeControlRoom() {
  const [activeTab, setActiveTab] = useState<CafeTabId>("orders");
  const [currentStation, setCurrentStation] = useState<CrewStation>("Service Counter");
  const [stationMenuOpen, setStationMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seasonalDrink, setSeasonalDrink] = useState<SeasonalDrink>(DEFAULT_SEASONAL_DRINK);
  const [seasonalDraft, setSeasonalDraft] = useState<SeasonalDrink>(createDefaultSeasonalDraft);
  const [orders, setOrders] = useState<CafeOrder[]>(() => createStarterCafeOrders(DEFAULT_SEASONAL_DRINK));
  const [servedCount, setServedCount] = useState(0);
  const [stageAction, setStageAction] = useState<CafeStageAction>(IDLE_STAGE_ACTION);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastExportedAt, setLastExportedAt] = useState<string | null>(null);
  const [preparedDownloadUrl, setPreparedDownloadUrl] = useState<string | null>(null);
  const menuId = useId();

  const readyCount = useMemo(() => getOrdersReadyCount(orders), [orders]);
  const queueCount = useMemo(() => getQueueCount(orders), [orders]);

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
    setOrders((current) => {
      if (current.some((order) => !order.id.startsWith("starter-order-"))) {
        return current;
      }

      return createInitialCafeOrders(seasonalDrink);
    });
  }, [seasonalDrink]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }

      if (!event.target.closest(`[data-menu-root="${menuId}"]`)) {
        setStationMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuId]);

  function updateSeasonalDraft(field: keyof SeasonalDrink, value: string) {
    setSeasonalDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function openSeasonalDialog() {
    setSeasonalDraft(seasonalDrink);
    setDialogOpen(true);
  }

  function requireStation(expectedStation: CrewStation, message: string) {
    if (currentStation === expectedStation) {
      return true;
    }

    setToastMessage(message);
    return false;
  }

  function runOrderAction(
    nextOrders: CafeOrder[] | ((current: CafeOrder[]) => CafeOrder[]),
    action: CafeStageAction,
    toast: string,
  ) {
    setStageAction({
      ...action,
      startedAt: Date.now(),
    });
    setOrders(nextOrders);
    setStationMenuOpen(false);
    setToastMessage(toast);
  }

  function brewNextDrink() {
    if (!requireStation("Espresso Bar", "Move to the Espresso Bar before brewing drinks.")) {
      return;
    }

    const nextDrink = orders.find((order) => order.type === "drink" && order.status === "queued");
    if (!nextDrink) {
      setToastMessage("No drink orders are waiting at the espresso bar.");
      return;
    }

    runOrderAction(
      (current) =>
        current.map((order) =>
          order.id === nextDrink.id
            ? {
                ...order,
                status: "ready",
              }
            : order,
        ),
      {
        kind: "brew",
        label: `Brewing ${nextDrink.itemName} for ${nextDrink.guestName}.`,
        station: "Espresso Bar",
        guestId: nextDrink.guestId,
        startedAt: Date.now(),
      },
      `${nextDrink.itemName} is ready for pickup.`,
    );
  }

  function plateNextDessert() {
    if (!requireStation("Bakery Shelf", "Move to the Bakery Shelf before plating desserts.")) {
      return;
    }

    const nextDessert = orders.find((order) => order.type === "dessert" && order.status === "queued");
    if (!nextDessert) {
      setToastMessage("No dessert orders are waiting at the bakery shelf.");
      return;
    }

    runOrderAction(
      (current) =>
        current.map((order) =>
          order.id === nextDessert.id
            ? {
                ...order,
                status: "ready",
              }
            : order,
        ),
      {
        kind: "plate",
        label: `Plating ${nextDessert.itemName} for ${nextDessert.guestName}.`,
        station: "Bakery Shelf",
        guestId: nextDessert.guestId,
        startedAt: Date.now(),
      },
      `${nextDessert.itemName} is plated and ready.`,
    );
  }

  function serveReadyOrder() {
    if (!requireStation("Service Counter", "Move to the Service Counter before serving guests.")) {
      return;
    }

    const nextReadyOrder = orders.find((order) => order.status === "ready");
    if (!nextReadyOrder) {
      setToastMessage("Nothing is ready to serve yet.");
      return;
    }

    runOrderAction(
      (current) => replaceServedOrderWithRandom(current, nextReadyOrder.id, seasonalDrink),
      {
        kind: "serve",
        label: `Serving ${nextReadyOrder.itemName} to ${nextReadyOrder.guestName}.`,
        station: "Service Counter",
        guestId: nextReadyOrder.guestId,
        startedAt: Date.now(),
      },
      `${nextReadyOrder.guestName} received ${nextReadyOrder.itemName}. A new guest order rolled in.`,
    );
    setServedCount((current) => current + 1);
  }

  function saveSeasonalDrink() {
    const nextDrink = {
      ...seasonalDraft,
      name: seasonalDraft.name.trim() || DEFAULT_SEASONAL_DRINK.name,
      controlMessage:
        seasonalDraft.controlMessage.trim() || "Keep the signature special visible on the board.",
    };

    setSeasonalDrink(nextDrink);
    setDialogOpen(false);
    setOrders((current) => [createSeasonalOrder(nextDrink), ...current].slice(0, ORDER_QUEUE_LIMIT));
    setToastMessage(`${nextDrink.name} joined the cafe queue.`);
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
      eyebrow="Kuma Cafe Playroom"
      headline={
        <>
          Plush-game charm.
          <br />
          Clear station rules.
        </>
      }
      description="Kuma Cafe now plays like a tiny shift-floor game with strict rules. Drinks only move at the Espresso Bar, desserts only move at the Bakery Shelf, and serving only happens at the Service Counter. Guests arrive in a random flow, while the important browser automation hooks stay deliberate: tabs, a custom dropdown menu, a real recipe dialog, toast waits, and a visible CSV export."
      pills={[
        `Queue ${queueCount}`,
        `Ready ${readyCount}`,
        `Served ${servedCount}`,
        `Focus ${currentStation}`,
      ]}
      visual={
        <div className="kuma-cafe-visual">
          <Image
            src={KUMA_CAFE_BEAR_BARISTA_SRC}
            alt="Kuma bear barista"
            width={320}
            height={320}
            className="mx-auto block max-h-[280px] w-auto"
            priority
          />
          <div className="kuma-cafe-icon-float">
            <Image src={KUMA_CAFE_ICON_SRC} alt="Kuma Cafe icon" width={112} height={112} className="rounded-[28px]" />
          </div>
        </div>
      }
      sidekickTitle="Pick jobs on a living cafe floor"
      sidekickBody="This surface is now better for Kuma Picker collaboration too. Pick a guest, a station, or the action console, leave a job, and the bear barista can work through it while the page still exposes strong semantic test hooks and clearer station-by-station rules."
      sidekickItems={[
        "Orders are visible and easy to target with Pick With Job.",
        "Crew Station is still the custom dropdown for menu-state and selected-option checks.",
        "The signature recipe dialog and the CSV export remain first-class workflow tests.",
      ]}
    >
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <CafePanels
          activeTab={activeTab}
          currentStation={currentStation}
          stationMenuOpen={stationMenuOpen}
          seasonalDrink={seasonalDrink}
          orders={orders}
          currentAction={stageAction}
          lastExportedAt={lastExportedAt}
          downloadReady={Boolean(preparedDownloadUrl)}
          downloadHref={preparedDownloadUrl}
          downloadFilename={getReceiptExportFilename()}
          menuId={menuId}
          onTabChange={setActiveTab}
          onOpenSeasonalDialog={openSeasonalDialog}
          onStationMenuToggle={() => setStationMenuOpen((current) => !current)}
          onStationSelect={(value) => {
            setCurrentStation(value);
            setStationMenuOpen(false);
            setStageAction({
              kind: "idle",
              label: `${value} is selected. Follow the station rule for the next move.`,
              station: value,
              startedAt: Date.now(),
            });
          }}
          onBrewDrink={brewNextDrink}
          onPlateDessert={plateNextDessert}
          onServeReady={serveReadyOrder}
          onPrepareReceipts={prepareReceipts}
          onDownloadReceipts={downloadPreparedReceipts}
        />
        <CafeSidebar currentStation={currentStation} />
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
