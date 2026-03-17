const COMMAND_INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "summary",
  "label",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='option']",
  "[aria-controls]",
].join(", ");

const DOM_SNAPSHOT_LIMIT = 64;
const TEXT_SNIPPET_LIMIT = 2_000;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isVisibleElement(element) {
  if (!(element instanceof Element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    return false;
  }

  const styles = window.getComputedStyle(element);
  return styles.display !== "none" && styles.visibility !== "hidden";
}

function describeElementForCommand(element) {
  const record = toSelectionElementRecord(element);

  return {
    tagName: record.tagName,
    role: record.role,
    selector: record.selector,
    selectorPath: record.selectorPath,
    textPreview: record.textPreview,
    rect: record.rect,
  };
}

function getCommandCandidates() {
  return Array.from(document.querySelectorAll(COMMAND_INTERACTIVE_SELECTOR)).filter(isVisibleElement);
}

function getAccessibleText(element) {
  return normalizeText(
    element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      ("value" in element ? element.value : "") ||
      element.textContent,
  );
}

function findElementBySelector(selector) {
  if (!selector) {
    return null;
  }

  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function findElementByText(text) {
  const normalizedNeedle = normalizeText(text);
  if (!normalizedNeedle) {
    return null;
  }

  const candidates = getCommandCandidates().map((element) => ({
    element,
    text: getAccessibleText(element),
  }));

  return (
    candidates.find((entry) => entry.text === normalizedNeedle)?.element ??
    candidates.find((entry) => entry.text.includes(normalizedNeedle))?.element ??
    null
  );
}

function resolveCommandTarget(command) {
  return (
    findElementBySelector(command?.selectorPath) ??
    findElementBySelector(command?.selector) ??
    findElementByText(command?.text)
  );
}

function getFocusedElementRecord() {
  return document.activeElement instanceof Element && isVisibleElement(document.activeElement)
    ? describeElementForCommand(document.activeElement)
    : null;
}

function buildDomSnapshot() {
  const interactiveElements = getCommandCandidates()
    .slice(0, DOM_SNAPSHOT_LIMIT)
    .map(describeElementForCommand);
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .filter(isVisibleElement)
    .slice(0, 12)
    .map((element) => ({
      tagName: element.tagName.toLowerCase(),
      text: normalizeText(element.textContent).slice(0, 240),
      selector: createSelector(element),
      selectorPath: createSelectorPath(element),
    }));

  return {
    page: buildPageRecord(),
    viewport: getViewportMetrics(),
    focusedElement: getFocusedElementRecord(),
    interactiveElements,
    headings,
    textExcerpt: normalizeText(document.body?.innerText ?? "").slice(0, TEXT_SNIPPET_LIMIT),
  };
}

async function executeClickCommand(command) {
  const target = resolveCommandTarget(command);
  if (!target || !(target instanceof Element)) {
    throw new Error("Failed to find a matching element to click in the active tab.");
  }

  target.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "auto",
  });
  target.focus?.({ preventScroll: true });

  if (target instanceof HTMLElement) {
    target.click();
  } else {
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  }

  const postActionDelayMs =
    typeof command?.postActionDelayMs === "number" && Number.isFinite(command.postActionDelayMs)
      ? Math.max(0, Math.min(10_000, Math.round(command.postActionDelayMs)))
      : 400;

  if (postActionDelayMs > 0) {
    await new Promise((resolvePromise) => {
      window.setTimeout(resolvePromise, postActionDelayMs);
    });
  }

  return {
    page: buildPageRecord(),
    clickedElement: describeElementForCommand(target),
  };
}

async function executeBrowserCommand(command) {
  switch (command?.type) {
    case "context":
      return {
        pageContext: buildPageContext(getPageTargetElement()),
      };
    case "dom":
      return {
        domSnapshot: buildDomSnapshot(),
      };
    case "click":
      return executeClickCommand(command);
    default:
      throw new Error(`Unsupported Agent Picker browser command: ${String(command?.type)}`);
  }
}

globalThis.AgentPickerExtensionAgentActions = {
  executeBrowserCommand,
};
