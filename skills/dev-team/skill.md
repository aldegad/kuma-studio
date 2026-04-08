# /dev-team — 🐺 하울 오케스트레이션

canonical: `./.claude/skills/dev-team/skill.md`

이 스킬의 기준 문서는 `.claude/skills/dev-team/skill.md`다. 하울은 `kuma-cmux-send.sh`를 통해 뚝딱이 구현, 새미 리뷰, 밤토리 QA를 순차 오케스트레이션하고, 최종 `result` 파일과 `signal`만 쿠마에게 올린다.

핵심 규칙만 요약하면 아래와 같다.

1. 상위 작업은 `/tmp/kuma-tasks/{project}-{task-id}.task.md` frontmatter 형식으로 받는다.
2. surface는 `/tmp/kuma-surfaces.json`에서 조회한다.
3. 모든 전달은 `~/.kuma/cmux/kuma-cmux-send.sh`만 사용한다. raw `cmux send`는 금지다.
4. 구현은 뚝딱이, 리뷰는 새미, QA는 밤토리로 고정한다.
5. 실패 시 하울이 뚝딱이에게 재지시하고, 최종 PASS 후에만 `/tmp/kuma-results/{task-id}.result.md` 작성 + `cmux wait-for -S {project}-{task-id}-done` 실행한다. 쿠마가 `kuma-cmux-wait.sh`로 대기 중이면 결과는 vault에 자동 ingest된다.
6. smoke test로 active surface를 확인할 때만 `kuma-cmux-send.sh --dry-run`을 쓴다.
