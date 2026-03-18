import type { SeasonalDrink } from "./cafe-model";
import { DEFAULT_SEASONAL_DRINK, RECEIPT_EXPORT_FILENAME } from "./cafe-model";

export function createDefaultSeasonalDraft() {
  return { ...DEFAULT_SEASONAL_DRINK };
}

export function getOrdersReadyCount(seasonalDrink: SeasonalDrink) {
  return seasonalDrink.name === DEFAULT_SEASONAL_DRINK.name ? 12 : 13;
}

export function formatTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function createReceiptCsvDownloadUrl() {
  const csv = [
    "order_id,drink,total,status",
    "A-1024,Honey Oat Latte,6.50,ready",
    "A-1025,Maple Cream Matcha,7.20,queued",
    "A-1026,Cold Brew Float,5.90,delivered",
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  return window.URL.createObjectURL(blob);
}

export function revokeReceiptCsvDownloadUrl(url: string | null) {
  if (!url) {
    return;
  }
  window.URL.revokeObjectURL(url);
}

export function getReceiptExportFilename() {
  return RECEIPT_EXPORT_FILENAME;
}
