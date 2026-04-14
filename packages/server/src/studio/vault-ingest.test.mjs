import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  extractIndexStructure,
  ingestResultFile,
  parseFrontmatterDocument,
  rewriteIndex,
} from "./vault-ingest.mjs";

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
