---
name: kuma:recovery
description: Resume Kuma Studio after reboot, crash, or frozen-session interruption. Use for commands like `kuma:recovery all` when work stopped abruptly and the user wants whole-workspace dispatch recovery from broker, vault, and runtime artifacts.
user-invocable: true
---

# /kuma:recovery

재부팅, 강제 종료, 세션 멈춤 이후의 작업 복구 스킬이다.

기본 호출 패턴은 `kuma:recovery all` 이다.

- `all` 은 현재 workspace 기준 전체 dispatch/runtime 복구를 뜻한다.
- 이 스킬은 복구 전용이다. 재부팅 전 snapshot 은 `/kuma:snapshot all` 로 분리한다.

## 언제 쓰나

- "큰일났다 재부팅해야 한다"
- "다 멈췄다"
- "작업 복구해줘"
- "중단된 작업 이어가자"
- "스레드에서 복구 가능해?"

## 원칙

- broker record 가 canonical source 다. 각 task 는 `~/.kuma/bin/kuma-dispatch status --task-file <path>` 로 조회한다.
- dispatch runtime home 은 `~/.kuma/dispatch/{tasks,results,signals}` 이다. `/tmp/kuma-*` 는 legacy 경로이므로 복구 근거로 쓰지 않는다.
- vault summary 는 보조 복구 레일이다. 읽는 순서는 `current-focus -> dispatch-log -> decisions -> thread-map`.
- `~/.kuma/dispatch/` 는 재부팅에도 남지만, 강제 종료 전 snapshot 을 떠두면 복구 단서가 더 안전해진다.
- managed infra 는 중복 기동하지 않는다. `kuma-server` surface 를 재사용한다.

## Resume 절차

재부팅 후 아래 스크립트를 실행한다.

```bash
bash skills/kuma-recovery/scripts/resume_from_snapshot.sh
```

기본값은 최신 백업을 사용한다. 특정 백업을 쓰려면:

```bash
bash skills/kuma-recovery/scripts/resume_from_snapshot.sh ~/.kuma/reboot-backups/<timestamp>
```

이 스크립트는 다음을 수행한다.

1. `~/.kuma/dispatch/tasks`, `~/.kuma/dispatch/results` 복원 확인
2. 최신 백업 manifest 요약 출력
3. vault 복구 레일 요약 출력
4. 최신 task 파일 최대 10개를 뽑아 `kuma-dispatch status --task-file` 로 broker 상태 재확인

스냅샷이 전혀 없더라도 진행한다.

- broker persistence
- vault recovery rails
- 살아남은 `~/.kuma/dispatch/*`
- Claude/Codex local history

를 우선 사용해 whole-workspace 상태를 다시 짠다.

## 복구 후 운영 루틴

1. `npm run kuma-server:reload`
2. 필요하면 `~/.kuma/cmux/kuma-cmux-project-status.sh kuma-studio`
3. `kuma-dispatch status --task-file` 결과 기준으로:
   - `dispatched`: worker surface 상태 확인 후 이어서 추적
   - `awaiting-qa`: QA 또는 close 절차 이어가기
   - broker 조회 실패: task/result/vault 로그 기준 수동 triage
4. 유저에게 아래 네 가지를 짧게 보고한다.
   - 어떤 백업으로 복구했는지
   - `~/.kuma/dispatch/` artifact 잔존 상태 (tasks/results/signals 파일 수)
   - active task 상위 몇 개의 상태
   - 즉시 사람 판단이 필요한 blocker

## 금지

- snapshot 없이 재부팅을 권하지 않는다. 단, 이미 멈췄다면 즉시 `kuma:recovery all` 로 간다.
- `dispatch-log.md` 만 보고 상태를 단정하지 않는다.
- 중복 서버를 새 터미널에 띄우지 않는다.

## 관련 파일

- [create_reboot_snapshot.sh](scripts/create_reboot_snapshot.sh)
- [resume_from_snapshot.sh](scripts/resume_from_snapshot.sh)
