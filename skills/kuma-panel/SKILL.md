---
name: kuma-panel
description: Manage Kuma memo and thread panel data through canonical Studio APIs; use kuma-plan for Plan documents.
user-invocable: true
---

# /kuma:panel

Kuma Studio memo/thread panel data controller. This replaces one-off panel skills such as `thread-draft`.

## Scope

Use this skill for:

- `memo` — user memo notebook shown in the Memo panel.
- `thread` — THREADS DESK drafts.
- Plan documents are handled by `kuma-plan`, not this skill.

Do not create a new skill for each panel unless the panel owns a genuinely different runtime or external system.

## SSoT Map

| Area | Canonical API | Canonical Store |
| --- | --- | --- |
| memo | `/studio/memos` | `~/.kuma/vault/memos/*.md` |
| thread | `/studio/vault/threads-content` | `~/.kuma/vault/domains/threads-content/*.md` |
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

## Rules

- API first for memo/thread because the server maintains timestamps, ids, filesystem broadcasts, and image routes.
- For Plan panel documents, use `kuma-plan`.
- Keep memo/thread storage separate from Plan storage. Similar UI panels do not imply the same backing store.
- If a write would affect user-owned memo content, state the exact file/API target before changing it.
