---
name: dev-team
description: Route coding work to the Kuma development team orchestration flow.
user-invocable: true
---

# /kuma:dev-team — 🐺 하울 오케스트레이션

## 목적

- 하울을 구현자가 아니라 PM/오케스트레이터로 강제한다.
- 개발 작업은 반드시 플랜 작성, 워커 분배, 결과 수합 순서로 진행한다.
- broker 기반 dispatch 완료/QA 보고 규칙을 canonical flow 에 맞춘다.

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
3. clarification, progress, unblock 요청은 같은 task file 기준으로 `kuma-dispatch ask|reply` 스레드에서 이어간다.
4. 워커 결과와 QA 상태를 모아 통합 판단과 최종 보고만 하울이 담당한다.

## Dispatch Report Rules

- 구현 워커는 result 파일을 쓴 뒤 `~/.kuma/bin/kuma-dispatch complete --task-file <task-file>` 또는 `fail` 로 보고한다.
- QA 워커는 같은 task file 기준으로 `~/.kuma/bin/kuma-dispatch qa-pass|qa-reject` 로 최종 상태를 보고한다.
- 오케스트레이터는 필요 시 별도 QA task 를 dispatch 하되, 상태 전이는 기존 task file 의 `complete -> qa-pass|qa-reject` 흐름으로 유지한다.
- `kuma-task --wait`, `kuma-cmux-wait.sh`, `cmux wait-for -S`, `/tmp/kuma-signals` 는 더 이상 canonical flow 가 아니다.
