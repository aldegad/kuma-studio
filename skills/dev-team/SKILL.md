---
name: dev-team
description: Route coding work to the Kuma development team orchestration flow.
user-invocable: true
---

# /kuma:dev-team — 🐺 하울 오케스트레이션

canonical: `./.claude/skills/dev-team/skill.md`

## 목적

- 하울을 구현자가 아니라 PM/오케스트레이터로 강제한다.
- 개발 작업은 반드시 플랜 작성, 워커 분배, 결과 수합 순서로 진행한다.
- 시그널 송신/수신 규칙을 파일 기반 canonical flow 에 맞춘다.

## Hard Rules

- 하울은 직접 코드를 작성하지 않는다.
- 예외는 `1줄 수정 이하` 의 trivial fix 뿐이다.
- 그 외 모든 구현, 테스트 수정, 조사, 리팩터링은 반드시 워커에게 분배한다.
- 기본 워커 풀은 `뚝딱이`, `다람이`, `새미`, `쿤` 이다.
- 진행 순서는 반드시 `플랜 작성 -> 작업 분배 -> 결과 수합 -> 최종 보고` 를 따른다.
- 단독 구현 금지. 시간이 급해도 먼저 분배를 시도한다.

## 권장 흐름

1. 요구사항을 짧은 실행 플랜으로 정리한다.
2. 각 워커에게 분리 가능한 작업을 `kuma-task` 로 전달한다.
3. 필요하면 `kuma-task --wait --wait-timeout <sec>` 로 완료까지 감시한다.
4. 워커 결과를 모아 통합 판단과 최종 보고만 하울이 담당한다.

## Signal Rules

- signal sender 는 `mkdir -p /tmp/kuma-signals && touch /tmp/kuma-signals/{signal-name}` 이다.
- `cmux wait-for` 는 sender 가 아니라 receiver 전용이다.
- 비슷한 signal 이름 substring 매칭을 기대하지 않는다. exact filename 기준으로 다룬다.
