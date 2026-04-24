---
name: kuma-plan
description: Manage Kuma Plan documents with the canonical Korean title, frontmatter, status, and checklist format.
user-invocable: true
---

# /kuma:plan

Kuma Plan document controller. Use this for creating, updating, renaming, or normalizing plan markdown files shown in the Plan panel.

## Store

Plans are markdown files under the configured plans directory:

1. `KUMA_PLANS_DIR`
2. `KUMA_STUDIO_WORKSPACE/.kuma/plans`

Resolve the source through the Studio API first:

```bash
curl -sS http://127.0.0.1:4312/studio/plans
```

Treat `source.plansDir` from that response as the live SSoT. Common local paths such as `~/.kuma/plans` or `<workspace>/.kuma/plans` may be symlinks into a private store, so do not create a repo-local `.kuma/plans` directory unless the API source says that is the configured store.

If the API is unavailable, start or reload the managed `kuma-server` surface before editing. Direct filesystem edits are allowed only after the exact configured plans directory is known.

## File Path

Use:

```text
<plansDir>/<project-id>/<short-kebab-id>.md
```

Rules:

- Keep `project-id` as the canonical project id, for example `kuma-studio`.
- Use lowercase kebab-case for the filename.
- Prefer the API `filePath` value, for example `kuma-studio/skill-cleanup.md`, when asking the user to identify a plan. The `id` is derived from the markdown path and is secondary.
- Keep the file path stable unless the user explicitly asks for a rename or move.
- Do not use the title as a dumping ground for route names, issue notes, or mixed Korean/English fragments.
- Technical ids may stay in backticks inside checklist items.

## Frontmatter

Use exactly:

```markdown
---
title: 한글로 읽히는 짧은 제목
status: active
created: YYYY-MM-DD
---
```

Preferred `status` values for new plans:

- `active` — 진행 중
- `hold` — 보류
- `blocked` — 막힘
- `completed` — 완료
- `cancelled` — 취소
- `failed` — 실패

Use English status values because the Plan parser owns those enums. Put Korean in the title and checklist, not in `status`.

When normalizing existing plans, preserve non-preferred legacy or queue statuses such as `draft`, `open`, `backlog`, `deferred`, `archived`, and `in_progress` unless the lifecycle state is intentionally being changed. The UI can display unknown statuses, but new files should use the preferred values above.

## Body Format

Use Korean section headings:

```markdown
## 완료

- [x] 끝난 일을 과거형으로 적는다.

## 진행 중

- [ ] 지금 진행 중인 일을 적는다.

## 다음

- [ ] 다음 판단이나 실행 항목을 적는다.
```

Omit `## 진행 중` when nothing is actively being worked. Do not invent extra section names unless the plan genuinely needs them.

Checklist rules:

- Use `- [x]` and `- [ ]` only; nested tasks are avoided.
- Keep each item action-oriented and one responsibility.
- Write Korean first. Keep technical ids, file paths, commands, and commit hashes in backticks.
- Completed items use past tense: `정리했다`, `확인했다`, `푸시했다`.
- Open items use decision/action phrasing: `결정한다`, `확인한다`, `정리한다`.
- Do not mix unrelated projects in one plan file.

## Template

```markdown
---
title: 쿠마 스킬 설명 정리
status: active
created: 2026-04-24
---

## 완료

- [x] 현재 스킬 설명 길이와 경고 원인을 확인했다.

## 다음

- [ ] repo-owned 쿠마 스킬 설명을 먼저 줄인다.
- [ ] 로컬 전역 스킬은 소유 원본을 확인한 뒤 수정한다.
```

## Normalization

When normalizing an existing plan:

1. Preserve factual task state.
2. Convert title and section headings to the canonical Korean format.
3. Preserve useful frontmatter fields such as `status`, `status_reason`, `created`, `updated`, `owner`, `project`, and `related`.
4. Keep the file id stable unless the user asks for a rename.
5. Use the relative markdown `filePath` as the user-facing identifier.
6. Do not mark an item complete unless there is current evidence.
7. If old English wording is unclear, rewrite it into plain Korean without changing task meaning.
8. Archive paths may still be read by the current Plan panel because the store walks the plans directory recursively. Keep archived titles readable until the panel explicitly excludes archives.
