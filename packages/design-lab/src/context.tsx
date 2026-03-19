"use client";

import { createContext, useContext, useMemo } from "react";
import { KumaPickerProvider } from "../../picker/src";
import InternalKumaPickerApp from "../../../web/components/KumaPickerApp";
import {
  createKumaPickerRegistry,
  mergeKumaPickerItems,
  type KumaPickerRegistry,
} from "./registry";
import type { KumaPickerComponentItem } from "./types";

interface KumaPickerDesignLabProviderProps {
  children: React.ReactNode;
  items: KumaPickerComponentItem[];
  itemsById?: Map<string, KumaPickerComponentItem>;
}

interface KumaPickerDesignLabProps {
  items?: KumaPickerComponentItem[];
  itemsById?: Map<string, KumaPickerComponentItem>;
}

interface KumaPickerDesignLabProjectProviderProps {
  children: React.ReactNode;
  draftItems?: KumaPickerComponentItem[];
  projectItems?: KumaPickerComponentItem[];
  pageImportItems?: KumaPickerComponentItem[];
  showDevtoolsInDevelopment?: boolean;
}

const KumaPickerRegistryContext = createContext<KumaPickerRegistry | null>(null);

function useResolvedRegistry(
  items?: KumaPickerComponentItem[],
  itemsById?: Map<string, KumaPickerComponentItem>,
): KumaPickerRegistry {
  const context = useContext(KumaPickerRegistryContext);

  return useMemo(() => {
    if (items) {
      return itemsById ? { items, itemsById } : createKumaPickerRegistry(items);
    }

    if (context) {
      return context;
    }

    throw new Error(
      "KumaPickerDesignLab needs either KumaPickerDesignLabProvider or explicit items.",
    );
  }, [context, items, itemsById]);
}

export function KumaPickerDesignLabProvider({
  children,
  items,
  itemsById,
}: KumaPickerDesignLabProviderProps) {
  const value = useMemo(
    () => (itemsById ? { items, itemsById } : createKumaPickerRegistry(items)),
    [items, itemsById],
  );

  return (
    <KumaPickerRegistryContext.Provider value={value}>
      {children}
    </KumaPickerRegistryContext.Provider>
  );
}

export function KumaPickerDesignLabProjectProvider({
  children,
  draftItems = [],
  projectItems = [],
  pageImportItems = [],
  showDevtoolsInDevelopment = false,
}: KumaPickerDesignLabProjectProviderProps) {
  const items = useMemo(
    () => mergeKumaPickerItems(draftItems, projectItems, pageImportItems),
    [draftItems, pageImportItems, projectItems],
  );

  return (
    <KumaPickerProvider showDevtoolsInDevelopment={showDevtoolsInDevelopment}>
      <KumaPickerDesignLabProvider items={items}>
        {children}
      </KumaPickerDesignLabProvider>
    </KumaPickerProvider>
  );
}

export function useKumaPickerRegistry() {
  const context = useContext(KumaPickerRegistryContext);
  if (!context) {
    throw new Error(
      "useKumaPickerRegistry must be used inside KumaPickerDesignLabProvider.",
    );
  }

  return context;
}

export function KumaPickerDesignLab({
  items,
  itemsById,
}: KumaPickerDesignLabProps) {
  const registry = useResolvedRegistry(items, itemsById);

  return (
    <InternalKumaPickerApp
      items={registry.items}
      itemsById={registry.itemsById}
    />
  );
}
