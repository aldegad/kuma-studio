---
name: kuma:vault
description: Kuma Vault 지식 서빙 + 인제스트. `/kuma:vault <query>` 로 도메인 로드, `/kuma:vault ingest [소스]` 로 인제스트.
argument-hint: "[<domain|index|search|timeline|get|ingest>] [<args>]"
---

EXECUTE IMMEDIATELY.

## Argument Parsing

Parse `$ARGUMENTS`:

- First token = subcommand.
- Remaining tokens = subcommand args.

## Routing

| First token | 처리 |
|-------------|------|
| 없음 | `kuma-vault` 스킬 기본 사용법 출력 |
| `ingest` 또는 `ingest <...>` | `kuma-vault:ingest` 스킬로 위임 (나머지 인자 전달) |
| `index` / `search` / `timeline` / `get` / 도메인 별칭 | `kuma-vault` 스킬로 위임 (모든 인자 전달) |

### 위임 방법

Skill tool 로 하위 스킬 호출:

```
/kuma:vault ingest raw/foo.md
→ Skill(skill="kuma-vault:ingest", args="raw/foo.md")

/kuma:vault security
→ Skill(skill="kuma-vault", args="security")
```

## Notes

- `kuma-vault` 스킬이 canonical 구현. 이 command 는 colon namespace 진입점일 뿐.
- 기존 `/kuma-vault` 슬래시도 그대로 작동 (migration 중 dual path 유지).
