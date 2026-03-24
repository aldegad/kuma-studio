import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const EIGHTH_MS = 289;
const NOTE_MS = 219;
const GAP_MS = EIGHTH_MS - NOTE_MS;
const LEGATO_OVERLAP_MS = 110;

function keySelector(keyId) {
  return `[data-piano-key-id="${keyId}"]`;
}

function measure(left, right) {
  return { left, right };
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

const FINAL_CADENCE = [measure(["lower-D2", "lower-A2", "lower-D3"], [["upper-D5", "upper-F#5"], ["upper-A5", "upper-D6"], ["upper-F#6", "upper-A6"], ["upper-D6", "upper-F#6"], ["upper-A5", "upper-D6"], ["upper-F#5", "upper-A5"], ["upper-D5", "upper-F#5"], ["upper-D6", "upper-A6"]])];

function buildSteps() {
  const sections = [...VARIATION_A, ...VARIATION_B, ...VARIATION_C, ...FINAL_CADENCE];
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

  for (const section of sections) {
    steps.push({ type: "mousedown", selector: pedalSelector, postActionDelayMs: 18 });
    pushChordDown(section.left, 28);

    let previousRightEvent = null;
    for (const event of section.right) {
      if (!previousRightEvent) {
        pushChordDown(event, EIGHTH_MS);
        previousRightEvent = event;
        continue;
      }

      pushChordDown(event, LEGATO_OVERLAP_MS);
      pushChordUp(previousRightEvent, EIGHTH_MS - LEGATO_OVERLAP_MS);
      previousRightEvent = event;
    }

    if (previousRightEvent) {
      pushChordUp(previousRightEvent, 0);
    }

    pushChordUp(section.left, 20);
    steps.push({ type: "mouseup", selector: pedalSelector, postActionDelayMs: 24 });
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
