import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemoImageLightbox } from "./MemoImageLightbox";

describe("MemoImageLightbox", () => {
  it("renders download and clipboard actions when an image is selected", () => {
    const html = renderToStaticMarkup(
      createElement(MemoImageLightbox, {
        imageUrl: "/studio/memo-images/kooma-art.png",
        imageLabel: "수쿠마 아트워크",
        fileName: "kooma-art.png",
        actionMessage: "이미지를 클립보드에 복사했습니다.",
        busyAction: null,
        onDownload: vi.fn(),
        onCopy: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(html).toContain("메모 이미지 팝업");
    expect(html).toContain("다운로드");
    expect(html).toContain("클립보드 복사");
    expect(html).toContain("메모 이미지 팝업 닫기");
    expect(html).toContain("수쿠마 아트워크");
    expect(html).toContain("/studio/memo-images/kooma-art.png");
  });

  it("renders nothing when the lightbox is closed", () => {
    const html = renderToStaticMarkup(
      createElement(MemoImageLightbox, {
        imageUrl: null,
        imageLabel: "",
        fileName: "",
        actionMessage: null,
        busyAction: null,
        onDownload: vi.fn(),
        onCopy: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(html).toBe("");
  });
});
