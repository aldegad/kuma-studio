"use client";

import { KumaPickerProvider } from "@kuma-picker/picker";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <KumaPickerProvider>
      {children}
    </KumaPickerProvider>
  );
}
