import { describe, expect, it } from "vitest";

import { detectDecision } from "./decision-detector.mjs";

describe("decision-detector", () => {
  it.each([
    ["ㄱㄱ", "approve"],
    ["좋아", "approve"],
    ["이걸로 가", "approve"],
    ["이 방향으로 확정", "approve"],
    ["ㄴㄴ", "reject"],
    ["그건 말고", "reject"],
    ["하지 마", "reject"],
    ["보류", "hold"],
    ["나중에", "hold"],
    ["이거 먼저", "priority"],
    ["A 보다 B 먼저", "priority"],
    ["앞으로 이렇게", "preference"],
    ["다음부터 이렇게", "preference"],
  ])("detects %s as %s", (text, action) => {
    expect(detectDecision({ text })).toMatchObject({
      matched: true,
      action,
      original_text: text,
    });
  });

  it.each([
    "아",
    "오",
    "ㅋ",
    "응",
    "이거 하지 말까?",
    "보류할까?",
    "이 함수를 호출한 다음 가자",
    "이거 먼저 볼까",
    "좋아?",
    "다음부터 이렇게 할까",
  ])("filters anti-pattern or question text: %s", (text) => {
    expect(detectDecision({ text })).toBeNull();
  });

  it("allows longer explicit responses only when preceding context expects a decision", () => {
    const longText = "이 방향으로 가자 그리고 나머지 세부 구현은 다음 단계에서 맞추자 이건 우선순위를 지금 바로 바꾸는 결정으로 남겨";
    expect(detectDecision({ text: longText })).toBeNull();
    expect(detectDecision({
      text: longText,
      precedingContext: { awaitingDecision: true },
    })).toMatchObject({
      matched: true,
      action: "approve",
    });
  });
});
