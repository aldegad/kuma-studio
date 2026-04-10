import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, assert, describe, it } from "vitest";

import { createStudioMemoRouteHandler } from "./studio-memo-routes.mjs";

function createRequest(method, url, body) {
  const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf8");
  const req = new Readable({
    read() {
      if (payload) {
        this.push(payload);
      }
      this.push(null);
    },
  });

  req.method = method;
  req.url = url;
  req.headers = { host: "localhost:4312" };
  return req;
}

function createResponse() {
  const state = {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
  };

  return {
    writeHead(statusCode, headers) {
      state.statusCode = statusCode;
      state.headers = headers;
    },
    end(body) {
      state.body = body ? Buffer.from(body) : Buffer.alloc(0);
    },
    get statusCode() {
      return state.statusCode;
    },
    get headers() {
      return state.headers;
    },
    get text() {
      return state.body.toString("utf8");
    },
    get json() {
      return state.body.length > 0 ? JSON.parse(state.body.toString("utf8")) : null;
    },
  };
}

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("studio memo routes", () => {
  it("uses addInbox for /studio/vault/inbox", async () => {
    const calls = [];
    const handler = createStudioMemoRouteHandler({
      memoStore: {
        async addInbox(input) {
          calls.push({ type: "addInbox", input });
          return {
            id: "inbox/test.md",
            path: "inbox/test.md",
            title: input.title,
            text: input.text,
            images: [],
            createdAt: "2026-04-07T00:00:00.000Z",
            source: "vault",
            section: "inbox",
          };
        },
      },
    });

    const url = new URL("http://localhost:4312/studio/vault/inbox");
    const res = createResponse();
    await handler(
      createRequest("POST", "/studio/vault/inbox", {
        title: "원문",
        text: "raw payload",
      }),
      res,
      url,
    );

    assert.strictEqual(res.statusCode, 201);
    assert.deepStrictEqual(calls, [{
      type: "addInbox",
      input: {
        title: "원문",
        text: "raw payload",
      },
    }]);
    assert.strictEqual(res.json.section, "inbox");
  });

  it("serves memo images through the memo handler", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-memo-routes-"));
    tempDirs.push(root);

    const imagesDir = join(root, "images");
    await mkdir(imagesDir, { recursive: true });
    const imagePath = join(imagesDir, "sample.png");
    await writeFile(imagePath, "png-bytes", "utf8");

    const handler = createStudioMemoRouteHandler({
      memoStore: {
        findImagePath(filename) {
          return filename === "sample.png" ? imagePath : null;
        },
        getImagesDir() {
          return imagesDir;
        },
      },
    });

    const url = new URL("http://localhost:4312/studio/memo-images/sample.png");
    const res = createResponse();
    await handler(createRequest("GET", "/studio/memo-images/sample.png"), res, url);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers["Content-Type"], "image/png");
    assert.strictEqual(res.text, "png-bytes");
  });
});
