"use client";

import { createContext, useContext, useMemo } from "react";
import { AgentPickerProvider } from "../../picker/src";
import InternalAgentPickerApp from "../../../web/components/AgentPickerApp";
import {
  createAgentPickerRegistry,
  mergeAgentPickerItems,
  type AgentPickerRegistry,
} from "./registry";
import type { AgentPickerComponentItem } from "./types";

interface AgentPickerDesignLabProviderProps {
  children: React.ReactNode;
  items: AgentPickerComponentItem[];
  itemsById?: Map<string, AgentPickerComponentItem>;
}

interface AgentPickerDesignLabProps {
  items?: AgentPickerComponentItem[];
  itemsById?: Map<string, AgentPickerComponentItem>;
}

interface AgentPickerDesignLabProjectProviderProps {
  children: React.ReactNode;
  draftItems?: AgentPickerComponentItem[];
  projectItems?: AgentPickerComponentItem[];
  pageImportItems?: AgentPickerComponentItem[];
  showDevtoolsInDevelopment?: boolean;
}

const AgentPickerRegistryContext = createContext<AgentPickerRegistry | null>(null);

function useResolvedRegistry(
  items?: AgentPickerComponentItem[],
  itemsById?: Map<string, AgentPickerComponentItem>,
): AgentPickerRegistry {
  const context = useContext(AgentPickerRegistryContext);

  return useMemo(() => {
    if (items) {
      return itemsById ? { items, itemsById } : createAgentPickerRegistry(items);
    }

    if (context) {
      return context;
    }

    throw new Error(
      "AgentPickerDesignLab needs either AgentPickerDesignLabProvider or explicit items.",
    );
  }, [context, items, itemsById]);
}

export function AgentPickerDesignLabProvider({
  children,
  items,
  itemsById,
}: AgentPickerDesignLabProviderProps) {
  const value = useMemo(
    () => (itemsById ? { items, itemsById } : createAgentPickerRegistry(items)),
    [items, itemsById],
  );

  return (
    <AgentPickerRegistryContext.Provider value={value}>
      {children}
    </AgentPickerRegistryContext.Provider>
  );
}

export function AgentPickerDesignLabProjectProvider({
  children,
  draftItems = [],
  projectItems = [],
  pageImportItems = [],
  showDevtoolsInDevelopment = false,
}: AgentPickerDesignLabProjectProviderProps) {
  const items = useMemo(
    () => mergeAgentPickerItems(draftItems, projectItems, pageImportItems),
    [draftItems, pageImportItems, projectItems],
  );

  return (
    <AgentPickerProvider showDevtoolsInDevelopment={showDevtoolsInDevelopment}>
      <AgentPickerDesignLabProvider items={items}>
        {children}
      </AgentPickerDesignLabProvider>
    </AgentPickerProvider>
  );
}

export function useAgentPickerRegistry() {
  const context = useContext(AgentPickerRegistryContext);
  if (!context) {
    throw new Error(
      "useAgentPickerRegistry must be used inside AgentPickerDesignLabProvider.",
    );
  }

  return context;
}

export function AgentPickerDesignLab({
  items,
  itemsById,
}: AgentPickerDesignLabProps) {
  const registry = useResolvedRegistry(items, itemsById);

  return (
    <InternalAgentPickerApp
      items={registry.items}
      itemsById={registry.itemsById}
    />
  );
}
