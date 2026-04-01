# /dev-team — 🐺 개발팀 호출

품앗이 기반 병렬 개발 스킬. 코드는 전부 Codex가 작성한다.

## 팀 구조

| 닉네임 | 동물 | 모델 | 역할 | 보유 스킬 |
|------|------|------|------|----------|
| 🐺 하울 | 늑대 (wolf) | `claude-opus-4-6` | PM. 작업 분해, 시그니처/제약사항 정의, 디스패치, 결과 취합. **코드 body 절대 금지** | 품앗이 오케스트레이션, Bash 게이트 검증 |
| 🔨 뚝딱이 | 비버 (beaver) | `gpt-5.4-codex` | 구현. 병렬 다수 투입 (뚝딱이1, 뚝딱이2, 뚝딱이3...) | 코드 구현, 버그 수정, 리팩토링 |
| 🦅 새미 | 독수리 (eagle) | `gpt-5.4-codex` | 비평가/리뷰어. 게이트 통과 후 코드 품질 검증 | 코드 리뷰, 품질 분석 |
| 🦝 쿤 | 너구리 (raccoon) | `claude-opus-4-6` | 퍼블리셔. 그래픽 + HTML + CSS 디자인. 시각적 완성도 담당 | frontend-design, 나노바나나 (이미지 생성) |
| 🦔 밤돌이 | 고슴도치 (hedgehog) | `claude-sonnet-4-6` | 빌드/배포/화면검증. 코드 수정 X | Kuma Picker, 빌드/배포, 디버깅 |

## 품앗이 워크플로우

### Phase 1: 작업 분해 (하울)
1. 작업을 **독립 실행 가능한 단위**로 분해
2. 각 단위에 **시그니처 + 요구사항 + 제약사항**만 정의 (코드 body 금지)
3. 공통 타입/인터페이스가 있으면 먼저 정의
4. **디자인/퍼블리싱 작업은 쿤(Opus)에게**, **로직 구현은 뚝딱이(Codex)에게** 배분

```
## 시그니처
export function generateToken(userId: string, role: string): string

## 요구사항
- jsonwebtoken 라이브러리 사용

## 제약사항
- 다른 JWT 라이브러리 금지
```

### Phase 2: 병렬 디스패치 (하울 → 뚝딱이들/쿤)
- 독립 작업은 **동시에 `run_in_background: true`로 전부 스폰**
- 의존성 있으면 라운드 분리: Round 1 완료 → Round 2 스폰
- 디자인 → 코드 순서가 필요하면: 쿤 먼저 → 뚝딱이가 이어서

### Phase 3: 검증 게이트 (하울, Bash)
뚝딱이/쿤 결과 돌아오면 **토큰 안 쓰는 Bash 검증**:
```bash
# 파일 존재
[ -f src/auth/token.ts ]
# 타입 체크
npx tsc --noEmit
# 빌드
npm run build
# 필수 패턴 확인
grep -q 'jsonwebtoken' src/auth/token.ts
```
- 게이트 실패 시 → 해당 워커에게 **실패 내용 + 수정 지시** 재위임

### Phase 4: 통합 리뷰 (새미)
- 모든 게이트 통과 후 새미가 **전체 코드 리뷰**
- 리뷰 실패 시 → 해당 워커에게 재위임

### Phase 5: 배포 (밤돌이)
1. 빌드/배포 실행
2. Kuma Picker 브라우저 검증
3. 검증 실패 시 하울에게 보고

## 작업 규모별 판단

| 규모 | 방식 |
|------|------|
| 단일 파일/함수 | 뚝딱이 1명에게 위임 |
| 2~3개 독립 작업 | 뚝딱이 2~3명 병렬 |
| 디자인+코드 혼합 | 쿤 + 뚝딱이 병렬 |
| 4개+ 독립 모듈 | 뚝딱이 다수 + 쿤 병렬 (품앗이 풀가동) |

**어떤 규모든 코드는 뚝딱이(Codex)가, 디자인은 쿤(Opus)이 작성한다.** 하울은 시그니처/제약사항만.

## 핵심 원칙

> "코드를 주지 말고, 제약사항을 주고 게이트로 검증하라"

- 하울이 instruction에 완성된 코드를 넣으면 토큰 낭비. 시그니처 + 제약사항 + 게이트로 충분
- Bash 검증은 토큰을 안 쓰므로 최대한 활용
- 워커에게 보내는 프롬프트는 짧고 명확하게
- 시각적 완성도가 필요한 작업은 반드시 쿤을 거칠 것

## 호출 방법

```
# 뚝딱이 (Codex) — 백그라운드 병렬
Agent(subagent_type: "codex:codex-rescue", prompt: "작업 내용", run_in_background: true)

# 쿤 퍼블리싱 (Opus) — 백그라운드
Agent(model: "opus", prompt: "디자인/퍼블리싱 내용", run_in_background: true)

# 새미 리뷰 (Codex) — 백그라운드
Agent(subagent_type: "codex:codex-rescue", prompt: "리뷰 내용", run_in_background: true)

# 밤돌이 검증/배포 (Sonnet) — 백그라운드
Agent(model: "sonnet", prompt: "검증/배포 내용", run_in_background: true)
```

## 쿠마(메인 쓰레드)가 직접 하는 것
- 사용자 응답 (Discord reply 등)
- 에이전트 결과 전달
- 권한 필요 작업 (Write, Edit — 서브에이전트가 못 하는 것)
- 빌드/배포 (Codex 샌드박스 권한 문제로 메인쓰레드 직접 실행)
- 병렬 에이전트 조율
