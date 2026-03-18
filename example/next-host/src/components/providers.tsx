"use client";

import { AgentPickerProvider } from "@agent-picker/picker";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AgentPickerProvider>
      {children}
    </AgentPickerProvider>
  );
}
