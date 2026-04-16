---
name: kuma:vault
description: Kuma Vault 지식 서빙 + 인제스트 + 큐레이션. `/kuma:vault <query>` 로 도메인 로드, `/kuma:vault ingest [소스]` 로 인제스트, `/kuma:vault curate [범위]` 로 정리.
argument-hint: "[<domain|index|search|timeline|get|ingest|curate>] [<args>]"
---

EXECUTE IMMEDIATELY.

## Routing

모든 인자를 그대로 `kuma-vault` 스킬로 넘긴다. 서브커맨드 분기는 스킬 안에서 처리한다.

```
/kuma:vault <anything>
→ Skill(skill="kuma-vault", args="<anything>")
```

- 인자 없음 → `kuma-vault` 기본 사용법 출력
- `index` / `search` / `timeline` / `get` / 도메인 별칭 → 읽기 경로
- `ingest [args]` → `references/ingest.md` 기반 승격 절차
- `curate [args]` → `references/curate.md` 기반 정리 절차

## Notes

- `kuma-vault` 스킬이 canonical 구현. 이 command 는 colon namespace 진입점일 뿐.
- 기존 `/kuma-vault` 슬래시도 그대로 작동.
- 예전에 존재하던 서브스킬 `kuma-vault:ingest` / `kuma-vault:curate` 는 제거됐다 — 모든 동작은 `kuma-vault` 내부 서브커맨드로 통합.
