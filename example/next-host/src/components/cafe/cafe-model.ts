export type CafeTabId = "orders" | "menu" | "delivery";
export type ShiftFocus = "Morning Rush" | "Quiet Editing" | "After Hours";

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

export const CAFE_TABS: Array<{ id: CafeTabId; label: string }> = [
  { id: "orders", label: "Orders" },
  { id: "menu", label: "Menu" },
  { id: "delivery", label: "Delivery" },
];

export const SHIFT_OPTIONS: ShiftFocus[] = ["Morning Rush", "Quiet Editing", "After Hours"];

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
  artworkUrl: "/kuma-cafe-icon.png",
  controlMessage: "Keep the maple cream chilled and visible on the hero board.",
};

export const RECEIPT_EXPORT_FILENAME = "kuma-cafe-receipts.csv";
