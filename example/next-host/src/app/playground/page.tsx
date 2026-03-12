import type { Metadata } from "next";
import { DraftWorkspace } from "@/components/agent-picker/DraftWorkspace";

export const metadata: Metadata = {
  title: "Agent Picker Playground",
  description: "Standalone draft playground for the bundled Agent Picker example host.",
};

export default function PlaygroundPage() {
  return <DraftWorkspace />;
}
