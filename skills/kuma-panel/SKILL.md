---
name: kuma-panel
description: Operate Kuma Studio panel data for memos, thread drafts, and plans through the canonical Studio APIs and backing stores instead of one-off panel-specific skills.
user-invocable: true
---

# /kuma:panel

Kuma Studio panel data controller. This replaces one-off panel skills such as `thread-draft`.

## Scope

Use this skill for:

- `memo` — user memo notebook shown in the Memo panel.
- `thread` — THREADS DESK drafts.
- `plan` — shared Kuma plan documents shown in the Plan panel.

Do not create a new skill for each panel unless the panel owns a genuinely different runtime or external system.

## SSoT Map

| Area | Canonical API | Canonical Store |
| --- | --- | --- |
| memo | `/studio/memos` | `~/.kuma/vault/memos/*.md` |
| thread | `/studio/vault/threads-content` | `~/.kuma/vault/domains/threads-content/*.md` |
| plan | `/studio/plans` | `KUMA_PLANS_DIR` or `KUMA_STUDIO_WORKSPACE/.kuma/plans` |

The managed `kuma-server` surface owns these APIs. If the API is down, start/reload managed infra first; do not write directly as a fallback.

## Memo

List:

```bash
curl -sS http://127.0.0.1:4312/studio/memos
```

Create:

```bash
curl -sS -X POST http://127.0.0.1:4312/studio/memos \
  -H 'Content-Type: application/json' \
  -d @/tmp/kuma-memo.json
```

Payload:

```json
{
  "title": "memo title",
  "text": "markdown body",
  "images": []
}
```

Delete only when the user explicitly asks:

```bash
curl -sS -X DELETE "http://127.0.0.1:4312/studio/memos/<id>"
```

## Thread

List:

```bash
curl -sS http://127.0.0.1:4312/studio/vault/threads-content
```

Create:

```bash
curl -sS -X POST http://127.0.0.1:4312/studio/vault/threads-content \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d @/tmp/kuma-thread.json
```

Payload:

```json
{
  "title": "thread title",
  "status": "draft",
  "body": "markdown body"
}
```

Patch:

```bash
curl -sS -X PATCH "http://127.0.0.1:4312/studio/vault/threads-content/<id>" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{"status":"approved"}'
```

Status enum is exactly `draft | approved | posted`.

## Plan

Read the dashboard snapshot:

```bash
curl -sS http://127.0.0.1:4312/studio/plans
```

Plans are not memos and not thread drafts. Their store is resolved by `packages/server/src/studio/plan-store.mjs`:

1. `KUMA_PLANS_DIR`
2. `KUMA_STUDIO_WORKSPACE/.kuma/plans`

Plan documents are markdown files with YAML frontmatter and checklist items. Use the configured plan directory for edits only after identifying the exact file. Do not invent a repo-local `.kuma/plans` path when the runtime is pointed at the shared workspace.

## Rules

- API first for memo/thread because the server maintains timestamps, ids, filesystem broadcasts, and image routes.
- For plans, identify the resolved plans directory before editing.
- Keep memo, thread, and plan storage separate. Similar UI panels do not imply the same backing store.
- If a write would affect user-owned memo content, state the exact file/API target before changing it.
