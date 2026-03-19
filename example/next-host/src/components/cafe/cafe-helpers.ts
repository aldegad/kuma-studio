import type { CafeOrder, CafeOrderType, SeasonalDrink } from "./cafe-model";
import {
  CAFE_GUESTS,
  DEFAULT_SEASONAL_DRINK,
  DESSERT_ORDER_TEMPLATES,
  DRINK_ORDER_TEMPLATES,
  ORDER_QUEUE_LIMIT,
  RECEIPT_EXPORT_FILENAME,
} from "./cafe-model";

let orderCounter = 0;

function pickRandomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

function createOrderId() {
  orderCounter += 1;
  return `order-${Date.now().toString(36)}-${orderCounter.toString(36)}`;
}

export function createDefaultSeasonalDraft() {
  return { ...DEFAULT_SEASONAL_DRINK };
}

export function getOrdersReadyCount(orders: CafeOrder[]) {
  return orders.filter((order) => order.status === "ready").length;
}

export function getQueueCount(orders: CafeOrder[]) {
  return orders.length;
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
    "A-1025,Strawberry Cloud Cake,7.20,served",
    "A-1026,Cold Brew Float,5.90,queued",
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

export function createRandomOrder(seasonalDrink: SeasonalDrink = DEFAULT_SEASONAL_DRINK): CafeOrder {
  const type: CafeOrderType = Math.random() > 0.5 ? "drink" : "dessert";
  const guest = pickRandomItem(CAFE_GUESTS);

  if (type === "drink") {
    const templatePool = [
      ...DRINK_ORDER_TEMPLATES,
      {
        itemName: seasonalDrink.name.trim() || DEFAULT_SEASONAL_DRINK.name,
        note: seasonalDrink.controlMessage.trim() || "Keep the seasonal hero visible when it leaves the bar.",
      },
    ];
    const template = pickRandomItem(templatePool);
    return {
      id: createOrderId(),
      guestId: guest.id,
      guestName: guest.name,
      itemName: template.itemName,
      type: "drink",
      station: "Espresso Bar",
      note: template.note,
      status: "queued",
    };
  }

  const template = pickRandomItem(DESSERT_ORDER_TEMPLATES);
  return {
    id: createOrderId(),
    guestId: guest.id,
    guestName: guest.name,
    itemName: template.itemName,
    type: "dessert",
    station: "Bakery Shelf",
    note: template.note,
    status: "queued",
  };
}

export function createInitialCafeOrders(seasonalDrink: SeasonalDrink = DEFAULT_SEASONAL_DRINK) {
  return Array.from({ length: ORDER_QUEUE_LIMIT }, () => createRandomOrder(seasonalDrink));
}

export function createStarterCafeOrders(seasonalDrink: SeasonalDrink = DEFAULT_SEASONAL_DRINK): CafeOrder[] {
  return [
    {
      id: "starter-order-1",
      guestId: "rabbit",
      guestName: "Momo Rabbit",
      itemName: DESSERT_ORDER_TEMPLATES[0].itemName,
      type: "dessert",
      station: "Bakery Shelf",
      note: DESSERT_ORDER_TEMPLATES[0].note,
      status: "queued",
    },
    {
      id: "starter-order-2",
      guestId: "cat",
      guestName: "Miso Cat",
      itemName: seasonalDrink.name.trim() || DEFAULT_SEASONAL_DRINK.name,
      type: "drink",
      station: "Espresso Bar",
      note: seasonalDrink.controlMessage.trim() || "Keep the maple cream visible on top.",
      status: "queued",
    },
    {
      id: "starter-order-3",
      guestId: "raccoon",
      guestName: "Rori Raccoon",
      itemName: DRINK_ORDER_TEMPLATES[0].itemName,
      type: "drink",
      station: "Espresso Bar",
      note: DRINK_ORDER_TEMPLATES[0].note,
      status: "queued",
    },
    {
      id: "starter-order-4",
      guestId: "cat",
      guestName: "Miso Cat",
      itemName: DESSERT_ORDER_TEMPLATES[2].itemName,
      type: "dessert",
      station: "Bakery Shelf",
      note: DESSERT_ORDER_TEMPLATES[2].note,
      status: "queued",
    },
  ];
}

export function replaceServedOrderWithRandom(
  orders: CafeOrder[],
  servedOrderId: string,
  seasonalDrink: SeasonalDrink = DEFAULT_SEASONAL_DRINK,
) {
  const remainingOrders = orders.filter((order) => order.id !== servedOrderId);
  return [...remainingOrders, createRandomOrder(seasonalDrink)].slice(0, ORDER_QUEUE_LIMIT);
}

export function createSeasonalOrder(seasonalDrink: SeasonalDrink): CafeOrder {
  return {
    id: `order-seasonal-${createOrderId()}`,
    guestId: "cat",
    guestName: "Miso Cat",
    itemName: seasonalDrink.name.trim() || DEFAULT_SEASONAL_DRINK.name,
    type: "drink",
    station: "Espresso Bar",
    note: seasonalDrink.controlMessage.trim() || "Keep the new signature drink moving through the bar.",
    status: "queued",
  };
}
