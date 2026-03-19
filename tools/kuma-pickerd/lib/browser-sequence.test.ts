import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeBrowserSequenceDefinition, readBrowserSequenceSteps } from "./browser-sequence.mjs";

describe("browser sequence parsing", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes inline sequence steps and assertions", () => {
    const steps = normalizeBrowserSequenceDefinition([
      {
        type: "click",
        text: "File",
        assert: {
          type: "wait-for-selector",
          selector: "[role='menu']",
          timeoutMs: 1_200,
        },
      },
    ]);

    expect(steps).toEqual([
      {
        type: "click",
        text: "File",
        assertions: [
          {
            type: "wait-for-selector",
            selector: "[role='menu']",
            timeoutMs: 1_200,
          },
        ],
      },
    ]);
  });

  it("reads a sequence from a file option", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kuma-pickerd-sequence-"));
    tempRoots.push(root);
    const file = path.join(root, "sequence.json");
    writeFileSync(
      file,
      JSON.stringify({
        steps: [
          {
            type: "click",
            text: "Export",
          },
        ],
      }),
    );

    const steps = readBrowserSequenceSteps({ "steps-file": file });
    expect(steps).toEqual([{ type: "click", text: "Export" }]);
  });

  it("rejects unsupported assertion types", () => {
    expect(() =>
      normalizeBrowserSequenceDefinition([
        {
          type: "click",
          text: "File",
          assert: {
            type: "click",
            text: "Nested",
          },
        },
      ]),
    ).toThrow(/unsupported type "click"/i);
  });
});
