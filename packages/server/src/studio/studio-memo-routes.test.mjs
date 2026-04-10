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
  it("lists, creates, and updates vault-backed thread documents", async () => {
    const root = await mkdtemp(join(tmpdir(), "kuma-studio-thread-docs-"));
    tempDirs.push(root);

    const handler = createStudioMemoRouteHandler({
      threadsContentRoot: root,
    });

    const initialListRes = createResponse();
    await handler(
      createRequest("GET", "/studio/vault/threads-content"),
      initialListRes,
      new URL("http://localhost:4312/studio/vault/threads-content"),
    );

    assert.strictEqual(initialListRes.statusCode, 200);
    assert.strictEqual(initialListRes.json.directory, root);
    assert.deepStrictEqual(initialListRes.json.items, []);

    const createRes = createResponse();
    await handler(
      createRequest("POST", "/studio/vault/threads-content", {
        title: "첫 스레드",
        body: "첫 줄\n둘째 줄",
        status: "draft",
      }),
      createRes,
      new URL("http://localhost:4312/studio/vault/threads-content"),
    );

    assert.strictEqual(createRes.statusCode, 201);
    assert.strictEqual(createRes.json.title, "첫 스레드");
    assert.strictEqual(createRes.json.status, "draft");
    assert.strictEqual(createRes.json.body, "첫 줄\n둘째 줄");

    const patchRes = createResponse();
    await handler(
      createRequest("PATCH", `/studio/vault/threads-content/${encodeURIComponent(createRes.json.id)}`, {
        title: "수정된 스레드",
        body: "본문 수정",
        status: "approved",
      }),
      patchRes,
      new URL(`http://localhost:4312/studio/vault/threads-content/${encodeURIComponent(createRes.json.id)}`),
    );

    assert.strictEqual(patchRes.statusCode, 200);
    assert.strictEqual(patchRes.json.title, "수정된 스레드");
    assert.strictEqual(patchRes.json.status, "approved");
    assert.strictEqual(patchRes.json.body, "본문 수정");

    const listRes = createResponse();
    await handler(
      createRequest("GET", "/studio/vault/threads-content"),
      listRes,
      new URL("http://localhost:4312/studio/vault/threads-content"),
    );

    assert.strictEqual(listRes.statusCode, 200);
    assert.strictEqual(listRes.json.items.length, 1);
    assert.strictEqual(listRes.json.items[0].id, createRes.json.id);
    assert.strictEqual(listRes.json.items[0].fileName, `${createRes.json.id}.md`);
  });

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
