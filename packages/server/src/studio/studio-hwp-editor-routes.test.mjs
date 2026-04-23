import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStudioHwpEditorRouteHandler } from "./studio-hwp-editor-routes.mjs";

class FakeResponse {
  statusCode = 0;
  headers = {};
  body = Buffer.alloc(0);

  writeHead(statusCode, headers = {}) {
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
  const handled = await handler(createRequest(method), response, new URL(path, "http://localhost:4312"));
  return { handled, response };
}

describe("studio HWP editor routes", () => {
  let sandbox;
  let editorDir;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "kuma-hwp-editor-route-"));
    editorDir = join(sandbox, "rhwp-editor");
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("reports missing editor assets explicitly", async () => {
    const handler = createStudioHwpEditorRouteHandler({ editorDir });

    const { handled, response } = await invoke(handler, "/studio/hwp-editor-status");

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body.toString("utf8"))).toEqual({
      installed: false,
      editorDir,
      url: "/studio/hwp-editor/",
    });
  });

  it("serves the installed editor index and wasm asset", async () => {
    await mkdir(join(editorDir, "assets"), { recursive: true });
    await writeFile(join(editorDir, "index.html"), "<html>rhwp editor</html>", "utf8");
    await writeFile(join(editorDir, "assets", "rhwp_bg.wasm"), Buffer.from([0, 97, 115, 109]));
    const handler = createStudioHwpEditorRouteHandler({ editorDir });

    const index = await invoke(handler, "/studio/hwp-editor/");
    expect(index.handled).toBe(true);
    expect(index.response.statusCode).toBe(200);
    expect(index.response.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(index.response.body.toString("utf8")).toContain("rhwp editor");

    const wasm = await invoke(handler, "/studio/hwp-editor/assets/rhwp_bg.wasm");
    expect(wasm.handled).toBe(true);
    expect(wasm.response.statusCode).toBe(200);
    expect(wasm.response.headers["Content-Type"]).toBe("application/wasm");
    expect([...wasm.response.body]).toEqual([0, 97, 115, 109]);
  });

  it("falls back to editor index for client-side routes", async () => {
    await mkdir(editorDir, { recursive: true });
    await writeFile(join(editorDir, "index.html"), "<html>spa shell</html>", "utf8");
    const handler = createStudioHwpEditorRouteHandler({ editorDir });

    const { handled, response } = await invoke(handler, "/studio/hwp-editor/document/123");

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.body.toString("utf8")).toContain("spa shell");
  });

  it("rejects traversal-like asset paths", async () => {
    await mkdir(editorDir, { recursive: true });
    await writeFile(join(editorDir, "index.html"), "<html>spa shell</html>", "utf8");
    const handler = createStudioHwpEditorRouteHandler({ editorDir });

    const { handled, response } = await invoke(handler, "/studio/hwp-editor/..%2Fsecret.txt");

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(403);
  });
});
