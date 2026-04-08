import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { maybeAutoIngestResult } from "./vault-auto-ingest.mjs";

describe("vault-auto-ingest", () => {
  it("ingests a QA-tracked result once and skips duplicates via stamp files", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-auto-ingest-"));
    const vaultDir = join(tempRoot, "vault");
    const taskDir = join(tempRoot, "tasks");
    const resultDir = join(tempRoot, "results");
    const stampDir = join(tempRoot, "stamps");

    await mkdir(join(vaultDir, "projects"), { recursive: true });
    await mkdir(taskDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });

    await writeFile(
      join(vaultDir, "projects", "kuma-studio.md"),
      `---
title: kuma-studio 프로젝트 지식
domain: projects
tags: [studio]
created: 2026-04-07
updated: 2026-04-07
sources: []
---

## Summary
쿠마 스튜디오 프로젝트 누적 지식.

## Details
(작업 결과 ingest 시 자동 누적)

## Related
(교차참조 추가 예정)
`,
      "utf8",
    );

    const resultPath = join(resultDir, "qa-auto-ingest.result.md");
    await writeFile(
      resultPath,
      `---
task: qa-auto-ingest
worker: surface:4
status: done
qa: surface:7
---

# QA auto ingest 연결

## 변경 사항
- wait hook에서 auto ingest 실행
`,
      "utf8",
    );

    await writeFile(
      join(taskDir, "qa-auto-ingest.task.md"),
      `---
id: qa-auto-ingest
project: kuma-studio
worker: surface:4
qa: surface:7
signal: kuma-studio-qa-auto-ingest-done
result: ${resultPath}
---
`,
      "utf8",
    );

    const first = await maybeAutoIngestResult({
      resultPath,
      signal: "kuma-studio-qa-auto-ingest-done",
      taskDir,
      stampDir,
      vaultDir,
    });

    expect(first.status).toBe("ingested");
    expect(first.ingest.relativePagePath).toBe("projects/kuma-studio.md");
    expect(existsSync(first.stampPath)).toBe(true);

    const pageContent = await readFile(join(vaultDir, "projects", "kuma-studio.md"), "utf8");
    expect(pageContent).toContain("QA auto ingest 연결");
    expect(pageContent).toContain("<!-- ingest:qa-auto-ingest.result.md:start -->");

    const second = await maybeAutoIngestResult({
      resultPath,
      signal: "kuma-studio-qa-auto-ingest-done",
      taskDir,
      stampDir,
      vaultDir,
    });

    expect(second.status).toBe("skipped");
    expect(second.reason).toBe("already-ingested");
  });

  it("skips auto ingest when the received signal does not match the task signal", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-auto-ingest-"));
    const vaultDir = join(tempRoot, "vault");
    const taskDir = join(tempRoot, "tasks");
    const resultDir = join(tempRoot, "results");
    const stampDir = join(tempRoot, "stamps");

    await mkdir(taskDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });

    const resultPath = join(resultDir, "mismatch.result.md");
    await writeFile(
      resultPath,
      `---
task: mismatch
status: done
qa: surface:7
---

# Signal mismatch
`,
      "utf8",
    );

    await writeFile(
      join(taskDir, "mismatch.task.md"),
      `---
id: mismatch
project: kuma-studio
qa: surface:7
signal: expected-signal
result: ${resultPath}
---
`,
      "utf8",
    );

    const skipped = await maybeAutoIngestResult({
      resultPath,
      signal: "different-signal",
      taskDir,
      stampDir,
      vaultDir,
    });

    expect(skipped.status).toBe("skipped");
    expect(skipped.reason).toBe("signal-mismatch");
    expect(existsSync(join(vaultDir, "projects", "kuma-studio.md"))).toBe(false);
  });
});
