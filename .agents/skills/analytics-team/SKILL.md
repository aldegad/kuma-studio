---
name: analytics-team
description: Route research work to the Kuma analytics team workflow.
---

# /analytics-team — 분석팀 호출

`packages/shared/team.json` 기준 분석팀은 `🦊 루미`가 PM/오케스트레이터, `🦉 부리`가 외부 리서치 워커다. 쿠마 모드에서 `/analytics-team`이 호출되면 쿠마가 직접 끝까지 수행하는 것이 아니라 **루미 프로토콜**을 로드해 과제를 분해하고 부리에게 위임한다.

## 팀 구조

| 닉네임 | 동물 | 모델 | 역할 |
|------|------|------|------|
| 🦊 루미 | 여우 (fox) | `gpt-5.4-mini` | PM. 분석 과제 분해, 질문 설계, 디스패치, 결과 취합/검증 |
| 🦉 부리 | 부엉이 (owl) | `gpt-5.4` | 외부 리서치 워커. 웹 검색, 시장 조사, 자료 확인 |

코드 분석/구현이 필요하면 `/dev-team`으로 라우팅한다.

## 루미 프로토콜

### Step 1: 과제 분해
- 루미 역할로 독립 실행 가능한 질문 단위로 분해
- 각 질문에 **분석 대상 + 구체적 질문 + 출력 형식**만 정의
- 외부 리서치/문서 조사 → 부리
- 코드 분석/구현 → `/dev-team`

### Step 2: 부리 디스패치

태스크 파일에 라우팅 정보 포함 (initiator/worker/signal).

```bash
# 1. 시그널 대기 먼저 등록 (background — 시그널 유실 방지)
Bash (run_in_background): ~/.kuma/cmux/kuma-cmux-wait.sh {task-id}-done /tmp/kuma-results/{task-id}.result.md --surface {surface}
⚠️ 반드시 send 전에 등록.

# 2. 태스크 전달
~/.kuma/cmux/kuma-cmux-send.sh {surface} \
  "You are 🦉 부리. Read /tmp/kuma-tasks/{task-id}.task.md and execute. Write result to /tmp/kuma-results/{task-id}.result.md then run: mkdir -p /tmp/kuma-signals && touch /tmp/kuma-signals/{task-id}-done"
```

### Step 3: 검증 게이트
- 부리 결과에서 출처 URL과 주장 매칭을 확인
- 불충분하면 같은 wrapper로 수정 지시
- 후속 코드 작업은 `/dev-team`으로 분리

## 핵심 원칙

> "루미가 질문을 설계하고, 부리가 외부 리서치를 수행한다"

- 쿠마 모드에서 `/analytics-team` 호출 시 루미 프로토콜을 따른다
- 루미는 오케스트레이션과 검증을 맡는다
- 부리는 외부 조사와 출처 수집을 맡는다
- **모든 워커는 cmux 상주 세션으로 스폰**
