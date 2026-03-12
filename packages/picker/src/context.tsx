"use client";

import InternalAgentDomPicker from "../../../web/components/devtools/AgentDomPicker";

interface AgentPickerProviderProps {
  children: React.ReactNode;
  showDevtoolsInDevelopment?: boolean;
}

export function AgentPickerProvider({
  children,
  showDevtoolsInDevelopment = false,
}: AgentPickerProviderProps) {
  return (
    <>
      {children}
      {showDevtoolsInDevelopment && process.env.NODE_ENV === "development" ? (
        <InternalAgentDomPicker />
      ) : null}
    </>
  );
}

export function AgentPickerDevtools() {
  return <InternalAgentDomPicker />;
}
