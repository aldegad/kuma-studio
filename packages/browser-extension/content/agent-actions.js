if (!globalThis.AgentPickerExtensionAgentActions?.executeBrowserCommand) {
  throw new Error("Agent Picker browser action modules failed to initialize.");
}
