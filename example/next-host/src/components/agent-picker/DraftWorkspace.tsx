"use client";

import { AgentPickerWorkspace } from "@agent-picker/workspace";
import { generatedAgentPickerDraftItems } from "@/lib/agent-picker/generated-drafts";

export function DraftWorkspace() {
  return <AgentPickerWorkspace items={generatedAgentPickerDraftItems} />;
}
