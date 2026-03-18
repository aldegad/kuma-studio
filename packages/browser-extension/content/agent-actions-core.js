(() => {
var AgentPickerExtensionAgentActionCore = (() => {
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

  const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "textarea:not([disabled])",
    "select:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']",
  ].join(", ");

  const DOM_SNAPSHOT_LIMIT = 64;
  const TEXT_SNIPPET_LIMIT = 2_000;

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeRole(value) {
    return normalizeText(value).toLowerCase() || null;
  }

  function isExtensionUiElement(element) {
    return Boolean(element?.closest?.(`[${UI_ATTRIBUTE}="true"]`));
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element) || isExtensionUiElement(element)) {
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
      label: record.label ?? null,
      selector: record.selector,
      selectorPath: record.selectorPath,
      textPreview: record.textPreview,
      value: record.value ?? null,
      valuePreview: record.valuePreview ?? null,
      checked: typeof record.checked === "boolean" ? record.checked : null,
      selectedValue: record.selectedValue ?? null,
      selectedValues: Array.isArray(record.selectedValues) ? record.selectedValues : [],
      placeholder: record.placeholder ?? null,
      required: record.required === true,
      disabled: record.disabled === true,
      readOnly: record.readOnly === true,
      multiple: record.multiple === true,
      inputType: record.inputType ?? null,
      rect: record.rect,
    };
  }

  function getCommandCandidatesWithinRoot(root) {
    if (!(root instanceof Element)) {
      return [];
    }

    return Array.from(root.querySelectorAll(COMMAND_INTERACTIVE_SELECTOR)).filter(isVisibleElement);
  }

  function getCommandCandidates() {
    return getCommandCandidatesWithinRoot(document.body || document.documentElement);
  }

  function getAccessibleText(element) {
    return normalizeText(
      element.getAttribute("aria-label") ||
        ("value" in element ? element.value : "") ||
        element.textContent ||
        getPrimaryLabel(element) ||
        element.getAttribute("title"),
    );
  }

  function isTextInputElement(element) {
    if (element instanceof HTMLTextAreaElement) {
      return true;
    }

    if (!(element instanceof HTMLInputElement)) {
      return false;
    }

    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(
      element.type,
    );
  }

  function isFillableElement(element) {
    return (
      isTextInputElement(element) ||
      element instanceof HTMLSelectElement ||
      Boolean(element instanceof HTMLElement && element.isContentEditable)
    );
  }

  function getFillableElements(root = document) {
    return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (element) => element instanceof Element && isVisibleElement(element) && isFillableElement(element),
    );
  }

  function scoreTextMatch(candidate, needle) {
    if (!candidate || !needle) {
      return 0;
    }
    if (candidate === needle) {
      return 3;
    }
    if (candidate.startsWith(needle)) {
      return 2;
    }
    if (candidate.includes(needle)) {
      return 1;
    }
    return 0;
  }

  function findBestFillableByLabel(labelText, root = document) {
    const normalizedNeedle = normalizeText(labelText);
    if (!normalizedNeedle) {
      return null;
    }

    const candidates = getFillableElements(root)
      .map((element) => {
        const labels = typeof getAssociatedLabelTexts === "function" ? getAssociatedLabelTexts(element) : [];
        const normalizedLabels = labels.map((entry) => normalizeText(entry)).filter(Boolean);
        const score = normalizedLabels.reduce((best, entry) => Math.max(best, scoreTextMatch(entry, normalizedNeedle)), 0);
        return {
          element,
          score,
          rect: element.getBoundingClientRect(),
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.rect.top - right.rect.top || left.rect.left - right.rect.left);

    if (candidates.length === 0) {
      return null;
    }

    if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
      const primaryRect = candidates[0].rect;
      const secondaryRect = candidates[1].rect;
      const closeTogether =
        Math.abs(primaryRect.top - secondaryRect.top) < 24 && Math.abs(primaryRect.left - secondaryRect.left) < 24;
      if (closeTogether) {
        throw new Error(`Multiple fillable fields matched the label "${labelText}". Add a selector for a more specific target.`);
      }
    }

    return candidates[0].element;
  }

  function getVisibleDialogs() {
    return Array.from(document.querySelectorAll("dialog[open], [role='dialog'], [aria-modal='true']")).filter(
      (element) => element instanceof Element && isVisibleElement(element),
    );
  }

  function getScopeRoot(scope) {
    if (scope === "dialog") {
      return getVisibleDialogs()[0] ?? null;
    }
    return document.body || document.documentElement;
  }

  function findElementByTextWithinRoot(text, root = document.body || document.documentElement) {
    const normalizedNeedle = normalizeText(text);
    if (!normalizedNeedle || !(root instanceof Element)) {
      return null;
    }

    const candidates = Array.from(root.querySelectorAll("*"))
      .filter((element) => isVisibleElement(element) && normalizeText(element.textContent).length > 0)
      .map((element) => ({ element, text: normalizeText(element.textContent) }));

    return (
      candidates.find((entry) => entry.text === normalizedNeedle)?.element ??
      candidates.find((entry) => entry.text.includes(normalizedNeedle))?.element ??
      null
    );
  }

  function findElementBySelector(selector) {
    if (!selector) {
      return null;
    }
    try {
      const target = document.querySelector(selector);
      return isVisibleElement(target) ? target : target ?? null;
    } catch {
      return null;
    }
  }

  function findElementBySelectorWithinRoot(selector, root) {
    if (!selector || !(root instanceof Element)) {
      return null;
    }
    try {
      const target = root.querySelector(selector);
      return isVisibleElement(target) ? target : null;
    } catch {
      return null;
    }
  }

  function getLastObservedSelectorState(selector, root) {
    if (!(root instanceof Element)) {
      return { present: false, visible: false };
    }
    try {
      const target = root.querySelector(selector);
      return { present: target instanceof Element, visible: isVisibleElement(target) };
    } catch {
      return { present: false, visible: false };
    }
  }

  function matchesRequestedRole(element, requestedRole) {
    const normalizedRole = normalizeRole(requestedRole);
    if (!normalizedRole) {
      return true;
    }
    return normalizeRole(element.getAttribute("role")) === normalizedRole || element.tagName.toLowerCase() === normalizedRole;
  }

  function resolveWithinRoot(command) {
    const documentRoot = document.body || document.documentElement;
    const withinText = normalizeText(command?.within);
    if (!withinText) {
      return documentRoot;
    }

    const anchor = findElementByTextWithinRoot(withinText, documentRoot);
    if (!(anchor instanceof Element)) {
      throw new Error(`Failed to find a visible container matching "${command.within}".`);
    }

    return (
      anchor.closest(
        "[role='dialog'], [role='tabpanel'], [role='tablist'], [role='group'], fieldset, form, section, article, main, nav, aside, label, div",
      ) ??
      anchor.parentElement ??
      documentRoot
    );
  }

  function selectNthMatch(matches, command, description) {
    if (matches.length === 0) {
      return null;
    }
    const nth = command?.nth;
    if (nth == null) {
      return matches[0]?.element ?? null;
    }
    if (!Number.isInteger(nth) || nth < 1) {
      throw new Error(`${description} requires a positive integer --nth value.`);
    }
    if (matches.length < nth) {
      throw new Error(`Only found ${matches.length} matching ${description}. Requested --nth ${nth}.`);
    }
    return matches[nth - 1].element;
  }

  function findElementByTextWithConstraints(text, command, root = document.body || document.documentElement) {
    const normalizedNeedle = normalizeText(text);
    if (!normalizedNeedle) {
      return null;
    }

    const candidates = getCommandCandidatesWithinRoot(root)
      .filter((element) => matchesRequestedRole(element, command?.role))
      .map((element) => {
        const candidateText = getAccessibleText(element);
        const score = command?.exactText === true ? Number(candidateText === normalizedNeedle) : scoreTextMatch(candidateText, normalizedNeedle);
        return { element, text: candidateText, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.text.length - right.text.length);

    return selectNthMatch(candidates, command, "browser-click target");
  }

  function resolveCommandTarget(command, options = {}) {
    const scopeRoot = resolveWithinRoot(command);
    const selectorTarget =
      findElementBySelectorWithinRoot(command?.selectorPath, scopeRoot) ??
      findElementBySelectorWithinRoot(command?.selector, scopeRoot) ??
      findElementBySelector(command?.selectorPath) ??
      findElementBySelector(command?.selector);

    if (selectorTarget) {
      if (!matchesRequestedRole(selectorTarget, command?.role)) {
        throw new Error(`The matched selector target does not satisfy the requested role "${command.role}".`);
      }
      return selectorTarget;
    }

    const textTarget = findElementByTextWithConstraints(command?.text, command, scopeRoot);
    if (textTarget) {
      return textTarget;
    }

    if (options.allowFocusedElement && document.activeElement instanceof Element) {
      return document.activeElement;
    }

    return null;
  }

  function resolveFillTarget(command) {
    const scopeRoot = getScopeRoot(command?.scope) ?? (document.body || document.documentElement);
    const selectorTarget =
      findElementBySelectorWithinRoot(command?.selectorPath, scopeRoot) ??
      findElementBySelectorWithinRoot(command?.selector, scopeRoot) ??
      findElementBySelector(command?.selectorPath) ??
      findElementBySelector(command?.selector);
    if (selectorTarget && isFillableElement(selectorTarget)) {
      return selectorTarget;
    }

    if (typeof command?.label === "string" && command.label.trim()) {
      const labelTarget = findBestFillableByLabel(command.label, scopeRoot);
      if (labelTarget) {
        return labelTarget;
      }
    }

    const textTarget = findElementByTextWithConstraints(command?.text, {}, scopeRoot);
    if (textTarget && isFillableElement(textTarget)) {
      return textTarget;
    }

    if (document.activeElement instanceof Element && isFillableElement(document.activeElement)) {
      return document.activeElement;
    }

    return null;
  }

  function getFocusedElementRecord() {
    return document.activeElement instanceof Element && isVisibleElement(document.activeElement)
      ? describeElementForCommand(document.activeElement)
      : null;
  }

  function buildDomSnapshot() {
    const interactiveElements = getCommandCandidates().slice(0, DOM_SNAPSHOT_LIMIT).map(describeElementForCommand);
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

  return {
    FOCUSABLE_SELECTOR,
    normalizeText,
    normalizeRole,
    isExtensionUiElement,
    isVisibleElement,
    describeElementForCommand,
    getAccessibleText,
    isTextInputElement,
    isFillableElement,
    getFillableElements,
    scoreTextMatch,
    findBestFillableByLabel,
    getVisibleDialogs,
    getScopeRoot,
    findElementByTextWithinRoot,
    findElementBySelector,
    findElementBySelectorWithinRoot,
    getLastObservedSelectorState,
    matchesRequestedRole,
    resolveCommandTarget,
    resolveFillTarget,
    getCommandCandidates,
    getCommandCandidatesWithinRoot,
    buildDomSnapshot,
  };
})();

globalThis.AgentPickerExtensionAgentActionCore = AgentPickerExtensionAgentActionCore;
})();
