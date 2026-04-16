import { existsSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import {
  analyzeDocumentRouting,
  extractIndexStructure,
  ingestGenericSource,
  ingestInbox,
  ingestResultFile,
  ingestResultFileWithGuards,
  parseFrontmatterDocument,
  resolveResultPathForTaskId,
  rewriteIndex,
} from "./vault-ingest.mjs";

const execFile = promisify(execFileCallback);
const CLI_PATH = join(process.cwd(), "packages/server/src/cli.mjs");

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

  it("ingests a URL source into a domain page using fetched text", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-url-"));
    const vaultDir = join(tempRoot, "vault");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(
      "<html><body><main><h1>HAIIP</h1><p>IP rental service summary.</p></main></body></html>",
      {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      },
    ));

    try {
      const result = await ingestGenericSource({
        source: "https://example.com/haiip",
        vaultDir,
        section: "domains",
        slug: "haiip",
        title: "하이아이피 조사 메모",
      });

      expect(result.relativePagePath).toBe("domains/haiip.md");
      const pageContent = await readFile(join(vaultDir, "domains", "haiip.md"), "utf8");
      expect(pageContent).toContain("하이아이피 조사 메모");
      expect(pageContent).toContain("IP rental service summary.");
      expect(pageContent).toContain("sources: [\"https://example.com/haiip\"]");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("routes debugging-oriented URL content into learnings automatically", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-url-learning-"));
    const vaultDir = join(tempRoot, "vault");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(
      "<html><body><main><h1>Playwright timeout RCA</h1><p>디버깅 규칙과 복구 패턴을 정리했다.</p></main></body></html>",
      {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      },
    ));

    try {
      const result = await ingestGenericSource({
        source: "https://example.com/playwright-timeout-rca",
        vaultDir,
      });

      expect(result.relativePagePath).toBe("learnings/playwright-timeout-rca.md");
      const pageContent = await readFile(join(vaultDir, "learnings", "playwright-timeout-rca.md"), "utf8");
      expect(pageContent).toContain("Playwright timeout RCA");
      expect(pageContent).toContain("디버깅 규칙과 복구 패턴");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("routes project status text into the matching project page automatically", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-project-route-"));
    const vaultDir = join(tempRoot, "vault");

    const result = await ingestGenericSource({
      source: `# Kuma Studio 배포 상태

Kuma Studio 프로젝트 배포 이슈와 아키텍처 마이그레이션 TODO를 정리했다.
`,
      vaultDir,
    });

    expect(result.relativePagePath).toBe("projects/kuma-studio.md");
    const pageContent = await readFile(join(vaultDir, "projects", "kuma-studio.md"), "utf8");
    expect(pageContent).toContain("Kuma Studio 배포 상태");
    expect(pageContent).toContain("아키텍처 마이그레이션 TODO");
    expect(pageContent).toContain("domain: kuma-studio");
  });

  it("marks mixed project/debug text as ambiguous for full-auto review", () => {
    const routing = analyzeDocumentRouting({
      documentMeta: {
        title: "Kuma Studio 운영 메모",
        summary: "배포 이슈와 디버깅 패턴을 같이 정리했다.",
        body: "Kuma Studio 프로젝트 배포 이슈, recovery pattern, debug checklist.",
        sourcePath: "text:kuma-studio-note",
        sourceName: "kuma-studio-note.md",
        sourceSlug: "kuma-studio-note",
        taskId: "kuma-studio-note",
        project: null,
      },
      sourceType: "text",
    });

    expect(routing.project).toBe("kuma-studio");
    expect(routing.section).toBe("projects");
    expect(routing.ambiguous).toBe(true);
    expect(routing.candidates[0].section).toBe("projects");
    expect(routing.candidates[1].section).toBe("learnings");
  });

  it("ingests inbox files and archives them with .done suffix", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-inbox-"));
    const vaultDir = join(tempRoot, "vault");

    await mkdir(join(vaultDir, "inbox"), { recursive: true });
    await writeFile(
      join(vaultDir, "inbox", "playwright-timeout.md"),
      `# Playwright timeout 메모

재현 절차와 원인 후보를 정리했다.
`,
      "utf8",
    );

    const result = await ingestInbox({
      vaultDir,
      section: "learnings",
    });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0].relativePagePath).toBe("learnings/playwright-timeout.md");
    const pageContent = await readFile(join(vaultDir, "learnings", "playwright-timeout.md"), "utf8");
    expect(pageContent).toContain("Playwright timeout 메모");
    expect(pageContent).toContain("sources: [");
    expect(pageContent).toContain("playwright-timeout.md.done");

    const archivedInbox = await readFile(join(vaultDir, "inbox", "playwright-timeout.md.done"), "utf8");
    expect(archivedInbox).toContain("재현 절차와 원인 후보");
  });

  it("runs automatic fast lint after CLI ingest", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-cli-ingest-"));
    const vaultDir = join(tempRoot, "vault");
    const sourcePath = join(tempRoot, "playwright-timeout.md");

    await writeFile(
      sourcePath,
      `# Playwright timeout RCA

디버깅 규칙과 복구 절차를 정리했다.
`,
      "utf8",
    );

    const { stdout } = await execFile("node", [
      CLI_PATH,
      "vault-ingest",
      "--vault-dir",
      vaultDir,
      "--section",
      "learnings",
      sourcePath,
    ]);

    const payload = JSON.parse(stdout);
    expect(payload.relativePagePath).toBe("learnings/playwright-timeout.md");
    expect(payload.lint.ok).toBe(true);
    expect(payload.lint.fileCount).toBe(3);
    expect(payload.lint.files.map((entry) => entry.file)).toEqual([
      "learnings/playwright-timeout.md",
      "index.md",
      "log.md",
    ]);
  });

  it("resolves a result file path from task id metadata", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-taskid-"));
    const taskDir = join(tempRoot, "tasks");
    const resultDir = join(tempRoot, "results");
    await mkdir(taskDir, { recursive: true });
    await mkdir(resultDir, { recursive: true });

    const resultPath = await createResultFile(
      resultDir,
      "sync-vault.result.md",
      `---
id: sync-vault
status: done
---

# Sync vault
`,
    );
    await writeFile(
      join(taskDir, "sync-vault.task.md"),
      `---
id: sync-vault
result: ${resultPath}
---
`,
      "utf8",
    );

    const resolved = await resolveResultPathForTaskId("sync-vault", {
      taskDir,
      resultDir,
      vaultDir: join(tempRoot, "vault"),
    });

    expect(resolved).toBe(resultPath);
  });

  it("guarded result ingest runs once and skips duplicates via stamp files", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-guarded-"));
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

# QA guarded ingest 연결

## 변경 사항
- bypass ingest로 통합
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

    const first = await ingestResultFileWithGuards({
      resultPath,
      signal: "kuma-studio-qa-auto-ingest-done",
      taskDir,
      stampDir,
      vaultDir,
    });

    expect(first.status).toBe("ingested");
    expect(first.ingest.relativePagePath).toBe("projects/kuma-studio.md");
    expect(existsSync(first.stampPath)).toBe(true);

    const second = await ingestResultFileWithGuards({
      resultPath,
      signal: "kuma-studio-qa-auto-ingest-done",
      taskDir,
      stampDir,
      vaultDir,
    });

    expect(second.status).toBe("skipped");
    expect(second.reason).toBe("already-ingested");
  });

  it("guarded result ingest skips signal mismatch", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-guarded-"));
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

    const skipped = await ingestResultFileWithGuards({
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

  it("extractIndexStructure captures subsection + root placement per path", () => {
    const content = `# Kuma Vault Index

## Projects
- [alpha 프로젝트](projects/alpha.md) — root entry
- [beta 프로젝트](projects/beta.md) — root entry

### GroupA
- [gamma 프로젝트](projects/gamma.md) — manually grouped
- [delta 프로젝트](projects/delta.md) — manually grouped

### GroupB
- [epsilon 프로젝트](projects/epsilon.md) — manually grouped top-level
- [epsilon detail](projects/epsilon/detail.md) — subdir file grouped explicitly

## Learnings
- [loose learning](learnings/loose.md) — no subsection
`;
    const { pathToSubsection, subsectionOrder } = extractIndexStructure(content);

    expect(pathToSubsection.get("projects/alpha.md")).toBe(null);
    expect(pathToSubsection.get("projects/beta.md")).toBe(null);
    expect(pathToSubsection.get("projects/gamma.md")).toBe("GroupA");
    expect(pathToSubsection.get("projects/delta.md")).toBe("GroupA");
    expect(pathToSubsection.get("projects/epsilon.md")).toBe("GroupB");
    expect(pathToSubsection.get("projects/epsilon/detail.md")).toBe("GroupB");
    expect(pathToSubsection.get("learnings/loose.md")).toBe(null);
    expect(subsectionOrder.get("Projects")).toEqual(["GroupA", "GroupB"]);
  });

  it("rewriteIndex preserves manual subsection groupings across regeneration", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kuma-vault-rewrite-"));
    const vaultDir = join(tempRoot, "vault");

    await mkdir(join(vaultDir, "projects"), { recursive: true });
    await mkdir(join(vaultDir, "projects", "epsilon"), { recursive: true });
    await mkdir(join(vaultDir, "learnings"), { recursive: true });

    const pageFrontmatter = (title, summary) => `---
title: ${title}
domain: projects
tags: []
created: 2026-04-14
updated: 2026-04-14
sources: []
---

## Summary
${summary}
`;

    await writeFile(
      join(vaultDir, "projects", "gamma.md"),
      pageFrontmatter("gamma 프로젝트", "gamma summary"),
      "utf8",
    );
    await writeFile(
      join(vaultDir, "projects", "delta.md"),
      pageFrontmatter("delta 프로젝트", "delta summary"),
      "utf8",
    );
    await writeFile(
      join(vaultDir, "projects", "alpha.md"),
      pageFrontmatter("alpha 프로젝트", "alpha summary"),
      "utf8",
    );
    await writeFile(
      join(vaultDir, "projects", "epsilon.md"),
      pageFrontmatter("epsilon 프로젝트", "epsilon root summary"),
      "utf8",
    );
    await writeFile(
      join(vaultDir, "projects", "epsilon", "detail.md"),
      pageFrontmatter("epsilon detail", "epsilon detail summary"),
      "utf8",
    );

    await writeFile(
      join(vaultDir, "index.md"),
      `# Kuma Vault Index

## Domains
(아직 없음)

## Projects
- [alpha 프로젝트](projects/alpha.md) — manual root

### GroupA
- [gamma 프로젝트](projects/gamma.md) — manual group
- [delta 프로젝트](projects/delta.md) — manual group

### GroupB
- [epsilon 프로젝트](projects/epsilon.md) — manual group
- [epsilon detail](projects/epsilon/detail.md) — manual group

## Learnings
(아직 없음)

## Inbox
(비어 있음)

## Cross References
(아직 없음)
`,
      "utf8",
    );

    await rewriteIndex(vaultDir);

    const regenerated = await readFile(join(vaultDir, "index.md"), "utf8");

    expect(regenerated).toContain("### GroupA");
    expect(regenerated).toContain("### GroupB");

    const groupAIdx = regenerated.indexOf("### GroupA");
    const groupBIdx = regenerated.indexOf("### GroupB");
    expect(groupAIdx).toBeGreaterThan(0);
    expect(groupBIdx).toBeGreaterThan(groupAIdx);

    const groupABlock = regenerated.slice(groupAIdx, groupBIdx);
    expect(groupABlock).toContain("projects/gamma.md");
    expect(groupABlock).toContain("projects/delta.md");
    expect(groupABlock).not.toContain("projects/alpha.md");

    const groupBBlock = regenerated.slice(groupBIdx);
    expect(groupBBlock).toContain("projects/epsilon.md");
    expect(groupBBlock).toContain("projects/epsilon/detail.md");

    const projectsIdx = regenerated.indexOf("## Projects");
    const projectsBlock = regenerated.slice(projectsIdx, groupAIdx);
    expect(projectsBlock).toContain("projects/alpha.md");
    expect(projectsBlock).not.toContain("projects/gamma.md");

    await writeFile(
      join(vaultDir, "projects", "zeta.md"),
      pageFrontmatter("zeta 프로젝트", "new ingest result"),
      "utf8",
    );

    await rewriteIndex(vaultDir);
    const afterNew = await readFile(join(vaultDir, "index.md"), "utf8");

    const afterAIdx = afterNew.indexOf("### GroupA");
    const afterBIdx = afterNew.indexOf("### GroupB");
    expect(afterAIdx).toBeGreaterThan(0);
    expect(afterBIdx).toBeGreaterThan(afterAIdx);

    const afterProjectsIdx = afterNew.indexOf("## Projects");
    const afterProjectsBlock = afterNew.slice(afterProjectsIdx, afterAIdx);
    expect(afterProjectsBlock).toContain("projects/zeta.md");
    expect(afterProjectsBlock).toContain("projects/alpha.md");

    const afterGroupABlock = afterNew.slice(afterAIdx, afterBIdx);
    expect(afterGroupABlock).toContain("projects/gamma.md");
    expect(afterGroupABlock).toContain("projects/delta.md");
  });
});
