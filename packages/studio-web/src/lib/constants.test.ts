import { describe, expect, it } from "vitest";

import { formatModelName } from "./constants";

describe("constants", () => {
  it("formats GPT-5 model variants distinctly", () => {
    expect(formatModelName("gpt-5.4")).toBe("GPT-5.4");
    expect(formatModelName("gpt-5.4-mini")).toBe("GPT-5.4 mini");
    expect(formatModelName("gpt-5.4-mini-low")).toBe("GPT-5.4 mini");
    expect(formatModelName("gpt-5.4-nano")).toBe("GPT-5.4 nano");
  });
});
