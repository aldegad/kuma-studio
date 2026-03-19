import {
  KUMA_CAFE_GUEST_CAT_SRC,
  KUMA_CAFE_GUEST_RABBIT_SRC,
  KUMA_CAFE_GUEST_RACCOON_SRC,
  KUMA_CAFE_ICON_SRC,
} from "../../lib/kuma-assets";

export type CafeTabId = "orders" | "menu" | "delivery";
export type CrewStation = "Espresso Bar" | "Bakery Shelf" | "Service Counter";
export type CafeOrderType = "drink" | "dessert";
export type CafeOrderStatus = "queued" | "working" | "ready" | "served";
export type GuestId = "rabbit" | "cat" | "raccoon";

export type SeasonalDrink = {
  name: string;
  artworkUrl: string;
  controlMessage: string;
};

export type PastryShowcaseItem = {
  name: string;
  artworkUrl: string;
  note: string;
};

export type CafeGuest = {
  id: GuestId;
  name: string;
  spriteSrc: string;
  favoriteLine: string;
};

export type CafeOrder = {
  id: string;
  guestId: GuestId;
  guestName: string;
  itemName: string;
  type: CafeOrderType;
  station: CrewStation;
  note: string;
  status: CafeOrderStatus;
};

export type CafeActionKind = "brew" | "plate" | "serve" | "idle";

export type CafeStageAction = {
  kind: CafeActionKind;
  label: string;
  startedAt: number;
  station: CrewStation;
  guestId?: GuestId | null;
};

export const CAFE_TABS: Array<{ id: CafeTabId; label: string }> = [
  { id: "orders", label: "Orders" },
  { id: "menu", label: "Menu" },
  { id: "delivery", label: "Delivery" },
];

export const CREW_STATION_OPTIONS: CrewStation[] = [
  "Espresso Bar",
  "Bakery Shelf",
  "Service Counter",
];

export const CAFE_GUESTS: CafeGuest[] = [
  {
    id: "rabbit",
    name: "Momo Rabbit",
    spriteSrc: KUMA_CAFE_GUEST_RABBIT_SRC,
    favoriteLine: "Waiting patiently for something warm and sweet.",
  },
  {
    id: "cat",
    name: "Miso Cat",
    spriteSrc: KUMA_CAFE_GUEST_CAT_SRC,
    favoriteLine: "Prefers quiet corners and fluffy cream toppings.",
  },
  {
    id: "raccoon",
    name: "Rori Raccoon",
    spriteSrc: KUMA_CAFE_GUEST_RACCOON_SRC,
    favoriteLine: "Always asks for a takeout-friendly treat.",
  },
];

export const DRINK_ORDER_TEMPLATES = [
  {
    itemName: "Honey Oat Latte",
    note: "Warm milk foam and a soft honey finish.",
  },
  {
    itemName: "Cold Brew Float",
    note: "Top it with the float before sending it out.",
  },
  {
    itemName: "Maple Cream Matcha",
    note: "Keep the maple cream visible on top.",
  },
];

export const DESSERT_ORDER_TEMPLATES = [
  {
    itemName: "Strawberry Cloud Cake",
    note: "Plate the cake slice before bringing it to the table.",
  },
  {
    itemName: "Honey Bun",
    note: "Tray the bun neatly and send it with a napkin.",
  },
  {
    itemName: "Berry Scone",
    note: "Move the scone from the pastry shelf to the service ledge.",
  },
];

export const PASTRY_SHOWCASE_ITEMS: PastryShowcaseItem[] = [
  {
    name: "Honey Bun",
    artworkUrl: "/kuma-menu-honey-bun.png",
    note: "Golden glaze, soft spiral crumb, morning counter favorite.",
  },
  {
    name: "Berry Scone",
    artworkUrl: "/kuma-menu-berry-scone.png",
    note: "Jammy fruit pockets with a cozy bakehouse finish.",
  },
  {
    name: "Maple Financier",
    artworkUrl: "/kuma-menu-maple-financier.png",
    note: "Toasted almond crumb with a mellow maple glow.",
  },
];

export const DEFAULT_SEASONAL_DRINK: SeasonalDrink = {
  name: "Maple Cream Matcha",
  artworkUrl: KUMA_CAFE_ICON_SRC,
  controlMessage: "Keep the maple cream chilled and visible on the hero board.",
};

export const ORDER_QUEUE_LIMIT = 4;
export const RECEIPT_EXPORT_FILENAME = "kuma-cafe-receipts.csv";
