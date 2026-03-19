"use client";

import type { ComponentType } from "react";
import {
  KumaPickerDesignLab,
  type KumaPickerComponentItem,
} from "@kuma-picker/design-lab";
import WelcomeCard from "../../components/kuma-picker/WelcomeCard";

const designLabItems: KumaPickerComponentItem[] = [
  {
    id: "draft-example-welcome-card",
    title: "Welcome Card",
    shortLabel: "Welcome Card",
    description: "Standalone example card shipped with the Kuma Picker repository.",
    sourceKind: "draft",
    category: "cards",
    componentPath: "src/components/kuma-picker/WelcomeCard.tsx",
    tags: ["example", "welcome", "card"],
    recommendedViewport: "desktop",
    renderKind: "component",
    Component: WelcomeCard as ComponentType<Record<string, unknown>>,
    props: {},
  },
];

export default function DesignLabPage() {
  return <KumaPickerDesignLab items={designLabItems} />;
}
