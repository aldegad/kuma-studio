import type { AgentPickerComponentItem } from "./types";

export interface AgentPickerRegistry {
  items: AgentPickerComponentItem[];
  itemsById: Map<string, AgentPickerComponentItem>;
}

export function createAgentPickerRegistry(
  items: AgentPickerComponentItem[],
): AgentPickerRegistry {
  return {
    items,
    itemsById: new Map(items.map((item) => [item.id, item])),
  };
}

export function mergeAgentPickerItems(
  ...sources: Array<AgentPickerComponentItem[] | null | undefined>
): AgentPickerComponentItem[] {
  return sources.flatMap((source) => source ?? []);
}
