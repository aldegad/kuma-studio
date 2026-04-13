---
name: kuma-vault
description: Load domain knowledge from Kuma Vault through a single retrieval interface.
---

---
name: kuma-vault
description: Load domain knowledge from Kuma Vault through a single retrieval interface.
---

# /vault — Kuma Vault 지식 서빙

Vault에 저장된 도메인 지식을 로드하는 단일 인터페이스.

> **vault = 쿠마(나)의 뇌**. amnesiac 가정으로 동작 — vault 외에는 아무것도 기억 못 한다. semantic 지식 + working memory + episodic memory + procedural memory 모두 vault 에서 꺼낸다.

## Intent Router (literal "vault" keyword 보다 우선)

쿠마는 매 유저 메시지에 대해 literal `vault` keyword 가 아니라 **memory intent** 를 우선 인식한다. 다음 패턴이 보이면 즉시 vault retrieval chain 을 돌린다 — 디스코드 히스토리부터 fetch 하지 않는다.

### 트리거 패턴
- "지금 뭐 하던 중이지?", "어디까지 했지?", "이전 결정", "지난번"
- "그 작업", "그 워커", "그 프로젝트" (deictic reference)
- "노을이/뚝딱이/다람이/하울 등 워커 이름" + 상태 질문
- "디코 thread 어디", "메시지 어디"
- 컨텍스트 끊긴 직후 재개 ("세션 끊겼다", "다시 시작")

### Retrieval Chain (순서 고정)

1. `~/.kuma/vault/current-focus.md` — 현재 dispatch snapshot
2. `~/.kuma/vault/dispatch-log.md` 최근 N개 — task 사건열
3. `~/.kuma/vault/decisions.md` 최근 N개 — 결정 이력
4. `${KUMA_PLANS_DIR:-./.kuma/plans}/index.md` Active — 큰 plan
5. `~/.kuma/vault/log.md` tail — vault 변경 timeline
6. `~/.kuma/vault/index.md` — entity 맵
7. `/vault search <q>` — 가벼운 index hit 확인
   필요 시 `/vault timeline <q>` → `/vault get <id|path>` 순서로 점진적으로 펼친다.

상위에서 답이 나오면 하위 단계 skip. 7번까지 다 봐도 답 없으면 그제서야 디스코드 히스토리/Grep 등 외부 탐색.

### Anti-pattern
- ❌ literal "vault" keyword 가 없다고 vault 를 안 본다
- ❌ 디스코드 히스토리부터 fetch 한다
- ❌ Grep/Glob 로 직접 코드베이스 탐색한다 (vault 부터 보기)
- ❌ 검색 결과 전문을 바로 읽는다 (`/vault search` 후 바로 전체 본문 dump 기대 금지. 먼저 `search -> timeline -> get`)

## 사용법

```
/vault <domain>     해당 도메인 지식 전문 로드
/vault index        전체 페이지 목록 조회
/vault search <q>   키워드 검색
/vault timeline <q> 매칭 라인 주변 스니펫 확인
/vault get <id>     특정 문서 전문 로드
```

### 예시

```
/vault security       → domains/security.md 로드
/vault analytics      → domains/analytics.md 로드
/vault image-gen      → domains/image-generation.md 로드
/vault content        → domains/content-pipeline.md 로드
/vault index          → index.md 전체 목록
/vault search vault   → 제목/path/짧은 snippet 목록
/vault timeline vault → 주변 라인 snippet 2~3개
/vault get domains/security.md → 해당 문서 전문
```

## Vault 위치

```
~/.kuma/vault/
├── index.md          전체 페이지 목록 + 교차참조
├── schema.md         운영 규칙
├── domains/          도메인별 지식
│   ├── analytics.md
│   ├── content-pipeline.md
│   ├── image-generation.md
│   └── security.md
├── projects/         프로젝트별 누적 지식
├── learnings/        벤치마크, 디버깅 패턴
└── inbox/            정리 대기 raw 데이터
```

## 도메인 별칭 매핑

| 별칭 | 파일 |
|------|------|
| `security`, `sec` | `domains/security.md` |
| `analytics`, `usage`, `insights` | `domains/analytics.md` |
| `image-gen`, `imagegen`, `image` | `domains/image-generation.md` |
| `content`, `content-pipeline`, `pipeline` | `domains/content-pipeline.md` |

## Role → Domain 자동 로드 매핑

워커가 spawn될 때, `team.json`의 `role` 필드에 따라 관련 vault 도메인을 자동 참조한다.

| Role | 자동 로드 도메인 | 이유 |
|------|-----------------|------|
| `orchestrator` | — | PM은 도메인 무관, 필요 시 수동 호출 |
| `developer` | `security` | 구현 시 보안 점검 기준 참조 |
| `ui` | `image-generation`, `content-pipeline` | 디자인/퍼블리싱 시 이미지 생성 + 콘텐츠 기준 |
| `review` | `security` | 리뷰 시 보안 취약점 기준 참조 |
| `qa` | `security` | QA 시 보안 체크리스트 기준 |
| `content` | `content-pipeline`, `image-generation` | 콘텐츠 제작 파이프라인 + 이미지 생성 |
| `researcher` | `analytics` | 리서치 시 분석 방법론 참조 |
| `director` | `analytics` | 전략 수립 시 데이터 분석 기준 참조 |
| `growth` | `analytics`, `content-pipeline` | 그로스 분석 + 콘텐츠 전략 |
| `ops` | — | 인프라 운영, 도메인 지식 불필요 |

### spawn 시 활용 방법

```
# 예: 뚝딱이(developer) spawn 시 자동 힌트
> 이 워커의 role은 developer입니다.
> 관련 vault 도메인: security
> 필요 시 `/vault security`로 상세 지식을 로드하세요.
```

## 실행 절차

`/vault <arg>` 호출 시:

1. **arg = `index`**: `~/.kuma/vault/index.md` 읽어서 목록 출력
2. **arg = `search <q>`**: 가벼운 index 결과만 확인. title / path / 1줄 snippet 위주.
3. **arg = `timeline <q>`**: 매칭 라인 주변 ±2줄 스니펫으로 중간 detail 확인.
4. **arg = `get <id|path>`**: 특정 문서를 지목했을 때만 전문 로드.
5. **arg = 도메인 이름/별칭**: 위 매핑 테이블에서 파일 경로 결정 → Read로 전문 로드
6. **arg 없음**: 사용법 출력

### 주의사항

- Vault 내용은 **읽기 전용**으로 취급 (수정은 vault-ingest를 통해서만)
- 대용량 파일은 요약 우선, 전문은 요청 시만
- 기본 retrieval 순서는 `search -> timeline -> get` 이다
- inbox/ 내용은 미검증 데이터 — 사실 확인 없이 인용 금지
