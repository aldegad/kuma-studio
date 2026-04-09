---
name: dev-team
description: Route coding work to the Kuma development team orchestration flow.
user-invocable: true
---

# /kuma:dev-team — 🐺 하울 오케스트레이션

canonical: `./.claude/skills/dev-team/skill.md`

이 문서는 legacy stub 이다. 실제 dev-team 스킬 본문은 `.claude/skills/dev-team/skill.md` 를 참조하라. 요약 규칙도 거기 있는 버전을 따를 것 — 이 파일에 있던 과거 내용(특히 `cmux wait-for -S` 를 signal sender 로 쓰는 잘못된 지시)은 폐기됨.

signal sender 는 `mkdir -p /tmp/kuma-signals && touch /tmp/kuma-signals/{signal-name}` 이고 `cmux wait-for` 는 receiver 전용.
