import { describe, it, assert } from "vitest";
import { computeProjectHash, resolveProjectStateDir, resolveKumaPickerStateDir } from "./state-home.mjs";

describe("state-home", () => {
  it("computeProjectHash returns 12-char hex", () => {
    const hash = computeProjectHash("/tmp/test-project");
    assert.match(hash, /^[a-f0-9]{12}$/);
  });

  it("same path produces same hash", () => {
    const a = computeProjectHash("/tmp/test-project");
    const b = computeProjectHash("/tmp/test-project");
    assert.strictEqual(a, b);
  });

  it("different paths produce different hashes", () => {
    const a = computeProjectHash("/tmp/project-a");
    const b = computeProjectHash("/tmp/project-b");
    assert.notStrictEqual(a, b);
  });

  it("resolveProjectStateDir includes projects subdirectory", () => {
    const dir = resolveProjectStateDir("/tmp/test-project");
    assert.include(dir, "projects/");
  });

  it("resolveKumaPickerStateDir returns a string", () => {
    const dir = resolveKumaPickerStateDir();
    assert.typeOf(dir, "string");
    assert.isAbove(dir.length, 0);
  });
});
