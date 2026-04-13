import { describe, expect, it } from "vitest";

import { resolveDecisionCaptureScope } from "./decision-scope.mjs";

describe("decision-scope", () => {
  it("routes system-prompt and invariant language to global scope", () => {
    expect(resolveDecisionCaptureScope({
      text: "SSOT, SRP 같은 원칙은 앞으로도 유지해.",
      projectName: "kuma-studio",
    })).toBe("global");

    expect(resolveDecisionCaptureScope({
      text: "내 말투랑 보고체계는 시스템 프롬프트에 계속 넣어.",
      projectName: "kuma-studio",
    })).toBe("global");
  });

  it("defaults project work language to the current project scope", () => {
    expect(resolveDecisionCaptureScope({
      text: "이거 먼저 처리",
      projectName: "kuma-studio",
    })).toBe("project:kuma-studio");
  });

  it("falls back to global when there is no project context", () => {
    expect(resolveDecisionCaptureScope({
      text: "앞으로 branch/worktree 는 승인 후에만 만든다.",
      projectName: "",
    })).toBe("global");
  });
});
