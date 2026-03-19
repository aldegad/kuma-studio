"use client";

import InternalAgentDomPicker from "../../../web/components/devtools/AgentDomPicker";

interface KumaPickerProviderProps {
  children: React.ReactNode;
  showDevtoolsInDevelopment?: boolean;
}

export function KumaPickerProvider({
  children,
  showDevtoolsInDevelopment = false,
}: KumaPickerProviderProps) {
  return (
    <>
      {children}
      {showDevtoolsInDevelopment && process.env.NODE_ENV === "development" ? (
        <InternalAgentDomPicker />
      ) : null}
    </>
  );
}

export function KumaPickerDevtools() {
  return <InternalAgentDomPicker />;
}
