const { createSessionId } = AgentPickerExtensionShared;

async function fetchDaemonHealth(daemonUrl) {
  const response = await fetch(`${daemonUrl}/health`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Bridge health check failed with status ${response.status}.`);
  }

  return response.json();
}

function getSessionLabel(page) {
  try {
    const hostname = new URL(page.url).hostname;
    return page.title?.trim() ? `${hostname} - ${page.title.trim()}` : hostname;
  } catch {
    return page.title?.trim() || "Browser Extension";
  }
}

function createSelectionPayload(pageContext, screenshotDataUrl) {
  const capturedAt = new Date().toISOString();
  const element = {
    ...pageContext.element,
    snapshot: screenshotDataUrl
      ? {
          dataUrl: screenshotDataUrl,
          mimeType: "image/png",
          width: 0,
          height: 0,
          capturedAt,
        }
      : null,
  };

  return {
    version: 1,
    capturedAt,
    page: pageContext.page,
    session: {
      id: createSessionId(),
      label: getSessionLabel(pageContext.page),
      index: 0,
      updatedAt: capturedAt,
    },
    element,
    elements: [element],
  };
}

async function saveSelectionToDaemon(daemonUrl, pageContext, screenshotDataUrl) {
  const response = await fetch(`${daemonUrl}/dev-selection`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createSelectionPayload(pageContext, screenshotDataUrl)),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Failed to save the selection to ${daemonUrl}.`);
  }

  return response.json();
}
