import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const EIGHTH_MS = 278;
const LEGATO_OVERLAP_MS = 104;

function keySelector(keyId) {
  return `[data-piano-key-id="${keyId}"]`;
}

function measure(left, right, options = {}) {
  return { left, right, ...options };
}

const VARIATION_A = [
  measure(["lower-D2", "lower-A2"], [["upper-F#5"], ["upper-A5"], ["upper-D6"], ["upper-A5"], ["upper-F#5"], ["upper-E5"], ["upper-F#5"], ["upper-A5"]]),
  measure(["lower-A2", "lower-E3"], [["upper-E5"], ["upper-A5"], ["upper-C#6"], ["upper-A5"], ["upper-E5"], ["upper-D5"], ["upper-E5"], ["upper-A5"]]),
  measure(["lower-B2", "lower-F#3"], [["upper-F#5"], ["upper-B5"], ["upper-D6"], ["upper-B5"], ["upper-F#5"], ["upper-E5"], ["upper-F#5"], ["upper-B5"]]),
  measure(["lower-F#2", "lower-C#3"], [["upper-F#5"], ["upper-A5"], ["upper-C#6"], ["upper-A5"], ["upper-F#5"], ["upper-E5"], ["upper-F#5"], ["upper-A5"]]),
  measure(["lower-G2", "lower-D3"], [["upper-G5"], ["upper-B5"], ["upper-D6"], ["upper-B5"], ["upper-G5"], ["upper-F#5"], ["upper-G5"], ["upper-B5"]]),
  measure(["lower-D2", "lower-A2"], [["upper-F#5"], ["upper-A5"], ["upper-D6"], ["upper-A5"], ["upper-F#5"], ["upper-E5"], ["upper-D5"], ["upper-F#5"]]),
  measure(["lower-G2", "lower-D3"], [["upper-G5"], ["upper-B5"], ["upper-D6"], ["upper-B5"], ["upper-G5"], ["upper-F#5"], ["upper-E5"], ["upper-D5"]]),
  measure(["lower-A2", "lower-E3"], [["upper-E5"], ["upper-A5"], ["upper-C#6"], ["upper-B5"], ["upper-A5"], ["upper-G5"], ["upper-E5"], ["upper-C#5"]]),
];

const VARIATION_B = [
  measure(["lower-D2", "lower-A2"], [["upper-D5", "upper-F#5"], ["upper-A5"], ["upper-D6"], ["upper-A5"], ["upper-F#5"], ["upper-E5"], ["upper-F#5"], ["upper-A5"]]),
  measure(["lower-A2", "lower-E3"], [["upper-C#5", "upper-E5"], ["upper-A5"], ["upper-C#6"], ["upper-A5"], ["upper-E5"], ["upper-D5"], ["upper-E5"], ["upper-A5"]]),
  measure(["lower-B2", "lower-F#3"], [["upper-D5", "upper-F#5"], ["upper-B5"], ["upper-D6"], ["upper-B5"], ["upper-F#5"], ["upper-E5"], ["upper-F#5"], ["upper-B5"]]),
  measure(["lower-F#2", "lower-C#3"], [["upper-C#5", "upper-F#5"], ["upper-A5"], ["upper-C#6"], ["upper-A5"], ["upper-F#5"], ["upper-E5"], ["upper-F#5"], ["upper-A5"]]),
  measure(["lower-G2", "lower-D3"], [["upper-D5", "upper-G5"], ["upper-B5"], ["upper-D6"], ["upper-B5"], ["upper-G5"], ["upper-F#5"], ["upper-G5"], ["upper-B5"]]),
  measure(["lower-D2", "lower-A2"], [["upper-D5", "upper-F#5"], ["upper-A5"], ["upper-D6"], ["upper-A5"], ["upper-F#5"], ["upper-E5"], ["upper-D5"], ["upper-F#5"]]),
  measure(["lower-G2", "lower-D3"], [["upper-D5", "upper-G5"], ["upper-B5"], ["upper-D6"], ["upper-A5"], ["upper-G5"], ["upper-F#5"], ["upper-E5"], ["upper-D5"]]),
  measure(["lower-A2", "lower-E3"], [["upper-C#5", "upper-E5"], ["upper-A5"], ["upper-C#6"], ["upper-B5"], ["upper-A5"], ["upper-G5"], ["upper-E5"], ["upper-C#5"]]),
];

const VARIATION_C = [
  measure(["lower-D2", "lower-A2"], [["upper-D5", "upper-F#5"], ["upper-A5", "upper-D6"], ["upper-F#6"], ["upper-D6"], ["upper-A5"], ["upper-F#5"], ["upper-E5"], ["upper-D5", "upper-A5"]]),
  measure(["lower-A2", "lower-E3"], [["upper-C#5", "upper-E5"], ["upper-A5", "upper-C#6"], ["upper-E6"], ["upper-C#6"], ["upper-A5"], ["upper-E5"], ["upper-D5"], ["upper-C#5", "upper-A5"]]),
  measure(["lower-B2", "lower-F#3"], [["upper-D5", "upper-F#5"], ["upper-B5", "upper-D6"], ["upper-F#6"], ["upper-D6"], ["upper-B5"], ["upper-F#5"], ["upper-E5"], ["upper-D5", "upper-B5"]]),
  measure(["lower-F#2", "lower-C#3"], [["upper-C#5", "upper-F#5"], ["upper-A5", "upper-C#6"], ["upper-F#6"], ["upper-C#6"], ["upper-A5"], ["upper-F#5"], ["upper-E5"], ["upper-C#5", "upper-A5"]]),
  measure(["lower-G2", "lower-D3"], [["upper-D5", "upper-G5"], ["upper-B5", "upper-D6"], ["upper-G6"], ["upper-D6"], ["upper-B5"], ["upper-G5"], ["upper-F#5"], ["upper-D5", "upper-B5"]]),
  measure(["lower-D2", "lower-A2"], [["upper-D5", "upper-F#5"], ["upper-A5", "upper-D6"], ["upper-F#6"], ["upper-D6"], ["upper-A5"], ["upper-F#5"], ["upper-E5"], ["upper-D5", "upper-F#6"]]),
  measure(["lower-G2", "lower-D3"], [["upper-D5", "upper-G5"], ["upper-B5", "upper-D6"], ["upper-G6"], ["upper-D6"], ["upper-B5"], ["upper-G5"], ["upper-F#5"], ["upper-E5", "upper-G5"]]),
  measure(["lower-A2", "lower-E3"], [["upper-C#5", "upper-E5"], ["upper-A5", "upper-C#6"], ["upper-E6"], ["upper-C#6"], ["upper-B5"], ["upper-A5"], ["upper-G5"], ["upper-E5", "upper-C#6"]]),
];

const VARIATION_D = [
  measure(["lower-D2", "lower-A2", "lower-D3"], [["upper-D5", "upper-F#5"], ["upper-A5", "upper-D6"], ["upper-F#6", "upper-A6"], ["upper-D6", "upper-F#6"], ["upper-A5", "upper-D6"], ["upper-F#6", "upper-A6"], ["upper-D6", "upper-F#6"], ["upper-A5", "upper-D6"]]),
  measure(["lower-A2", "lower-E3", "lower-A3"], [["upper-C#5", "upper-E5"], ["upper-A5", "upper-C#6"], ["upper-E6", "upper-A6"], ["upper-C#6", "upper-E6"], ["upper-A5", "upper-C#6"], ["upper-E6", "upper-A6"], ["upper-C#6", "upper-E6"], ["upper-A5", "upper-C#6"]]),
  measure(["lower-B2", "lower-F#3", "lower-B3"], [["upper-D5", "upper-F#5"], ["upper-B5", "upper-D6"], ["upper-F#6", "upper-B6"], ["upper-D6", "upper-F#6"], ["upper-B5", "upper-D6"], ["upper-F#6", "upper-B6"], ["upper-D6", "upper-F#6"], ["upper-B5", "upper-D6"]]),
  measure(["lower-F#2", "lower-C#3", "lower-F#3"], [["upper-C#5", "upper-F#5"], ["upper-A5", "upper-C#6"], ["upper-F#6", "upper-A6"], ["upper-C#6", "upper-F#6"], ["upper-A5", "upper-C#6"], ["upper-F#6", "upper-A6"], ["upper-C#6", "upper-F#6"], ["upper-A5", "upper-C#6"]]),
  measure(["lower-G2", "lower-D3", "lower-G3"], [["upper-D5", "upper-G5"], ["upper-B5", "upper-D6"], ["upper-G6", "upper-B6"], ["upper-D6", "upper-G6"], ["upper-B5", "upper-D6"], ["upper-G6", "upper-B6"], ["upper-D6", "upper-G6"], ["upper-B5", "upper-D6"]]),
  measure(["lower-D2", "lower-A2", "lower-D3"], [["upper-D5", "upper-F#5"], ["upper-A5", "upper-D6"], ["upper-F#6", "upper-A6"], ["upper-D6", "upper-F#6"], ["upper-A5", "upper-D6"], ["upper-F#6", "upper-A6"], ["upper-E6", "upper-F#6"], ["upper-D6", "upper-A6"]]),
  measure(["lower-G2", "lower-D3", "lower-G3"], [["upper-D5", "upper-G5"], ["upper-B5", "upper-D6"], ["upper-G6", "upper-B6"], ["upper-D6", "upper-G6"], ["upper-B5", "upper-D6"], ["upper-A5", "upper-D6"], ["upper-G5", "upper-B5"], ["upper-F#5", "upper-A5"]]),
  measure(["lower-A2", "lower-E3", "lower-A3"], [["upper-C#5", "upper-E5"], ["upper-A5", "upper-C#6"], ["upper-E6", "upper-A6"], ["upper-C#6", "upper-E6"], ["upper-B5", "upper-D6"], ["upper-A5", "upper-C#6"], ["upper-G5", "upper-B5"], ["upper-E5", "upper-A5", "upper-C#6"]]),
];

const CODA = [
  measure(
    ["lower-G2", "lower-D3", "lower-G3"],
    [["upper-D5", "upper-G5"], ["upper-B5", "upper-D6"], ["upper-G6"], ["upper-D6"], ["upper-B5"], ["upper-G5"], ["upper-F#5"], ["upper-E5", "upper-G5"]],
    { noteValueMs: 304, overlapMs: 118, leftReleaseDelayMs: 32, pedalReleaseDelayMs: 40 },
  ),
  measure(
    ["lower-A2", "lower-E3", "lower-A3"],
    [["upper-C#5", "upper-E5"], ["upper-A5", "upper-C#6"], ["upper-E6"], ["upper-C#6"], ["upper-B5"], ["upper-A5"], ["upper-G5"], ["upper-E5", "upper-C#6"]],
    { noteValueMs: 324, overlapMs: 126, leftReleaseDelayMs: 38, pedalReleaseDelayMs: 52 },
  ),
  measure(
    ["lower-A2", "lower-E3", "lower-A3"],
    [["upper-E5", "upper-A5"], ["upper-G5", "upper-B5"], ["upper-A5", "upper-C#6"], ["upper-B5", "upper-D6"], ["upper-A5", "upper-C#6"], ["upper-G5", "upper-B5"], ["upper-F#5", "upper-A5"], ["upper-E5", "upper-G5"]],
    { noteValueMs: 352, overlapMs: 136, leftReleaseDelayMs: 56, pedalReleaseDelayMs: 140 },
  ),
  measure(
    ["lower-D2", "lower-A2", "lower-D3"],
    [["upper-D5", "upper-F#5"], ["upper-A5", "upper-D6"], ["upper-F#6", "upper-A6"], ["upper-E6", "upper-A6"], ["upper-D6", "upper-F#6"], ["upper-A5", "upper-D6"], ["upper-F#5", "upper-A5"]],
    { noteValueMs: 408, overlapMs: 148, leftReleaseDelayMs: 180, pedalReleaseDelayMs: 60 },
  ),
  measure(
    ["lower-D2", "lower-A2", "lower-D3"],
    [["upper-D5", "upper-F#5", "upper-A5", "upper-D6", "upper-F#6", "upper-A6"]],
    { noteValueMs: 4000, firstRightDelayMs: 4000, leftReleaseDelayMs: 1600, pedalReleaseDelayMs: 120 },
  ),
];

function buildSteps() {
  const sections = [
    ...VARIATION_A,
    ...VARIATION_A,
    ...VARIATION_B,
    ...VARIATION_A,
    ...VARIATION_C,
    ...VARIATION_B,
    ...VARIATION_D,
    ...CODA,
  ];
  const steps = [];
  const pedalSelector = `[data-testid="piano-sustain-pedal"]`;

  function pushChordDown(noteIds, delayAfterLast = 0) {
    for (const noteId of noteIds) {
      steps.push({ type: "mousedown", selector: keySelector(noteId) });
    }
    if (delayAfterLast > 0 && steps.length > 0) {
      steps[steps.length - 1].postActionDelayMs = delayAfterLast;
    }
  }

  function pushChordUp(noteIds, delayAfterLast = 0) {
    for (const noteId of noteIds) {
      steps.push({ type: "mouseup", selector: keySelector(noteId) });
    }
    if (delayAfterLast > 0 && steps.length > 0) {
      steps[steps.length - 1].postActionDelayMs = delayAfterLast;
    }
  }

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const noteValueMs = section.noteValueMs ?? EIGHTH_MS;
    const overlapMs = Math.max(24, Math.min(section.overlapMs ?? LEGATO_OVERLAP_MS, noteValueMs - 24));
    const firstRightDelayMs = section.firstRightDelayMs ?? noteValueMs;
    const nextRightDelayMs = section.nextRightDelayMs ?? noteValueMs;
    const pedalDownDelayMs = section.pedalDownDelayMs ?? 18;
    const leftDownDelayMs = section.leftDownDelayMs ?? 28;
    const leftReleaseDelayMs = section.leftReleaseDelayMs ?? 20;
    const pedalReleaseDelayMs = section.pedalReleaseDelayMs ?? 24;

    steps.push({ type: "mousedown", selector: pedalSelector, postActionDelayMs: pedalDownDelayMs });
    pushChordDown(section.left, leftDownDelayMs);

    let previousRightEvent = null;
    for (const event of section.right) {
      if (!previousRightEvent) {
        pushChordDown(event, firstRightDelayMs);
        previousRightEvent = event;
        continue;
      }

      pushChordDown(event, overlapMs);
      pushChordUp(previousRightEvent, nextRightDelayMs - overlapMs);
      previousRightEvent = event;
    }

    if (previousRightEvent) {
      pushChordUp(previousRightEvent, 0);
    }

    pushChordUp(section.left, leftReleaseDelayMs);
    steps.push({ type: "mouseup", selector: pedalSelector, postActionDelayMs: pedalReleaseDelayMs });
  }

  return { sections, steps };
}

function main() {
  const outputPath = resolve(process.argv[2] || "/tmp/kuma-canon-variation-1min.json");
  const { sections, steps } = buildSteps();
  const totalMs = steps.reduce((sum, step) => sum + (step.postActionDelayMs || 0), 0);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        meta: {
          title: "Kuma Canon Variation in D",
          durationMs: totalMs,
          durationSec: totalMs / 1000,
          noteValueMs: EIGHTH_MS,
          measureCount: sections.length,
          arrangement: "lyrical solo-piano canon inspired by modern concert arrangements",
        },
        steps,
      },
      null,
      2,
    ),
  );

  process.stdout.write(
    `${JSON.stringify({ outputPath, stepCount: steps.length, durationMs: totalMs, durationSec: totalMs / 1000 }, null, 2)}\n`,
  );
}

main();
