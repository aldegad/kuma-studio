// @ts-check

const PROMPT_LINE_PATTERN = /^(?:❯|>|›)\s*$/u;
const CODEX_SUGGESTION_LINE_PATTERN = /^›\s+\S/u;
const BOX_DRAWING_PATTERN = /[\u2500-\u257F]/u;
const SURFACE_SPINNER_PATTERN = /^[✻✶✳✢·]\s*/u;
const COMPLETED_SURFACE_PATTERN =
  /^[✻✶✳✢·]\s*(?:baked|brewed|cooked|toasted|charred|churned|saut(?:e|é)ed|cogitated)\s+for\b/iu;
const WORKING_SURFACE_PATTERNS = [
  /^[✻✶✳✢·]\s*(?:concocting|thinking|meandering|fiddle-faddling|metamorphosing|working|reading|creating|cultivating)\b.*(?:\.\.\.|…)?$/iu,
  /^•\s*(?:working|creating|cultivating)\b.*$/iu,
  /^•\s*thinking(?:\.\.\.|…)?$/iu,
  /^•\s*Waiting\s+for\s+background\s+terminal\b/iu,
  /^•\s*Waited\s+for\s+background\s+terminal\b/iu,
  /\brunning(?:\.\.\.|…)/iu,
];
const THINKING_ONLY_SURFACE_PATTERNS = [
  /^[*✻✶✳✢·]\s*(?:scurrying|cogitating|brewing|whisking|cogitated|brewed|whisked|worked)\b.*$/iu,
];
const ACTIVE_TOOL_WORK_LINE_PATTERNS = [
  /^(?:[⏺●•]\s*)?(?:bash|read|edit)\(/iu,
];
const STATUS_BAR_LINE_PATTERNS = [
  /⏵⏵\s*bypass(?:\s+permissions?)?(?: on\b.*)?/iu,
  /⏵⏵.*bypa\s*·.*permissions.*$/iu,
  /\bnow using extra usage\b/iu,
  /\bextra credit\b/iu,
];
const IGNORED_SURFACE_LINE_PATTERNS = [
  /^\s*⏵⏵.*bypass permissions/iu,
  /^\s*⏵⏵.*bypa\s*·.*permissions/iu,
  /^\s*\d+\s*shell\b.*(?:esc|↓)/iu,
  /^\s*…\s*\+\d+\s*lines\b/iu,
];
const SURFACE_HINT_PATTERNS = [
  /^bypass(?:\s+permissions?)?\b/iu,
  /^now using extra usage\b/iu,
  /^extra credit\b/iu,
  /^compacting conversation(?:\.\.\.|…)?$/iu,
  /^compacting conversation\b/iu,
  /^compacted conversation\b/iu,
  /^tip:.*\/statusline\b/iu,
  /^\/statusline\b/iu,
  /^context left until auto-compact\b/iu,
  /^(?:brewed|baked|cooked|toasted|charred|churned|saut(?:e|é)ed) for\b/iu,
  /^gpt-[\w.-]+\s+(?:low|medium|high|xhigh)(?:\s+fast)?\b/iu,
  /^esc to\b/iu,
  /^press up to edit\b/iu,
  /^shift\+tab to cycle\b/iu,
  /^tab to queue\b/iu,
  /^[─━═─]{3,}$/u,
];
const IDLE_PROMPT_HINT_PATTERNS = [
  /^~?\d+(?:\.\d+)?k uncached\b.*\/clear to start(?:\s+fresh|…)?$/iu,
  /^gpt-[\w.-]+(?:…)?(?:\s+.*)?$/iu,
  /^new task\?\s*\/clear to save \d+(?:\.\d+)?k tokens$/iu,
  /^\d+(?:\.\d+)?%\s+until auto-compact\b.*$/iu,
];
const DEAD_OUTPUT_PATTERN =
  /invalid_params|not a terminal|no such surface|surface(?::\d+|\s+[^\n\r]+)?\s+not found|read failed|timed out|enoent|command not found|fatal|panic|traceback|uncaught exception|segmentation fault/iu;

/**
 * @typedef {"idle" | "working" | "dead"} SurfaceStatus
 */

/**
 * @typedef {{
 *   status: SurfaceStatus,
 *   preview: string,
 *   lastOutputLines: string[],
 * }} SurfaceClassification
 */

/**
 * @param {string} output
 * @returns {string[]}
 */
export function getOutputLines(output) {
  return String(output ?? "")
    .replace(/\r/gu, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {string} line
 * @returns {string}
 */
export function stripStatusBarText(line) {
  return STATUS_BAR_LINE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, " "),
    String(line ?? ""),
  ).trim();
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isPromptLine(line) {
  const trimmed = String(line ?? "").trim();
  if (PROMPT_LINE_PATTERN.test(trimmed)) {
    return true;
  }

  const withoutFooter = stripStatusBarText(trimmed);
  const withoutBoxDrawing = withoutFooter.replace(/[\u2500-\u257F]/gu, "").trim();
  return PROMPT_LINE_PATTERN.test(withoutBoxDrawing);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isCodexSuggestionLine(line) {
  const trimmed = stripStatusBarText(String(line ?? "").trim());
  return CODEX_SUGGESTION_LINE_PATTERN.test(trimmed);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isIdlePromptHintLine(line) {
  const trimmed = stripStatusBarText(String(line ?? "").trim());
  return IDLE_PROMPT_HINT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isThinkingOnlySurfaceLine(line) {
  const trimmed = stripStatusBarText(String(line ?? "").trim());
  return THINKING_ONLY_SURFACE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * @param {string[]} lines
 * @returns {boolean}
 */
function hasCompletedSurfaceSignal(lines) {
  return lines.some((line) => COMPLETED_SURFACE_PATTERN.test(line));
}

/**
 * @param {string[]} lines
 * @returns {boolean}
 */
function hasActiveWorkingSurfaceSignal(lines) {
  return lines.some((line) => {
    if (COMPLETED_SURFACE_PATTERN.test(line)) {
      return false;
    }

    if (isThinkingOnlySurfaceLine(line)) {
      return false;
    }

    if (WORKING_SURFACE_PATTERNS.some((pattern) => pattern.test(line))) {
      return true;
    }

    if (ACTIVE_TOOL_WORK_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      return true;
    }

    return SURFACE_SPINNER_PATTERN.test(line) && /(?:\.\.\.|…)/u.test(line);
  });
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isIgnoredSurfaceLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) {
    return false;
  }

  if (IGNORED_SURFACE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  if (BOX_DRAWING_PATTERN.test(trimmed)) {
    return true;
  }

  if (isThinkingOnlySurfaceLine(trimmed)) {
    return true;
  }

  if (isCodexSuggestionLine(trimmed)) {
    return true;
  }

  if (isIdlePromptHintLine(trimmed)) {
    return true;
  }

  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    return true;
  }

  const normalized = trimmed.replace(/^[^\p{L}\p{N}]+/u, "");
  return SURFACE_HINT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * @param {string} output
 * @returns {string[]}
 */
export function getMeaningfulOutputLines(output) {
  return getOutputLines(output).filter(
    (line) => !isPromptLine(line) && !isCodexSuggestionLine(line) && !isIgnoredSurfaceLine(line),
  );
}

/**
 * @param {string} output
 * @returns {string | null}
 */
export function getLastInteractiveLine(output) {
  const lines = getOutputLines(output);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (isPromptLine(line) || isCodexSuggestionLine(line) || isIdlePromptHintLine(line)) {
      return line;
    }

    if (isIgnoredSurfaceLine(line)) {
      continue;
    }

    return line;
  }

  return null;
}

/**
 * @param {string} output
 * @returns {string[]}
 */
export function getLastOutputLines(output) {
  const lines = getOutputLines(output);
  const activeWorkingSignal = hasActiveWorkingSurfaceSignal(lines);
  const lastInteractiveLine = getLastInteractiveLine(output);
  if (
    !activeWorkingSignal &&
    lastInteractiveLine &&
    (isPromptLine(lastInteractiveLine) || isCodexSuggestionLine(lastInteractiveLine) || isIdlePromptHintLine(lastInteractiveLine))
  ) {
    return [];
  }

  const meaningfulLines = getMeaningfulOutputLines(output);
  if (meaningfulLines.length > 0) {
    return meaningfulLines.slice(-5);
  }

  return [];
}

/**
 * @param {string} output
 * @returns {SurfaceStatus}
 */
export function classifySurfaceStatus(output) {
  const normalized = String(output ?? "").replace(/\r/gu, "").trim();

  if (!normalized) {
    return "dead";
  }

  if (DEAD_OUTPUT_PATTERN.test(normalized)) {
    return "dead";
  }

  const lines = getOutputLines(normalized);
  const activeWorkingSignal = hasActiveWorkingSurfaceSignal(lines);
  if (hasCompletedSurfaceSignal(lines)) {
    return "idle";
  }

  const lastInteractiveLine = getLastInteractiveLine(normalized);
  if (
    activeWorkingSignal &&
    lastInteractiveLine &&
    (isPromptLine(lastInteractiveLine) || isCodexSuggestionLine(lastInteractiveLine) || isIdlePromptHintLine(lastInteractiveLine))
  ) {
    return "working";
  }

  if (
    lastInteractiveLine &&
    (isPromptLine(lastInteractiveLine) || isCodexSuggestionLine(lastInteractiveLine) || isIdlePromptHintLine(lastInteractiveLine))
  ) {
    return "idle";
  }

  if (activeWorkingSignal) {
    return "working";
  }

  const meaningfulLines = getMeaningfulOutputLines(normalized);
  if (meaningfulLines.length > 0) {
    return "working";
  }

  const promptVisible = lines.some((line) => isPromptLine(line));
  if (promptVisible) {
    return "idle";
  }

  return "idle";
}

/**
 * @param {string} output
 * @returns {SurfaceClassification}
 */
export function classifySurfaceOutput(output) {
  const status = classifySurfaceStatus(output);
  const lastOutputLines = getLastOutputLines(output);
  const preview = lastOutputLines[lastOutputLines.length - 1] ?? "";

  return {
    status,
    preview,
    lastOutputLines,
  };
}
