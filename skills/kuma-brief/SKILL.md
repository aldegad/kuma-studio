---
name: kuma:brief
description: Kuma Studio 부트스트랩 직후 첫 브리핑. managed infra 상태, 팀 멤버 idle/working 요약, 최근 커밋 1개와 워크트리 변경 요약을 운영자답게 출력한다. 세션 시작 시 또는 "브리핑", "brief", "상태 보고" 키워드 시 실행.
user-invocable: true
---

# /kuma:brief — 부트스트랩 브리핑

세션 시작 직후 워크스페이스 상태를 한눈에 파악한다.

## 사용법

- `/kuma:brief` — 브리핑 실행
- 자연어: "브리핑", "brief", "상태 보고", "지금 상태", "부트스트랩 브리핑"

## 실행 절차

아래 3개 명령을 **병렬**로 실행한다.

```bash
# 1. managed infra 상태
cmux tree 2>/dev/null

# 2. dispatch broker 상태 (팀 working/idle)
kuma-dispatch status 2>/dev/null

# 3. 최근 커밋 + 워크트리 변경
git -C /Users/soohongkim/Documents/workspace/personal/kuma-studio log --oneline -1
git -C /Users/soohongkim/Documents/workspace/personal/kuma-studio status --short
```

infra 발견 기준:
- `cmux tree` 에서 `kuma-server` surface 유무로 UP/DOWN 판단
- `tmux ls` 는 사용하지 않음 (cmux 소켓 기반 환경이므로 tmux ls 실패는 정상)

## 출력 포맷

아래 구조로 짧고 운영자답게 출력한다.

```
**[쿠마 스튜디오 브리핑 — YYYY-MM-DD]**

**Managed Infra**
| Surface | 상태 |
|---|---|
| `kuma-server` | surface:XX — UP / DOWN |

**팀 멤버** — 전원 idle / N명 working
<working 멤버가 있으면 태스크명 포함>

**최근 커밋**
`<hash> <message>`

**워크트리 변경 요약**
<변경 파일 목록을 그룹으로 묶어 한두 줄 요약>

---
알렉스, 뭘 시킬까요?
```

## 규칙

- infra 확인에 `tmux ls` 사용 금지. `cmux tree` 만 사용.
- broker 상태 없으면 → 전원 idle 로 처리.
- 워크트리 변경이 없으면 "변경 없음" 한 줄로 끝낸다.
- 마지막 줄은 항상 무엇을 시킬지 묻는 한 줄로 마무리.
