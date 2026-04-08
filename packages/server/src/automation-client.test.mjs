import { assert, describe, it } from "vitest";

import { formatAutomationErrorMessage, readTargetOptions, requireTarget } from "./automation-client.mjs";

describe("automation-client", () => {
  it("accepts --tab-index as a browser target", () => {
    const target = readTargetOptions({
      "tab-index": "2",
    });

    assert.deepEqual(target, {
      targetTabId: null,
      targetTabIndex: 2,
      targetUrl: null,
      targetUrlContains: null,
    });
    assert.deepEqual(requireTarget({ "tab-index": "2" }), target);
  });

  it("rejects invalid --tab-index values", () => {
    assert.throws(() => readTargetOptions({ "tab-index": "0" }), /--tab-index must be a positive integer\./u);
  });

  it("formats missing browser connection errors in Korean", () => {
    const message = formatAutomationErrorMessage("No active browser connection is available.");
    assert.match(message, /브라우저가 실행 중이 아니거나 Kuma Picker가 연결되지 않았습니다/u);
    assert.match(message, /No active browser connection is available\./u);
  });

  it("formats missing matching tab errors with the requested URL", () => {
    const message = formatAutomationErrorMessage("No browser tab matches the requested URL fragment: localhost:5173");
    assert.match(message, /URL 'localhost:5173'에 해당하는 탭이 없습니다\. 열어주세요\./u);
    assert.match(message, /No browser tab matches the requested URL fragment: localhost:5173/u);
  });
});
