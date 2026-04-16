# /vault ingest — Kuma Vault 지식 승격

inbox/ 또는 명시 소스를 읽고, 적절한 vault 위치로 승격한 뒤 index.md / log.md 를 최신화한다.

> **핵심 불변:** SSoT — 같은 지식을 두 곳에 두지 않는다. 기존 페이지가 있으면 반드시 merge, 신규 생성은 해당 위치가 없을 때만.

## 사용법

```
/vault ingest                              inbox/ 전체 항목 처리
/vault ingest <file-or-path>               특정 파일 인제스트 (절대/상대 경로 모두 가능)
/vault ingest raw/<filename>               raw/ 아카이브 파일 → learnings/ 또는 domains/ 승격
/vault ingest result <task-id>             dispatch result 파일에서 vault 지식 추출
/vault ingest <url-or-text>                URL 또는 raw text → inbox/ 경유 없이 직접 처리
/vault ingest --bypass                     무인 모드. 질문 없이 최선 추정으로 바로 정리
```

### 주요 옵션

| 옵션 | 설명 |
|------|------|
| `--full-auto` | 기본값. 라우팅이 애매하면 후보 목록을 보여주고 선택 요청 |
| `--bypass` | 무인 모드. `--full-auto`와 함께 사용 불가 |
| `--dry-run` | 실제 쓰기 없이 라우팅 결과만 미리 확인 |
| `--qa-status passed` | QA 상태 명시 (기본값: `passed`) |
| `--section projects\|domains\|learnings` | 타깃 섹션 명시 override |
| `--page projects/kuma-studio.md` | 타깃 페이지 경로 직접 지정 |
| `--slug custom-slug` | page slug override |
| `--title "Custom Title"` | 페이지 제목 override |
| `--project kuma-studio` | 프로젝트 ID 명시 (라우팅 힌트) |
| `--signal task-done` | 완료 시 signal 전송 (guarded ingest 모드 활성화) |
| `--stamp-dir <path>` | 중복 ingest 방지용 stamp 디렉토리 |

## Vault 디렉토리 구조

```
~/.kuma/vault/
├── inbox/                정리 대기 staging (인제스트 입구)
├── raw/                  원본 보존 archive (변경 금지, ingest 대상 아님)
│   ├── pdf/              PDF 원본
│   ├── pdf-text/         PDF 텍스트 추출본
│   └── memos/            메모 원본
├── results/              dispatch result 파일 (ingest 소스로 사용)
├── domains/              도메인 지식 (security, analytics, image-gen, content-pipeline, frontend-design …)
├── projects/             프로젝트 상태 (kuma-studio, pqc, artkit …)
│   └── <slug>.project-decisions.md   프로젝트별 decision ledger (special file)
├── learnings/            반복 가능한 인사이트, 디버깅 패턴
│   └── memory-map.md        feedback 원본 ↔ vault 문서 매핑
├── operational-rules/    runtime rule layer (canonical — 2026-04-16 부터 root 슬롯만 유지)
├── docs/                 참고 문서 (모델 스펙 등)
├── images/               이미지 아카이브
├── index.md              교차참조 카탈로그 (갱신 대상)
├── log.md                append-only 변경 이력 (갱신 대상)
├── schema.md             운영 규칙 (SSoT — ingest 시 반드시 참고)
└── [Special files]       current-focus.md / dispatch-log.md / decisions.md / thread-map.md
```

## 인제스트 절차 (순서 고정)

### Step 1 — 소스 확정

| 입력 | 처리 |
|------|------|
| 인자 없음 | `~/.kuma/vault/inbox/` 전체 목록 읽기 |
| 파일 경로 | 해당 파일 Read |
| `raw/<name>` | `~/.kuma/vault/raw/<name>` Read |
| `result <id>` | `~/.kuma/dispatch/results/<id>.result.md` 또는 vault/results/ Read |
| URL | WebFetch 후 요약 |
| raw text | 그대로 사용 |

### Step 2 — 타깃 결정

내용을 읽고 아래 기준으로 타깃 디렉토리를 결정한다.

| 내용 유형 | 타깃 |
|-----------|------|
| 특정 도메인 지식 (security, analytics, image-gen, content …) | `domains/<domain>.md` |
| 프로젝트 상태·이슈·아키텍처 | `projects/<slug>.md` |
| 운영 규칙·피드백·디버깅 패턴 | `operational-rules/` (운영 규칙) · `learnings/` (반복 인사이트/디버깅) |
| 벤치마크·성능 측정 | `learnings/` |
| 시스템 온톨로지·설계 원칙 | `learnings/kuma-system-ontology.md` 또는 신규 |

### 빠른 분류 예시

| 들어온 소스 | 우선 타깃 | 이유 |
|-------------|-----------|------|
| "이 사이트 조사해줘" 결과 정리 | `domains/<slug>.md` | 특정 외부 서비스/회사/제품에 대한 SSOT |
| "이 프로젝트 어디까지 했지?" 결과 | `projects/<slug>.md` | 진행 상태, 결정, TODO 는 프로젝트 문맥 |
| "이번 장애 원인/복구 절차" | `learnings/` | 재사용 가능한 디버깅 패턴/운영 인사이트 |
| "코드 스타일, QA 원칙, 브라우저 사용 규칙" | `operational-rules/` | 반복 실행되는 운영 규칙 |
| 개인 이력서/포트폴리오 분석본 | `domains/careers.md` 또는 관련 도메인 | 특정 프로젝트보다 재사용 가능한 후보자/커리어 지식 |
| 특정 채용건/제안건 진행 메모 | `projects/<slug>.md` | 사람 자료라도 실제 진행 단위가 프로젝트면 project가 우선 |
| 도메인 설명과 프로젝트 현황이 섞인 문서 | `projects/<slug>.md` 우선, 도메인 지식만 별도 추출 | 실행 맥락을 잃지 않기 위해 project를 canonical로 두고, 재사용 가능한 부분만 domain으로 승격 |

### Step 3 — 기존 페이지 체크 (SSoT 핵심)

```
Glob → 타깃 경로 존재 여부 확인
  있음 → Read 후 merge (기존 내용 삭제 금지, 새 내용 append/통합)
  없음 → 신규 파일 Write (표준 frontmatter 필수)
```

**신규 페이지 표준 frontmatter:**

```markdown
---
title: {제목}
domain: {도메인 or 프로젝트}
tags: [{태그1}, {태그2}]
created: {YYYY-MM-DD}
updated: {YYYY-MM-DD}
sources: [{원본 파일/링크}]
source_grade: {foundation|supporting|exploratory|historical}   # 선택 — raw/ 1차 지식일 때만
---

## Summary
{1-3줄 요약}

## Details
{상세 내용}

## Related
- [{관련 페이지}]({경로}) — {연결 이유}
```

**Special Files 주의:** `current-focus.md` / `dispatch-log.md` / `decisions.md` / `thread-map.md` 는 일반 ingest 대상 **아님**. `type: special/*` frontmatter 를 가진 runtime memory layer. 각 writer 고정: current-focus/dispatch-log/thread-map 는 `kuma-task lifecycle hook`, decisions 는 `user-direct` 전용. ingest 로 덮어쓰지 말 것. 자세한 규칙은 `~/.kuma/vault/schema.md` 참조.

### Step 4 — index.md 갱신

`~/.kuma/vault/index.md` 를 Read 후 Edit:
- 신규 페이지 → 적절한 섹션에 항목 추가
- merge → 기존 항목의 `updated:` 또는 description 갱신
- 교차참조가 끊겼으면 보수

### Step 5 — log.md append

`~/.kuma/vault/log.md` 끝에 엔트리 추가:

```
{YYYY-MM-DD HH:MM} INGEST: {소스} → {타깃 경로} ({신규|merge}) — {1줄 요약}
```

### Step 6 — 결과 보고

```
인제스트 완료: {소스} → {타깃 경로} ({신규 생성|기존 merge})
index.md 갱신: {추가/수정 항목}
log.md append: {1줄}
```

## 제약 / 불변식

- `raw/` 는 원본 보존 계층 — **절대 수정하지 않는다** (ingest 타깃 자체가 아님, rule 0)
- `raw/<name>` 을 **소스로** 읽어 `domains/`/`projects/`/`learnings/` 로 승격하는 것은 허용 (raw 원본 파일은 그대로 둠)
- 기존 페이지 내용 **삭제 금지** — 갱신은 append/merge 만
- Special files (`current-focus.md`, `dispatch-log.md`, `decisions.md`, `thread-map.md`) 는 ingest 로 덮어쓰지 않는다 — 이들은 lifecycle hook 소유
- `~/.claude/projects/` (user-memo) 는 **read-only** — 이 경로 아래는 쓰지 않는다
- inbox/ 에서 꺼낸 파일은 인제스트 완료 후 inbox 에서 제거하거나 `_done` suffix 로 마킹
- log.md 는 항상 **append-only** (덮어쓰기 금지)
- 판단 불가한 소스는 inbox/ 에 남기고 Findings 에만 보고

## 현재 구현 상태 점검

- 현재 `kuma-studio vault-ingest` CLI 구현은 `result-file`, `result <task-id>`, `inbox/` 일괄 처리, `raw/<name>`, 일반 파일, `URL`, `raw text` 직접 인제스트를 지원한다.
- `--full-auto` 가 기본값 (플래그를 생략해도 동일하게 동작). 라우팅이 애매하면 후보 목록(최대 3개)을 보여주고 번호 선택을 요청한다. TTY 가 없는 환경(파이프, 워커)에서는 자동으로 에러를 throw — 반드시 `--bypass` 또는 `--section`/`--page` 명시. 무인 워커/크론/노을이 같은 자동 실행은 `--bypass` 를 명시해서 질문 없이 진행한다.
- 인제스트가 실제 쓰기를 하면, 완료 직후 방금 갱신한 페이지와 `index.md`/`log.md` 에 대해 자동 `fast lint` 를 수행한다.
- 타깃 분류는 **명시 override(`--section`, `--page`) > 프로젝트 감지 > learnings/domains 규칙 기반 자동 분류** 순서로 동작한다.
- 다만 자동 분류는 아직 LLM 판단이 아니라 **키워드/프로젝트 ID 기반 heuristic** 이다. `--full-auto` 에서는 ambiguous hit 를 사용자에게 확인하고, `--bypass` 에서는 최선 추정으로 바로 반영한다.
- 기존 Vault 내부의 고아 raw, 깨진 source path, 중복 page, canonical 재정리는 `curate` 서브커맨드 범위다 (`references/curate.md` 참조).
- 따라서 ingest가 Vault 정리를 많이 줄여주긴 하지만, 아래 조합은 여전히 필요하다.
  - `vault-ingest`: 원본/결과를 canonical page 로 승격
  - `vault-skill-sync` 또는 수동 동기화: skill 문서와 vault 문서 정렬
  - `vault-lint --mode full`: 전체 special file / 구조 드리프트 / 링크 상태 정기 점검

## 도구

Read, Edit, Write, Glob, Grep, Bash(date)
