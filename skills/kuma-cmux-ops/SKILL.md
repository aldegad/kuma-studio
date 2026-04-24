---
name: tmux-ops
description: Reference the Kuma cmux operations protocol for surfaces, sends, registration, and dispatch reporting.
user-invocable: true
---

# /kuma:tmux-ops — cmux 운영 프로토콜

쿠마 스튜디오의 surface 기반 운영 작업을 수행할 때 참고하는 스킬이다.

## 목적

- cmux surface 스폰, 등록, 상태 확인, broker 기반 dispatch 흐름을 일관되게 유지
- `~/.kuma/cmux/surfaces.json` 레지스트리와 `~/.kuma/cmux/*.sh` 스크립트 사용 규칙을 한곳에 모음
- 프로젝트별 전담 팀의 surface 운영을 재현 가능한 방식으로 유지

## 기본 원칙

- surface 생성/종료/등록은 `~/.kuma/cmux/` 스크립트를 우선 사용
- `kuma-server` 는 managed infra surface 이다. daemon 프로세스가 죽어도 surface slot 과 registry key 는 유지 대상이며, 살아 있는 infra surface 가 있으면 같은 위치에서 재기동한다.
- managed reload/restart 는 registry miss 시에도 현재 workspace 의 `kuma-server` title surface 를 재발견·재등록한 뒤 same-slot 재사용을 우선한다.
- 작업 전달은 반드시 `~/.kuma/cmux/kuma-cmux-send.sh` 사용 (raw `cmux send` / `send-key` 금지)
- 진행 중 clarification/progress 는 `~/.kuma/bin/kuma-dispatch ask|reply --task-file <task-file> ...` 로 이어간다
- 태스크 완료/실패/QA 결과는 `~/.kuma/bin/kuma-dispatch complete|fail|qa-pass|qa-reject` 로 보고
- QA 태스크는 밤토리에게 전달하고, 검수 결과는 동일한 task file 기준으로 `kuma-dispatch qa-pass|qa-reject` 로 보고
- `kuma-cmux-wait.sh`, `~/.kuma/dispatch/signals`, `kuma-task --wait` 같은 레거시 완료 경로는 사용하지 않는다
- 브라우저 작업은 `cmux browser`가 아니라 Chrome + Playwright 기준으로 수행

## 기본 명령

```bash
~/.kuma/cmux/kuma-cmux-project-status.sh
~/.kuma/cmux/kuma-cmux-project-init.sh <project> <dir>
~/.kuma/cmux/kuma-cmux-spawn.sh <name> <type> <dir> <project>
~/.kuma/cmux/kuma-cmux-register.sh <project> <role> <surface>
~/.kuma/cmux/kuma-cmux-send.sh surface:N "메시지"
~/.kuma/bin/kuma-task <member> "<instruction>"
~/.kuma/bin/kuma-dispatch ask --task-file ~/.kuma/dispatch/tasks/<task>.task.md --message "..."
~/.kuma/bin/kuma-dispatch complete --task-file ~/.kuma/dispatch/tasks/<task>.task.md
~/.kuma/bin/kuma-dispatch qa-pass --task-file ~/.kuma/dispatch/tasks/<task>.task.md
```

## 레지스트리

- 프로젝트 매핑: `~/.kuma/projects.json`
- surface 레지스트리: `~/.kuma/cmux/surfaces.json`
- 플랜 경로: `~/.kuma/plans/{project}/`
- `kuma-status` 는 infra pseudo-member(`server`/`frontend`)를 숨길 수 있으므로, infra 확인은 필요 시 `cmux tree` / `kuma-cmux-project-status.sh kuma-studio` 와 함께 본다.
