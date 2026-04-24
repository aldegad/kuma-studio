#!/bin/bash
# grep-bre-guard — Bash grep/rg 안티패턴 차단
#
# 차단 대상: `grep ... \|` 또는 `rg ... \|` (BSD grep BRE 에서 \| 는 alternation 아님, literal 로 취급되어 0 히트)
# 2026-04-23 실사고: `grep -ril "insane.search\|insane_search\|insanesearch"` 로 볼트 검색 0 히트 → 실제는 파일 존재. 유저에 오답 보고.
# 원칙: 코드/파일 검색은 Grep 툴(ripgrep 기반) 사용. 부득이하게 Bash grep 쓸 때만 `-E` + `|` 사용.

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# grep 또는 rg 호출에 \| (backslash-pipe) 가 포함되어 있는지 검사
# 허용 예: grep -E "a|b" (ERE, 맨 pipe)
# 차단 예: grep "a\|b" (BRE alternation 시도, BSD 에선 literal)
if echo "$cmd" | grep -qE '(^|[\s|;&(])(grep|rg)(\s|$)' && echo "$cmd" | grep -qF '\|'; then
  cat >&2 <<'EOF'
⚠️ Bash grep/rg 에서 `\|` (backslash-pipe) 사용 금지.

이유: macOS BSD grep 은 BRE(기본 정규식)에서 `\|` 를 alternation 으로 지원하지 않는다.
전체 패턴이 literal string 으로 매치되어 실제로는 존재하는 파일도 0 히트로 나온다.
(GNU grep 만 지원, Linux 에선 되지만 macOS 에선 조용히 실패)

해결:
  1) **권장**: Grep 툴(ripgrep 기반, ERE 기본) 사용 — alternation `|` 가 그대로 작동.
  2) 부득이하게 Bash grep 이어야 하면 `-E` 플래그 강제: `grep -E "a|b|c"` (backslash 없음).
  3) rg 는 기본이 ERE 이므로 `\|` 아닌 그냥 `|` 사용: `rg "a|b|c"`.

검색이 0 히트로 나와도 "없다" 결론 전에 패턴 기법부터 의심할 것.
EOF
  exit 2
fi

echo '{"continue": true}'
exit 0
