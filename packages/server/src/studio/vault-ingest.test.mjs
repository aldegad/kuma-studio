import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { ingestResultFile, parseFrontmatterDocument } from "./vault-ingest.mjs";

async function createResultFile(dir, name, content) {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  return path;
}

describe("vault-ingest", () => {
  it("upserts a project vault page from a result file matched through the task metadata", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-ingest-"));
    const vaultDir = join(tempRoot, "vault");
    const taskDir = join(tempRoot, "tasks");
    const resultDir = join(tempRoot, "results");

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

    const resultPath = await createResultFile(
      resultDir,
      "vault-ingest-pipeline.result.md",
      `---
id: vault-ingest-pipeline
status: done
worker: surface:8
qa: surface:7
---

# Vault ingest 파이프라인 구현

## 변경 사항
- ingest CLI 추가
- index/log 자동 갱신
`,
    );

    await writeFile(
      join(taskDir, "vault-ingest-pipeline.task.md"),
      `---
id: vault-ingest-pipeline
project: kuma-studio
worker: surface:8
qa: surface:7
result: ${resultPath}
---
`,
      "utf8",
    );

    const first = await ingestResultFile({
      resultPath,
      vaultDir,
      taskDir,
      qaStatus: "passed",
    });

    expect(first.relativePagePath).toBe("projects/kuma-studio.md");

    const pageAfterFirstIngest = await readFile(join(vaultDir, "projects", "kuma-studio.md"), "utf8");
    expect(pageAfterFirstIngest).toContain("<!-- ingest:vault-ingest-pipeline.result.md:start -->");
    expect(pageAfterFirstIngest).toContain("Vault ingest 파이프라인 구현");
    expect(pageAfterFirstIngest).toContain(`sources: [${resultPath}]`);
    expect(pageAfterFirstIngest).toContain("domain: projects");

    await writeFile(
      resultPath,
      `---
id: vault-ingest-pipeline
status: done
worker: surface:8
qa: surface:7
---

# Vault ingest 파이프라인 구현

## 변경 사항
- ingest CLI 추가
- index/log 자동 갱신
- Details idempotent upsert
`,
      "utf8",
    );

    await ingestResultFile({
      resultPath,
      vaultDir,
      taskDir,
      qaStatus: "passed",
    });

    const pageAfterSecondIngest = await readFile(join(vaultDir, "projects", "kuma-studio.md"), "utf8");
    expect(pageAfterSecondIngest.match(/<!-- ingest:vault-ingest-pipeline\.result\.md:start -->/gu)).toHaveLength(1);
    expect(pageAfterSecondIngest).toContain("Details idempotent upsert");

    const indexContent = await readFile(join(vaultDir, "index.md"), "utf8");
    expect(indexContent).toContain("[kuma-studio 프로젝트 지식](projects/kuma-studio.md)");
    expect(indexContent).toContain("kuma-studio ← vault-ingest-pipeline.result.md");

    const logContent = await readFile(join(vaultDir, "log.md"), "utf8");
    expect(logContent).toContain("INGEST: `vault-ingest-pipeline.result.md` → `projects/kuma-studio.md`");
    expect(logContent).toContain("UPDATE: `vault-ingest-pipeline.result.md` → `projects/kuma-studio.md`");
  });

  it("creates a new learning page when no project metadata is available", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-ingest-"));
    const vaultDir = join(tempRoot, "vault");
    const resultDir = join(tempRoot, "results");

    await mkdir(resultDir, { recursive: true });

    const resultPath = await createResultFile(
      resultDir,
      "debug-playwright-timeouts.result.md",
      `---
task: debug-playwright-timeouts
status: done
---

# Playwright timeout 디버깅

첫 번째 재현 케이스를 정리하고 flaky 패턴을 기록했다.
`,
    );

    const result = await ingestResultFile({
      resultPath,
      vaultDir,
      taskDir: join(tempRoot, "missing-tasks"),
      qaStatus: "passed",
    });

    expect(result.relativePagePath).toBe("learnings/debug-playwright-timeouts.md");

    const pageContent = await readFile(join(vaultDir, "learnings", "debug-playwright-timeouts.md"), "utf8");
    const parsed = parseFrontmatterDocument(pageContent);
    expect(parsed.frontmatter.title).toBe("Playwright timeout 디버깅");
    expect(parsed.frontmatter.domain).toBe("learnings");
    expect(parsed.body).toContain("Playwright timeout 디버깅");
  });
});
