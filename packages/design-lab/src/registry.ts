import type { KumaPickerComponentItem } from "./types";

export interface KumaPickerRegistry {
  items: KumaPickerComponentItem[];
  itemsById: Map<string, KumaPickerComponentItem>;
}

export function createKumaPickerRegistry(
  items: KumaPickerComponentItem[],
): KumaPickerRegistry {
  return {
    items,
    itemsById: new Map(items.map((item) => [item.id, item])),
  };
}

export function mergeKumaPickerItems(
  ...sources: Array<KumaPickerComponentItem[] | null | undefined>
): KumaPickerComponentItem[] {
  return sources.flatMap((source) => source ?? []);
}
