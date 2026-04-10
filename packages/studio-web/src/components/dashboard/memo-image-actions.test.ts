import { describe, expect, it, vi } from "vitest";
import { buildMemoImageFilename, copyMemoImageToClipboard, downloadMemoImage } from "./memo-image-actions";

describe("memo image actions", () => {
  it("builds a file name from the memo image url", () => {
    expect(buildMemoImageFilename("/studio/memo-images/euler_a-s4-cfg1.5.png?cache=1", "Bench Memo"))
      .toBe("euler_a-s4-cfg1.5.png");
  });

  it("downloads a fetched memo image blob with a stable filename", async () => {
    const blob = new Blob(["image-bytes"], { type: "image/png" });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => blob,
    });
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      rel: "",
      click,
    };
    const createObjectUrl = vi.fn().mockReturnValue("blob:memo-image");
    const revokeObjectUrl = vi.fn();

    await expect(downloadMemoImage("/studio/memo-images/hyper-warm.png", "Warmup Memo", {
      fetchImpl,
      createObjectUrl,
      revokeObjectUrl,
      createAnchor: () => anchor,
    })).resolves.toBe("hyper-warm.png");

    expect(fetchImpl).toHaveBeenCalledWith("/studio/memo-images/hyper-warm.png");
    expect(anchor.href).toBe("blob:memo-image");
    expect(anchor.download).toBe("hyper-warm.png");
    expect(anchor.rel).toBe("noopener");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:memo-image");
  });

  it("copies a memo image blob to the clipboard as an image payload", async () => {
    const blob = new Blob(["clipboard-image"]);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => blob,
    });
    const write = vi.fn().mockResolvedValue(undefined);

    class ClipboardItemMock {
      items: Record<string, Blob>;

      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    }

    await expect(copyMemoImageToClipboard("/studio/memo-images/lightning-warm.png", {
      fetchImpl,
      clipboard: { write },
      clipboardItemCtor: ClipboardItemMock as unknown as typeof ClipboardItem,
    })).resolves.toBe("image/png");

    expect(fetchImpl).toHaveBeenCalledWith("/studio/memo-images/lightning-warm.png");
    expect(write).toHaveBeenCalledTimes(1);

    const clipboardItem = write.mock.calls[0]?.[0]?.[0] as ClipboardItemMock;
    expect(clipboardItem).toBeInstanceOf(ClipboardItemMock);
    expect(Object.keys(clipboardItem.items)).toEqual(["image/png"]);
  });
});
