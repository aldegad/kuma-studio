# /vault curate — Kuma Vault 정리/보수

기존 Vault 를 읽고, 고아 raw, 깨진 링크, 잘못된 source path, 중복/비정상 page, index/log drift 를 정리한다.

> **핵심 역할:** `ingest` 는 새 소스를 넣는 일이고, `curate` 는 이미 있는 Vault 를 정리하는 일이다.

## 사용법

```text
/vault curate                  vault 전체 큐레이션
/vault curate raw              raw archive / orphan source 중심 점검
/vault curate links            깨진 링크 / 잘못된 source path 점검
/vault curate page <path>      특정 page 1개 집중 정리
/vault curate domain <slug>    특정 domain / project 묶음 점검
```

## 언제 쓰나

- "vault 내부 정리 잘 안 된 것 같아"
- "raw 에 고아 있나 봐줘"
- "기존 문서 이상한 거 손봐줘"
- "깨진 링크 / source 경로 보수해줘"
- "중복 page / canonical 정리해줘"
- "ingest 말고 기존 vault 를 정리하자"

## 범위

이 서브커맨드는 **기존 Vault 보수** 전용이다.

- 포함:
  - `raw/` 고아 점검
  - 문서의 `sources` / 본문 증거 링크 보수
  - `index.md` 항목 drift 보수
  - canonical page 판단 및 merge/relink
  - `vault-lint` 결과 기반 구조 보수
- 제외:
  - 새 외부 소스를 처음 승격하는 작업
  - dispatch result / inbox 신규 ingest
  - `raw/` 원본 파일 내용 수정

새 소스를 넣어야 하면 `/vault ingest` 로 넘긴다.

## 큐레이션 절차

### Step 1 — 점검 범위 고정

우선 아래 중 하나로 범위를 고정한다.

- 전체 Vault
- `raw/`
- 특정 page
- 특정 domain/project 묶음

범위를 정하지 않으면 기본은 **전체 점검 후 안전한 수정만 적용**이다.

### Step 2 — 사실 수집

항상 아래 순서로 본다.

1. `vault-lint --mode full`
2. 대상 page / `index.md` / `log.md`
3. `raw/` 파일 목록
4. 문서 안의 `sources:` 와 `../raw/...` 링크

이 단계에서는 먼저 **무엇이 이상한지**를 분리한다.

## 이상 유형

| 유형 | 예시 | 기본 처리 |
|------|------|-----------|
| broken source path | 문서가 존재하지 않는 `../raw/...` 를 가리킴 | 실제 raw 경로로 보수 |
| orphan raw | raw 파일이 어떤 canonical page 에도 연결되지 않음 | archive 정상인지 / 승격 필요인지 분류 |
| duplicate page | 같은 지식이 여러 page 에 중복됨 | canonical 하나로 merge 후 나머지는 relink |
| stale index | `index.md` 설명/경로/교차참조가 실제와 다름 | regenerate 또는 수동 보수 |
| special file drift | `dispatch-log.md` / `decisions.md` 의 `type: special/*` frontmatter 또는 필수 section 누락 | `~/.kuma/vault/schema.md` 기준으로 보수 |
| duplicate slot | 같은 knowledge category 가 여러 경로에 흩어짐 | schema.md 의 canonical 슬롯 기준으로 통합, 나머지는 relink 또는 archive. 예: 운영 규칙은 root `operational-rules/` 가 canonical (2026-04-16 확정) |
| mixed page | project 지식과 domain 지식이 한 page 에 과도하게 섞임 | canonical 유지 + 재사용 가능한 부분만 분리 |

## 판단 원칙

- **SSoT 우선**: 같은 지식을 두 군데에 남기지 않는다.
- **raw 는 archive**: 원본 파일은 지우거나 덮어쓰지 않는다.
- **기존 page 삭제보다 merge 우선**: 지우기 전에 canonical 을 정한다.
- **안전한 수정 우선**: 명백한 깨진 링크, 명백한 frontmatter drift, 명백한 index drift 는 바로 보수한다.
- **애매한 통합은 질문**: 두 page 중 무엇이 canonical 인지 불분명하면 사용자에게 확인받는다.

## raw 고아 처리 규칙

`raw` 파일이 참조되지 않아도 모두 문제가 되는 것은 아니다.

### 정상 orphan

- 단순 archive 보존 목적
- 아직 승격 전인 증거 파일
- 이미지 세트/중간 산출물처럼 일부만 문서에서 참조되는 경우

### 정리 필요 orphan

- 이미 관련 canonical page 가 있는데 source 링크만 빠진 경우
- 이름이 바뀌어 기존 문서가 깨진 경로를 가리키는 경우
- 사실상 중요한 memo 인데 Vault 문서가 전혀 없는 경우

### 처리 방식

1. 관련 canonical page 가 있으면 `sources`/본문 링크를 보수
2. 관련 page 가 없고 재사용 가치가 높으면 `/vault ingest` 대상으로 승격 제안
3. 단순 archive 면 그대로 두고 Findings 에만 기록

## 출력 형식

큐레이션 결과는 항상 세 덩어리로 정리한다.

### Findings

- 무엇이 이상했는지
- 무엇이 정상 orphan 인지
- 무엇이 추가 판단이 필요한지

### Applied

- 실제로 수정한 파일
- 어떤 링크/frontmatter/index 를 보수했는지

### Follow-up

- `ingest`로 넘길 후보
- 사람이 canonical 을 정해야 하는 항목
- 정기 점검이 필요한 항목

## 불변식

- `raw/` 원본은 수정/삭제 금지
- 기존 page 내용은 함부로 제거하지 않는다
- 애매한 중복 통합은 질문 없이 강행하지 않는다
- `log.md` 는 append-only 유지
- `index.md` 는 canonical page 기준으로만 갱신한다

## 현재 구현 해석

- 현재 CLI 구현은 `kuma-studio vault-ingest`, `kuma-studio vault-lint`, 수동 편집의 조합으로 큐레이션을 수행한다.
- 즉 `curate` 는 **전용 CLI가 아니라 운영 서브커맨드**이다.
- 기계적으로 확인 가능한 부분은 `vault-lint`와 Grep/Glob 으로 먼저 찾고, 구조 판단이 필요한 부분만 큐레이션한다.
- skill 문서는 repo source 가 SSOT 이다. vault 에 managed skill mirror 를 만들지 않고, legacy skill inbox 문서는 `vault-lint --mode full` 에서 drift 로만 보고한다.
- 자주 반복되는 패턴이 쌓이면 나중에 `vault-curate` CLI 로 분리할 수 있다.

## Vault 디렉토리 구조 (참고)

```
~/.kuma/vault/
├── index.md / log.md / schema.md / decisions.md / dispatch-log.md
├── domains/              도메인 지식
├── projects/             얇은 canonical project summary
├── learnings/            디버깅 패턴, 인사이트
├── operational-rules/    runtime rule layer (canonical)
├── docs/                 참고 문서
├── images/               이미지 아카이브
├── raw/                  원본 archive (수정/삭제 금지)
├── inbox/                인제스트 대기
└── results/              dispatch result / evidence archive
```

## 관련

- `/vault` (기본) — 읽기/조회
- `/vault ingest` — 새 소스 승격 (`references/ingest.md`)

## 도구

Read, Edit, Write, Glob, Grep, Bash(date)
