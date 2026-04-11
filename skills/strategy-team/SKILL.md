---
name: strategy-team
description: Route planning work to the Kuma strategy team workflow.
user-invocable: true
---

# /kuma:strategy-team — 전략팀 호출

`packages/shared/team.json` 기준 현재 전략팀은 `🐹 뭉치` 1명만 담당한다. `🦌 노을이`는 전략팀이 아니라 system 팀의 `vault-manager`, `🐰 콩콩이`는 dev 팀의 content/SNS, `🐝 쭈니`는 system 팀의 ops 이다.

## 팀 구조

| 닉네임 | 동물 | 모델 | 역할 | 보유 스킬 |
|------|------|------|------|----------|
| 🐹 뭉치 | 햄스터 (hamster) | `gpt-5.4-mini` | 전략 디렉터 / UX·그로스 | 시나리오 설계, 방향성 정리, 계획 수립 |

## 위임 대상
- 제품 기획 / 기능 우선순위
- 서비스 전략 / 로드맵
- 사용자 경험 설계
- UX / 그로스 방향 정리
- 가설 정리 / 시나리오 플래닝

콘텐츠/SNS, vault 정리, ops 실행은 이 스킬 범위가 아니다. 각각 실제 소속 팀으로 라우팅한다.

## 호출 방법

태스크 파일에 라우팅 정보 포함 (initiator/worker/signal).

```bash
# 1. 시그널 대기 먼저 등록 (background — 시그널 유실 방지)
Bash (run_in_background): ~/.kuma/cmux/kuma-cmux-wait.sh {task-id}-done /tmp/kuma-results/{task-id}.result.md --surface {surface}
⚠️ 반드시 send 전에 등록.

# 2. 태스크 전달
~/.kuma/cmux/kuma-cmux-send.sh {surface} \
  "You are 🐹 뭉치. Read /tmp/kuma-tasks/{task-id}.task.md and execute. Write result to /tmp/kuma-results/{task-id}.result.md then run: mkdir -p /tmp/kuma-signals && touch /tmp/kuma-signals/{task-id}-done"
```

모든 워커는 cmux 상주 세션으로 스폰한다.
