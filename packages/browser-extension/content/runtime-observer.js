if (!globalThis.AgentPickerExtensionRuntimeObserver) {
  const AGENT_PICKER_RUNTIME_SOURCE = "agent-picker:runtime-observer";
  const MAX_RUNTIME_ENTRIES = 200;
  const runtimeEntries = [];

  function cloneEntry(entry) {
    return entry == null ? null : JSON.parse(JSON.stringify(entry));
  }

  function recordRuntimeEntry(entry) {
    const clonedEntry = cloneEntry(entry);
    if (!clonedEntry) {
      return;
    }

    runtimeEntries.push(clonedEntry);
    if (runtimeEntries.length > MAX_RUNTIME_ENTRIES) {
      runtimeEntries.splice(0, runtimeEntries.length - MAX_RUNTIME_ENTRIES);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const payload = event.data;
    if (!payload || payload.source !== AGENT_PICKER_RUNTIME_SOURCE || !payload.entry) {
      return;
    }

    recordRuntimeEntry(payload.entry);
  });

  void chrome.runtime.sendMessage({
    type: "agent-picker:ensure-runtime-observer",
  }).catch(() => {
    // Ignore pages that cannot use the extension bridge.
  });

  globalThis.AgentPickerExtensionRuntimeObserver = {
    readEntries() {
      return {
        count: runtimeEntries.length,
        entries: runtimeEntries.slice(),
      };
    },
  };
}
