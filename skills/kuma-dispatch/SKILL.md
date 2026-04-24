---
name: kuma-dispatch
description: Track Kuma work requests, replies, completion, and QA through the lightweight kuma-dispatch CLI.
user-invocable: true
---

# /kuma-dispatch — 작업 요청 추적

Kuma 팀원에게 일을 맡기고, 답변/완료/반려를 추적하는 얇은 envelope 프로토콜이다.

## 원칙

- `kuma-dispatch` 가 작업 추적의 단일 진입점이다. `kuma-task` 는 사용하지 않는다.
- 기본 dispatch 는 이메일처럼 작동한다. 요청 본문만 보내고, 문서나 결과물은 필요한 경우에만 첨부한다.
- prompt 에 모든 맥락을 복사하지 않는다. 필요한 파일은 `--attach` 로 path reference 만 넘긴다.
- result file 은 기본 필수가 아니다. 감사/QA/증거가 필요한 작업에서만 `--require-result` 로 요구한다.
- cmux surface 생성/조회/등록은 cmux 스크립트 책임이고, dispatch skill 의 책임이 아니다.

## 명령

```bash
~/.kuma/bin/kuma-dispatch assign <member> "<request>" --project <project>
~/.kuma/bin/kuma-dispatch assign <member> "<request>" --attach docs/spec.md
~/.kuma/bin/kuma-dispatch ask --task-file ~/.kuma/dispatch/tasks/<task>.task.md --message "..."
~/.kuma/bin/kuma-dispatch reply --task-file ~/.kuma/dispatch/tasks/<task>.task.md --message "..."
~/.kuma/bin/kuma-dispatch done --task-file ~/.kuma/dispatch/tasks/<task>.task.md --summary "..."
~/.kuma/bin/kuma-dispatch fail --task-file ~/.kuma/dispatch/tasks/<task>.task.md --blocker "..."
~/.kuma/bin/kuma-dispatch qa-pass --task-file ~/.kuma/dispatch/tasks/<task>.task.md
~/.kuma/bin/kuma-dispatch qa-reject --task-file ~/.kuma/dispatch/tasks/<task>.task.md --blocker "..."
```

## 첨부와 결과물

- `--attach <path>` 는 파일 내용을 prompt 에 붙이지 않고 참조만 남긴다.
- 여러 파일은 `--attach` 를 반복한다.
- `--require-result` 를 붙인 작업만 `~/.kuma/dispatch/results/*.result.md` 결과 파일을 요구한다.

## 읽는 법

- 최신 상태는 broker/status 를 본다.
- `~/.kuma/dispatch/tasks/*.task.md` 는 요청 envelope 이다.
- `~/.kuma/dispatch/results/*.result.md` 는 선택적 증거/결과물이다.
- `~/.kuma/vault/dispatch-log.md` 는 복구용 derived ledger 이며 정책 SSoT 가 아니다.
