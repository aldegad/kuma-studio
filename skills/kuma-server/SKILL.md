---
name: kuma:server
description: Kuma Studio 의 managed kuma-server infra lifecycle 을 관리. 상태 감지 후 cold 면 infra-only bootstrap, zombie 면 reload, up 이면 보고. "서버 띄워", "스튜디오 띄워", "reload", "infra 상태" 키워드에 실행. 팀 스폰은 하지 않음.
user-invocable: true
---

# /kuma:server — 관리형 kuma-server 인프라 관리

`kuma-server` managed surface 의 생성·기동·재시작·상태확인을 담당한다. 팀 스폰은 하지 않는다.

## 사용법

- `/kuma:server` — auto (상태 감지 후 필요 조치 수행)
- `/kuma:server status` — 상태만 출력
- `/kuma:server reload` — 데몬만 재시작
- `/kuma:server boot` — cold 에서 infra-only 부트스트랩
- 자연어 트리거: "서버 띄워", "스튜디오 띄워", "reload 해", "infra 상태", "kuma-server 상태"

## 실행 절차

인자에 맞춰 단일 명령을 실행한다.

```bash
kuma-server [status|reload|boot]   # 인자 없으면 auto
```

`kuma-server` CLI 는 아래 상태를 구분한다:

| 상태 | 감지 | auto 동작 |
|---|---|---|
| `up` | surface `kuma-server` 존재 + port 4312 healthy | 보고만 |
| `zombie` | surface 존재 + port 4312 무응답 | `kuma-server-reload` |
| `cold` | surface 없음 + port 무응답 | `KUMA_BOOTSTRAP_INFRA_ONLY=1 kuma-cmux-bootstrap.sh` |
| `unmanaged` | surface 없음 + port healthy | 실패 보고 (No Silent Fallback) |

## 출력 포맷

CLI 출력을 그대로 보여주되, 조치가 있었다면 **과거형 한 줄 요약**을 붙인다.

```
<CLI 출력>

요약: <UP/reload 완료/cold boot 완료/unmanaged 로 중단>
```

예시:

```
✓ kuma-server UP — surface:4, port 4312 healthy

요약: 이미 UP, 아무것도 안 했어요.
```

```
⚠ kuma-server surface 살아있음 (surface:4), port 4312 응답 없음
→ 자동 reload
<reload 출력>

요약: 데몬만 재시작했어요.
```

## 규칙

- 팀 스폰 금지. 이 스킬은 infra-only.
- 서버 포트는 **4312 고정**. 다른 포트 추측 금지.
- `unmanaged` 상태 (port 은 살아있는데 managed surface 없음) 에서 silent reload/kill 금지. 원인 확인 후 유저에게 보고.
- surface registry key 는 daemon exit 만으로 잃지 않는다 — `kuma-server` 는 managed slot 이므로 재사용한다.
- `cmux read-screen` 으로 surface 생존/scrollback 을 확인할 때는 `cmux tree` 로 workspace 를 먼저 찾고 `--workspace workspace:N --surface surface:M` 을 같이 넘긴다. workspace 없이 surface 만 넘기면 살아있는 terminal 도 non-terminal 처럼 실패할 수 있다.
- managed reload 구현/수동복구는 replacement surface 를 먼저 만들고 title 을 `kuma-server` 로 rename 하고 registry 에 등록한 뒤 명령을 보낸다. 기존 `kuma-server` surface close/remove 는 그 다음이다.
- reload 스크립트가 중간 실패하면 새 로컬 데몬을 띄우기 전에 `cmux tree`, `~/.kuma/cmux/surfaces.json`, `/health` 를 확인하고 같은 workspace 의 `kuma-server` title surface 를 복구한다.
- repo clone 루트는 runtime workspace 로 쓰지 않는다. repo 루트에서 reload 를 실행했더라도 `KUMA_STUDIO_WORKSPACE`, 살아있는 daemon env, surface scrollback, registry-backed default workspace 순서로 실제 작업 루트를 보존한다.
- `KUMA_STUDIO_EXPLORER_GLOBAL_ROOTS` 는 최종 shell command 생성 전에 escaped comma 를 평문 comma 로 정규화한다. reload 를 반복해도 `vault\\,claude\\,codex` 처럼 backslash 가 누적되면 안 된다.
- 보고는 반드시 과거형 ("재시작했어", "부트스트랩 띄웠어"). 미래형 금지.
- `tmux ls` 사용 금지. `cmux tree` 만 사용.
