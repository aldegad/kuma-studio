import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readOptionalString } from "./cli-options.mjs";

const SUPPORTED_SEQUENCE_STEP_TYPES = new Set([
  "click",
  "click-point",
  "pointer-drag",
  "fill",
  "key",
  "keydown",
  "keyup",
  "mousemove",
  "mousedown",
  "mouseup",
  "wait-for-text",
  "wait-for-text-disappear",
  "wait-for-selector",
  "wait-for-dialog-close",
  "query-dom",
  "measure",
  "dom",
  "console",
]);

const SUPPORTED_SEQUENCE_ASSERTION_TYPES = new Set([
  "wait-for-text",
  "wait-for-text-disappear",
  "wait-for-selector",
  "wait-for-dialog-close",
  "selector-state",
]);

function parseJson(rawValue, sourceLabel) {
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    throw new Error(
      `Failed to parse browser sequence JSON from ${sourceLabel}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeAssertion(assertion, stepIndex, assertionIndex) {
  if (!assertion || typeof assertion !== "object" || Array.isArray(assertion)) {
    throw new Error(`browser-sequence step ${stepIndex + 1} assertion ${assertionIndex + 1} must be an object.`);
  }

  const type = typeof assertion.type === "string" ? assertion.type.trim() : "";
  if (!type) {
    throw new Error(`browser-sequence step ${stepIndex + 1} assertion ${assertionIndex + 1} requires a type.`);
  }

  if (!SUPPORTED_SEQUENCE_ASSERTION_TYPES.has(type)) {
    throw new Error(
      `browser-sequence step ${stepIndex + 1} assertion ${assertionIndex + 1} uses unsupported type "${type}".`,
    );
  }

  return { ...assertion, type };
}

function normalizeAssertions(step, stepIndex) {
  const collected = [];
  const stepAssert = step.assert;
  const stepAssertions = step.assertions;

  if (stepAssert != null) {
    collected.push(...(Array.isArray(stepAssert) ? stepAssert : [stepAssert]));
  }

  if (stepAssertions != null) {
    if (!Array.isArray(stepAssertions)) {
      throw new Error(`browser-sequence step ${stepIndex + 1} assertions must be an array.`);
    }
    collected.push(...stepAssertions);
  }

  return collected.map((assertion, assertionIndex) => normalizeAssertion(assertion, stepIndex, assertionIndex));
}

function normalizeStep(step, stepIndex) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new Error(`browser-sequence step ${stepIndex + 1} must be an object.`);
  }

  const type = typeof step.type === "string" ? step.type.trim() : "";
  if (!type) {
    throw new Error(`browser-sequence step ${stepIndex + 1} requires a type.`);
  }

  if (!SUPPORTED_SEQUENCE_STEP_TYPES.has(type)) {
    throw new Error(`browser-sequence step ${stepIndex + 1} uses unsupported type "${type}".`);
  }

  const normalizedStep = { ...step, type };
  const assertions = normalizeAssertions(step, stepIndex);
  delete normalizedStep.assert;
  delete normalizedStep.assertions;

  if (assertions.length > 0) {
    normalizedStep.assertions = assertions;
  }

  return normalizedStep;
}

export function normalizeBrowserSequenceDefinition(definition, sourceLabel = "input") {
  const steps = Array.isArray(definition) ? definition : definition?.steps;
  if (!Array.isArray(steps)) {
    throw new Error(`browser-sequence ${sourceLabel} must be a JSON array or an object with a steps array.`);
  }

  if (steps.length === 0) {
    throw new Error(`browser-sequence ${sourceLabel} must include at least one step.`);
  }

  return steps.map((step, stepIndex) => normalizeStep(step, stepIndex));
}

export function readBrowserSequenceSteps(options) {
  const inlineSteps = readOptionalString(options, "steps");
  const stepsFile = readOptionalString(options, "steps-file");

  if (!inlineSteps && !stepsFile) {
    throw new Error("browser-sequence requires --steps or --steps-file.");
  }

  if (inlineSteps && stepsFile) {
    throw new Error("browser-sequence accepts either --steps or --steps-file, not both.");
  }

  if (stepsFile) {
    const filePath = resolve(stepsFile);
    const parsed = parseJson(readFileSync(filePath, "utf8"), filePath);
    return normalizeBrowserSequenceDefinition(parsed, filePath);
  }

  return normalizeBrowserSequenceDefinition(parseJson(inlineSteps, "--steps"), "--steps");
}

export {
  SUPPORTED_SEQUENCE_ASSERTION_TYPES,
  SUPPORTED_SEQUENCE_STEP_TYPES,
};
