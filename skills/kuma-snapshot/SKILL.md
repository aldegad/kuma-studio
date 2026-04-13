---
name: kuma:snapshot
description: Capture a whole-workspace Kuma runtime backup before reboot or risky interruption. Use for commands like `kuma:snapshot all` when the machine is unstable but shell access still works and you want extra recovery evidence saved.
user-invocable: true
---

# /kuma:snapshot

재부팅 전 상태를 묶어 두는 백업 스킬이다.

기본 호출 패턴은 `kuma:snapshot all` 이다.

- `all` 은 현재 workspace 기준 전체 dispatch/runtime 상태를 백업한다.
- 이 스킬은 보험이다. 재부팅 후 복구는 `/kuma:recovery all` 이 담당한다.

## 언제 쓰나

- 시스템이 버벅이지만 아직 명령은 먹는다
- 곧 재부팅할 것 같다
- dispatch/task/result 흔적을 한 번 더 안전하게 저장하고 싶다

## 실행 절차

```bash
bash skills/kuma-recovery/scripts/create_reboot_snapshot.sh
```

이 스크립트는 다음을 `~/.kuma/reboot-backups/<timestamp>/` 에 저장한다.

- `~/.kuma/dispatch/tasks`
- `~/.kuma/dispatch/results`
- `~/.kuma/vault/current-focus.md`
- `~/.kuma/vault/dispatch-log.md`
- `~/.kuma/vault/thread-map.md`
- `~/.kuma/vault/log.md`
- `~/.kuma/vault/decisions.md`
- 최근 Claude project JSONL
- Codex history / session index / tui log
- 현재 repo 의 `git status`, `git diff`

## 출력 규칙

- `backup_dir` 를 답변에 반드시 남긴다.
- task/result 개수와 복구에 쓸 핵심 파일이 포함됐는지 짧게 요약한다.
- 다음 스텝은 항상 `/kuma:recovery all` 로 안내한다.

## 관련 파일

- [../kuma-recovery/scripts/create_reboot_snapshot.sh](../kuma-recovery/scripts/create_reboot_snapshot.sh)
