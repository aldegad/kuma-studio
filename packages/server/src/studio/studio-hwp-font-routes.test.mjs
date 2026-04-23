import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStudioHwpFontRouteHandler } from "./studio-hwp-font-routes.mjs";

class FakeResponse {
  statusCode = 0;
  headers = {};
  body = Buffer.alloc(0);

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  end(body = Buffer.alloc(0)) {
    this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  }
}

function createRequest(method = "GET") {
  return { method };
}

async function invoke(handler, path, method = "GET") {
  const response = new FakeResponse();
  const handled = await handler(createRequest(method), response, new URL(path, "http://localhost"));
  return { handled, response };
}

describe("studio HWP font routes", () => {
  let sandbox;
  let fontDir;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "kuma-hwp-font-route-"));
    fontDir = join(sandbox, "fonts");
    await mkdir(fontDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("lists installed runtime font files", async () => {
    await writeFile(join(fontDir, "HANBatang.ttf"), Buffer.from("font"));
    await writeFile(join(fontDir, "notes.txt"), Buffer.from("skip"));
    const handler = createStudioHwpFontRouteHandler({ fontDir });

    const { handled, response } = await invoke(handler, "/studio/hwp-fonts");

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body.toString("utf8")).files).toEqual([
      {
        name: "HANBatang.ttf",
        size: 4,
        url: "/studio/hwp-fonts/HANBatang.ttf",
      },
    ]);
  });

  it("serves a single installed font file", async () => {
    await writeFile(join(fontDir, "HANBatang.ttf"), Buffer.from("font-bytes"));
    const handler = createStudioHwpFontRouteHandler({ fontDir });

    const { handled, response } = await invoke(handler, "/studio/hwp-fonts/HANBatang.ttf");

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("font/ttf");
    expect(response.body.toString("utf8")).toBe("font-bytes");
  });

  it("rejects traversal-like font paths", async () => {
    const handler = createStudioHwpFontRouteHandler({ fontDir });

    const { handled, response } = await invoke(handler, "/studio/hwp-fonts/..%2Fsecret.ttf");

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(400);
  });
});
