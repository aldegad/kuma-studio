---
name: strategy-team
description: Route planning work to the Kuma strategy team workflow.
---

# /strategy-team — 전략팀 호출

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

전략 과제도 canonical dispatch flow 하나만 사용한다.

```bash
~/.kuma/bin/kuma-task "뭉치" "<instruction>" --project "<project>"
```

- 생성된 task file 을 기준으로 워커가 작업한다.
- clarification 이 필요하면 `~/.kuma/bin/kuma-dispatch ask|reply --task-file <task-file> ...` 로 이어간다.
- result file 작성 후 `~/.kuma/bin/kuma-dispatch complete --task-file <task-file>` 또는 `fail` 로 보고한다.
- QA 는 밤토리에게 별도 dispatch 하고, 같은 task file 로 `qa-pass|qa-reject` 를 기록한다.
- `kuma-cmux-wait.sh`, `/tmp/kuma-signals`, `kuma-task --wait` 같은 레거시 완료 경로는 사용하지 않는다.

**모든 워커는 cmux 상주 세션으로 스폰하지만, 완료 신호는 dispatch broker 가 canonical 이다.**
