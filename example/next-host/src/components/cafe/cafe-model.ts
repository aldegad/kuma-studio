export type CafeTabId = "orders" | "menu" | "delivery";
export type ShiftFocus = "Morning Rush" | "Quiet Editing" | "After Hours";

export type SeasonalDrink = {
  name: string;
  url: string;
  controlMessage: string;
};

export const CAFE_TABS: Array<{ id: CafeTabId; label: string }> = [
  { id: "orders", label: "Orders" },
  { id: "menu", label: "Menu" },
  { id: "delivery", label: "Delivery" },
];

export const SHIFT_OPTIONS: ShiftFocus[] = ["Morning Rush", "Quiet Editing", "After Hours"];

export const DEFAULT_SEASONAL_DRINK: SeasonalDrink = {
  name: "Maple Cream Matcha",
  url: "https://example.com/menu/maple-cream-matcha",
  controlMessage: "Keep the maple cream chilled and visible on the hero board.",
};

export const RECEIPT_EXPORT_FILENAME = "kuma-cafe-receipts.csv";
