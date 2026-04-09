# Kuma Studio 기획서

> **프로젝트명:** 쿠마 스튜디오 (Kuma Studio)
> **버전:** v0.1 Draft
> **작성일:** 2026-03-31
> **작성:** 노을이 (전략팀 디렉터) -- 콩콩이, 뭉치, 쭈니 분석 통합
> **상태:** 개발 착수 준비 완료

---

## 1. 프로젝트 개요

### 1.1 한 줄 정의

**쿠마 스튜디오는 AI 에이전트가 일하는 모습을 시각적으로 보여주는 가상 사무실이자, 브라우저 자동화 브릿지를 내장한 에이전트 오케스트레이션 플랫폼이다.**

### 1.2 기존 쿠마피커와의 관계

쿠마피커(Kuma Picker)는 브라우저 확장 + 에이전트 브릿지 도구로, 다음 핵심 기능을 제공한다:

| 기능 | 설명 |
|------|------|
| 브라우저 픽 | 웹 페이지 요소를 선택하면 셀렉터, 바운딩박스, 텍스트 등 추출 |
| Job Cards | 에이전트 작업 지시/추적을 위한 플로팅 카드 UI |
| Paw Feedback | 곰발바닥 제스처로 에이전트 동작 시각화 (클릭, 드래그, 스크롤) |
| Playwright-shaped API | page.goto, page.click, locator.fill 등 Playwright 호환 API |
| 데몬 서버 | WebSocket 기반 브라우저-에이전트 통신 (kuma-pickerd, 포트 4312) |

쿠마 스튜디오는 이 모든 기능을 **그대로 포함**하면서, 다음을 추가한다:

1. **쿠마팀 가상 사무실** -- 동물 캐릭터들이 일하는 사무실 화면
2. **대시보드** -- 에이전트 작업 현황, 토큰 소모량, 통계
3. **일하는 에이전트 애니메이션** -- 실시간 작업 상태에 따른 캐릭터 움직임
4. **OpenAI Image Gen 통합** -- 캐릭터/가구/인테리어 생성

### 1.3 쿠마팀 구성

| 팀 | 이름 | 역할 | 이모지 |
|----|------|------|--------|
| 시스템 | 쿠마 | 총괄 리더 | bear |
| 시스템 | 쭈니 | CoS / Bash 러너 | bee |
| 분석팀 | 루미 | 팀장 | fox |
| 분석팀 | 부리 | 리서치 | owl |
| 개발팀 | 하울 | 오퍼레이터 | wolf |
| 개발팀 | 뚝딱이 | 개발자 | beaver |
| 개발팀 | 다람이 | 개발자 | squirrel |
| 개발팀 | 새미 | 비평가 | eagle |
| 개발팀 | 쿤 | 퍼블리셔 | raccoon |
| 개발팀 | 밤토리 | QA | hedgehog |
| 개발팀 | 콩콩이 | 콘텐츠/SNS | rabbit |
| 전략팀 | 노을이 | 디렉터 | deer |
| 전략팀 | 뭉치 | UX/그로스 | hamster |

---

## 2. 콩콩이 분석: C.A.T.H 프레임워크 -- 브랜딩 & 콘텐츠 전략

### 2.1 Context (맥락)

**시장 상황:**
- AI 에이전트 도구는 2025~2026년 폭발적 성장 중 (Claude Code, Codex, Devin, Cursor 등)
- 그러나 대부분의 도구가 **터미널/텍스트 기반**이라 에이전트가 뭘 하고 있는지 직관적으로 보기 어려움
- 브라우저 자동화 도구(Playwright, Puppeteer)는 강력하지만 **시각적 피드백이 없음**
- "에이전트가 일하는 모습을 지켜보고 싶다"는 감성적 니즈 존재

**핵심 인사이트:** 개발자들은 도구에 대해 **기능적 만족** 외에도 **정서적 유대감**을 갖고 싶어한다. GitHub Copilot의 조종사 아이콘, Notion AI의 애니메이션처럼, 도구의 캐릭터성이 사용자 충성도에 직결된다.

### 2.2 Audience (타깃)

**1차 타깃: AI 에이전트 파워유저**
- Claude Code, Codex CLI 등을 일상적으로 사용하는 개발자
- 에이전트에게 브라우저 작업을 맡기고 결과를 확인하고 싶은 사람
- 기존 쿠마피커 사용자 (자연 마이그레이션)

**2차 타깃: 에이전트 팀 운영자**
- 여러 에이전트를 동시에 운영하며 작업 현황을 모니터링해야 하는 사람
- 토큰 비용 관리가 중요한 사람
- 에이전트별 성과를 비교하고 싶은 사람

**3차 타깃: 개발 커뮤니티**
- 귀여운 동물 캐릭터에 매력을 느끼고 SNS에 공유하는 사람
- 오픈소스 프로젝트에 기여하고 싶은 개발자

### 2.3 Theme (브랜딩 테마)

**브랜드 컨셉: "우리 팀의 동물 친구들이 열심히 일하는 아늑한 사무실"**

**시각적 아이덴티티:**

| 요소 | 방향성 |
|------|--------|
| 전체 톤 | 따뜻한 우드톤 + 파스텔. 숲속 오두막 사무실 느낌 |
| 캐릭터 스타일 | 2.5D 일러스트, 부드러운 라인, 큰 눈, 표정 풍부. OpenAI image gen으로 생성 |
| 가구/인테리어 | 나무 책상, 관엽식물, 커피잔, 화이트보드, 포스트잇 -- 실제 사무실 소품 |
| 컬러 팔레트 | Primary: #5C4033 (따뜻한 브라운), Accent: #FF8C42 (쿠마 오렌지), Sub: #4CAF50 (자연 그린) |
| 폰트 | Pretendard (한글), IBM Plex Sans (영문) -- 기존 쿠마피커와 일관성 유지 |
| 아이콘 | 곰발바닥 모티프 유지. 쿠마피커의 paw 제스처 디자인 자산 재활용 |

**캐릭터 상태 시각화:**

| 상태 | 애니메이션 | 설명 |
|------|------------|------|
| idle | 앉아서 커피 마시기/졸기/스트레칭 | 대기 중 |
| working | 키보드 타이핑/마우스 클릭/모니터 응시 | 작업 수행 중 |
| thinking | 턱 괴고 생각/머리 위 물음표 | 분석/추론 중 |
| completed | 양 팔 벌려 기쁨 표현/하이파이브 | 작업 완료 |
| error | 당황/식은땀/헬프 표시 | 에러 발생 |

### 2.4 Hook (콘텐츠 훅)

**론칭 슬로건 후보:**
1. "Meet your AI team." -- 당신의 AI 팀을 만나보세요
2. "Watch them work." -- 그들이 일하는 모습을 지켜보세요
3. "Your agents deserve an office." -- 당신의 에이전트도 사무실이 필요합니다

**최종 선정: "Meet your AI team. Watch them work."**

**콘텐츠 전략:**

| 채널 | 콘텐츠 | 목적 |
|------|--------|------|
| GitHub README | 가상 사무실 스크린샷 + 애니메이션 GIF | 첫인상, Star 유도 |
| X (Twitter) | 캐릭터 소개 시리즈 ("오늘의 에이전트: 뚝딱이") | 바이럴, 팔로우 |
| YouTube/데모 | 실제 에이전트가 브라우저 작업하는 모습 30초 영상 | 기능 이해 |
| 기술 블로그 | "Playwright API를 실제 브라우저에서 쓰는 법" | SEO, 개발자 유입 |

---

## 3. 뭉치 분석: AARRR 프레임워크 -- 사용자 경험 플로우

### 3.1 Acquisition (획득)

**유입 경로:**

| 경로 | 전략 |
|------|------|
| GitHub 검색 | "browser agent", "AI agent dashboard", "playwright alternative" 키워드 SEO |
| 기존 쿠마피커 사용자 | 쿠마피커 README/npm에 "Kuma Studio로 업그레이드" 배너 |
| SNS 바이럴 | 캐릭터 애니메이션 GIF/영상이 자연 공유됨 |
| 기술 블로그 | "Claude Code에 브라우저 눈을 달아주기" 같은 실용 포스트 |
| 커뮤니티 | Reddit r/programming, Hacker News, 한국 개발 커뮤니티 |

**첫 화면 경험:**
- GitHub README 접속 시: 가상 사무실 스크린샷 + "npx kuma-studio" 원클릭 체험
- 30초 이내에 "이게 뭔지" 파악 가능해야 함

### 3.2 Activation (활성화)

**온보딩 플로우 (First 5 Minutes):**

```
1. npx kuma-studio init
   -> 프로젝트 디렉토리에 설정 파일 생성
   -> 기존 kuma-picker 설정 있으면 자동 감지 & 마이그레이션 제안

2. npm run server:reload
   -> 데몬 서버 시작 (kuma-pickerd 호환, 포트 4312)
   -> 브라우저에서 http://localhost:4312/studio 자동 오픈

3. 첫 화면: 가상 사무실
   -> 쿠마(곰)가 "환영합니다!" 인사
   -> 빈 사무실에 책상 1개 + 쿠마 캐릭터
   -> "브라우저 확장 프로그램을 설치하세요" 가이드 토스트

4. 확장 프로그램 설치
   -> 기존 Kuma Picker 확장 그대로 호환 (manifest 업데이트만)
   -> 설치 완료 시 사무실에 "연결됨!" 애니메이션

5. 첫 번째 픽
   -> 아무 웹페이지에서 요소 픽
   -> 사무실에서 쿠마가 "새 작업이 들어왔어!" 반응
   -> Job Card가 사무실 화이트보드에 나타남
```

**"Aha Moment" 정의:** 사용자가 브라우저에서 요소를 픽하고, 가상 사무실에서 캐릭터가 그 작업에 반응하는 순간. "와, 진짜 일하고 있네!"라는 감탄.

### 3.3 Retention (유지)

**일상 사용 시나리오:**

| 시나리오 | 사용 빈도 | 핵심 가치 |
|----------|-----------|-----------|
| 에이전트 작업 모니터링 | 매일 | "지금 뭐 하고 있지?" 한눈에 파악 |
| 토큰 소모량 확인 | 매일 | 비용 최적화, 예산 관리 |
| 작업 이력 검토 | 주 2~3회 | "이번 주에 뭘 했지?" 회고 |
| 에이스 에이전트 판별 | 주 1회 | 어떤 에이전트/모델이 가장 효율적인지 |
| 사무실 커스터마이징 | 월 1~2회 | 새 가구 배치, 캐릭터 의상 변경 |

**리텐션 강화 요소:**
- **사무실 레벨 시스템**: 작업 완료 횟수에 따라 사무실 업그레이드 (작은 방 -> 넓은 오피스 -> 타워)
- **캐릭터 감정 시스템**: 오래 안 쓰면 캐릭터가 졸거나 심심해함
- **일일 리포트**: "오늘 뚝딱이가 47개 작업을 완료했습니다" 알림

### 3.4 Referral (추천)

**공유 트리거:**
- 가상 사무실 스크린샷을 SNS에 공유하는 기능 ("Share My Office")
- "이번 주의 에이스" 배지를 캐릭터에 붙여서 공유
- README 배지: "Powered by Kuma Studio"

### 3.5 Revenue (수익)

**오픈소스 프로젝트 수익화 (해당 시):**
- 프리미엄 캐릭터 스킨/의상 (OpenAI image gen으로 생성)
- 확장 사무실 테마 (크리스마스 테마, 야경 테마 등)
- 팀 대시보드 (여러 사람이 같은 사무실 모니터링)
- 현재는 수익화 계획 없음 -- 순수 오픈소스

---

## 4. 쭈니 분석: PLG (Product-Led Growth) 프레임워크 -- 성장 전략

### 4.1 기존 쿠마피커 사용자 마이그레이션

**마이그레이션 원칙:**
1. **하위 호환 100%**: 기존 kuma-pickerd CLI 명령어 그대로 동작
2. **점진적 전환**: kuma-studio를 설치해도 kuma-picker가 그대로 작동
3. **자동 감지**: kuma-studio 서버가 기존 kuma-picker 설정 파일 자동 인식

**구체적 호환 매핑:**

| kuma-picker 명령 | kuma-studio 대응 | 비고 |
|-----------------|-----------------|------|
| `kuma-pickerd:serve` | `npm run server:reload` | 동일 포트 4312 |
| `kuma-pickerd:get-selection` | `kuma-studio get-selection` | 데이터 형식 동일 |
| `kuma-pickerd:get-job-card` | `kuma-studio get-job-card` | 데이터 형식 동일 |
| `kuma-pickerd:run` | `kuma-studio run` | Playwright API 동일 |
| `kuma-pickerd:set-job-status` | `kuma-studio set-job-status` | 데이터 형식 동일 |
| (없음) | `kuma-studio dashboard` | 새 기능: 대시보드 웹 UI |
| (없음) | `kuma-studio office` | 새 기능: 가상 사무실 |

**브라우저 확장 프로그램:**
- 기존 Kuma Picker 확장을 그대로 사용 가능
- 향후 "Kuma Studio Extension"으로 리브랜딩하되, 내부 프로토콜은 `kuma-picker:*` 유지
- WebSocket 통신 프로토콜 완전 호환

### 4.2 기술 스택 결정

**서버 사이드 (Node.js):**

| 레이어 | 기존 (kuma-picker) | 신규 (kuma-studio) |
|--------|-------------------|-------------------|
| 런타임 | Node.js >= 20 | Node.js >= 20 (동일) |
| 서버 | 자체 HTTP + WebSocket (ws) | 동일 + 대시보드/사무실용 정적 서빙 |
| 데이터 저장 | 파일시스템 (JSON) | 파일시스템 (JSON) + SQLite (통계) |
| CLI | 자체 파서 (cli-options.mjs) | 동일, 명령어 확장 |
| 테스트 | vitest | vitest (동일) |

**웹 프론트엔드 (대시보드 & 가상 사무실):**

| 항목 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | **React 19** | 쿠마피커 example/next-host가 이미 React 기반, 에코시스템 |
| 번들러 | **Vite** | 빠른 HMR, 가벼운 빌드 |
| 스타일링 | **Tailwind CSS v4** | 빠른 UI 개발, 반응형 |
| 상태관리 | **Zustand** | 경량, 서버 상태와 분리 용이 |
| 서버 통신 | **WebSocket (네이티브)** | 기존 ws 기반 통신과 직접 호환 |
| 차트/그래프 | **Recharts** | React 네이티브, 가벼움 |
| 2D 렌더링 | **Canvas API + CSS Animations** | 캐릭터 애니메이션, 사무실 렌더링 |
| 이미지 생성 | **OpenAI Images API (gpt-image-1)** | 캐릭터/가구 생성 |

**브라우저 확장:**

| 항목 | 선택 | 이유 |
|------|------|------|
| 기반 | 기존 kuma-picker 확장 코드 그대로 | 100% 호환 |
| 변경점 | manifest.json name만 변경 가능 | 최소 변경 |

### 4.3 PLG 성장 루프

```
[발견] GitHub/SNS에서 가상 사무실 스크린샷 발견
  |
  v
[체험] npx kuma-studio -> 즉시 사무실 화면 확인 (Zero Config)
  |
  v
[가치 인식] 브라우저 픽 -> 캐릭터 반응 -> "이거 진짜 일하네!"
  |
  v
[습관화] 매일 대시보드로 작업 현황 확인, 토큰 관리
  |
  v
[공유] 사무실 스크린샷 공유 -> "이거 뭐야?" -> 새 사용자 유입
  |
  v
[기여] 커스텀 캐릭터/테마 PR -> 오픈소스 생태계 확장
```

### 4.4 오픈소스 전략

**라이선스:** Apache-2.0 (기존 kuma-picker와 동일)

**기여 유도 포인트:**
- 새 캐릭터 추가 (OpenAI image gen 프롬프트 + 애니메이션 스프라이트)
- 새 가구/인테리어 아이템
- 대시보드 위젯
- 사무실 테마
- 다국어 지원

---

## 5. RICE 스코어링 -- 기능 우선순위

### 5.1 RICE 기준

| 항목 | 설명 | 스케일 |
|------|------|--------|
| **R**each | 이 기능이 영향을 주는 사용자 비율 (분기 기준) | 0.1 ~ 1.0 |
| **I**mpact | 개별 사용자에게 주는 가치 | 0.5(최소) ~ 3(대규모) |
| **C**onfidence | 이 추정의 확신도 | 0.5(낮음) ~ 1.0(높음) |
| **E**ffort | 개발 노력 (person-weeks) | 낮을수록 좋음 |

**RICE Score = (Reach x Impact x Confidence) / Effort**

### 5.2 기능별 스코어

| # | 기능 | Reach | Impact | Confidence | Effort (pw) | RICE | 우선순위 |
|---|------|-------|--------|------------|-------------|------|----------|
| F01 | 기존 쿠마피커 기능 포팅 (브라우저 픽, job cards, paw, Playwright API) | 1.0 | 3.0 | 1.0 | 2.0 | **1.50** | **P0** |
| F02 | 데몬 서버 통합 (kuma-pickerd 호환 + 스튜디오 서빙) | 1.0 | 2.0 | 1.0 | 1.5 | **1.33** | **P0** |
| F03 | 대시보드 -- 작업 현황 (진행중/완료/에러 카운트, 리스트) | 0.9 | 2.0 | 0.9 | 2.0 | **0.81** | **P0** |
| F04 | 가상 사무실 -- 기본 씬 (배경 + 책상 + 기본 캐릭터 1~2개) | 0.8 | 2.5 | 0.8 | 3.0 | **0.53** | **P1** |
| F05 | 캐릭터 상태 애니메이션 (idle/working/thinking/completed/error) | 0.7 | 2.0 | 0.7 | 3.0 | **0.33** | **P1** |
| F06 | 대시보드 -- 토큰 소모량 그래프 | 0.8 | 2.0 | 0.8 | 1.5 | **0.85** | **P0** |
| F07 | 대시보드 -- 에이스 판별 (가장 효율적인 에이전트/모델 표시) | 0.6 | 1.5 | 0.7 | 1.0 | **0.63** | **P1** |
| F08 | OpenAI Image Gen 통합 -- 캐릭터 생성 | 0.5 | 2.0 | 0.7 | 2.0 | **0.35** | **P1** |
| F09 | OpenAI Image Gen 통합 -- 가구/인테리어 생성 | 0.3 | 1.5 | 0.6 | 2.0 | **0.14** | **P2** |
| F10 | 사무실 레이아웃 에디터 (가구 드래그 배치) | 0.4 | 1.5 | 0.6 | 3.0 | **0.12** | **P2** |
| F11 | CLI 명령어 확장 (kuma-studio init, dashboard, office) | 0.9 | 1.0 | 0.9 | 1.0 | **0.81** | **P0** |
| F12 | WebSocket 실시간 이벤트 스트림 (대시보드 & 사무실 연동) | 0.9 | 2.0 | 0.9 | 1.5 | **1.08** | **P0** |
| F13 | 통계 저장 (SQLite) -- 작업 횟수, 토큰, 시간대별 | 0.7 | 2.0 | 0.8 | 2.0 | **0.56** | **P1** |
| F14 | 사무실 스크린샷 공유 기능 | 0.3 | 1.0 | 0.5 | 1.0 | **0.15** | **P2** |
| F15 | 캐릭터 감정/레벨 시스템 | 0.3 | 1.0 | 0.5 | 2.5 | **0.06** | **P3** |
| F16 | 일일 리포트 알림 | 0.4 | 1.0 | 0.6 | 1.5 | **0.16** | **P2** |

### 5.3 우선순위 요약

| 등급 | 기능들 | 마일스톤 |
|------|--------|----------|
| **P0 (Must Have)** | F01, F02, F03, F06, F11, F12 | M0~M1 |
| **P1 (Should Have)** | F04, F05, F07, F08, F13 | M2 |
| **P2 (Nice to Have)** | F09, F10, F14, F16 | M3 |
| **P3 (Future)** | F15 | M3+ |

---

## 6. 마일스톤 / 로드맵

### M0: Foundation (기반 구축) -- 2주

**목표:** 기존 쿠마피커 기능을 kuma-studio 프로젝트로 옮기고, 모노레포 구조 확립

| 태스크 | 설명 | 담당 |
|--------|------|------|
| M0-1 | 모노레포 초기화 (npm workspaces, tsconfig, vitest) | 뚝딱이 |
| M0-2 | packages/browser-extension: 기존 코드 그대로 복사 | 뚝딱이 |
| M0-3 | packages/server: kuma-pickerd 서버 코드 포팅 | 뚝딱이 |
| M0-4 | packages/server: CLI 명령어 호환 (serve, get-selection 등) | 뚝딱이 |
| M0-5 | 스모크 테스트: 기존 kuma-picker와 동일 동작 확인 | 밤토리 |
| M0-6 | packages/studio-web: Vite + React 프로젝트 초기화 | 뚝딱이 |

**완료 기준:**
- `npm run server:reload`로 서버 시작 가능
- 기존 브라우저 확장이 kuma-studio 서버에 연결 가능
- 기존 CLI 명령어 모두 정상 동작
- `http://localhost:4312/studio`에서 빈 React 앱 표시

### M1: Dashboard (대시보드) -- 3주

**목표:** 에이전트 작업 현황과 토큰 통계를 보여주는 실시간 대시보드

| 태스크 | 설명 | 담당 |
|--------|------|------|
| M1-1 | WebSocket 이벤트 스트림 설계 & 구현 (서버 -> 프론트) | 뚝딱이 |
| M1-2 | 작업 현황 패널: 진행중/완료/에러 카운트 + 리스트 | 뚝딱이 |
| M1-3 | 토큰 소모량 추적 API (서버 사이드) | 뚝딱이 |
| M1-4 | 토큰 소모량 그래프 (Recharts, 시간대별/일별) | 뚝딱이 |
| M1-5 | SQLite 통계 저장소 초기 구현 | 뚝딱이 |
| M1-6 | 에이스 판별 위젯 (가장 많은 작업 완료, 가장 효율적) | 뚝딱이 |
| M1-7 | 대시보드 레이아웃 & 스타일링 (Tailwind) | 뭉치 |
| M1-8 | 실시간 업데이트 테스트 | 밤토리 |

**완료 기준:**
- 대시보드에서 실시간으로 job card 상태 변화 표시
- 토큰 소모량 그래프 동작
- 에이스 에이전트 표시
- 반응형 레이아웃 (모바일 대응은 데스크탑 우선)

### M2: Virtual Office (가상 사무실) -- 4주

**목표:** 동물 캐릭터가 일하는 가상 사무실 화면

| 태스크 | 설명 | 담당 |
|--------|------|------|
| M2-1 | 사무실 배경 씬 렌더링 (Canvas 또는 DOM 기반) | 뚝딱이 |
| M2-2 | 캐릭터 스프라이트 시스템 설계 | 뚝딱이 |
| M2-3 | OpenAI Image Gen 통합 -- 캐릭터 생성 API | 뚝딱이 |
| M2-4 | 기본 캐릭터 에셋 생성 (쿠마팀 12명) | 콩콩이+이미지gen |
| M2-5 | 캐릭터 상태 애니메이션 (idle/working/thinking/completed/error) | 뚝딱이 |
| M2-6 | 에이전트 작업 상태 -> 캐릭터 상태 매핑 로직 | 뚝딱이 |
| M2-7 | 기본 가구/인테리어 에셋 생성 (책상, 의자, 화이트보드) | 콩콩이+이미지gen |
| M2-8 | 사무실 씬에 Job Card 연동 (화이트보드에 카드 표시) | 뚝딱이 |
| M2-9 | 통합 테스트 (대시보드 + 사무실 + 브라우저 확장) | 밤토리 |

**완료 기준:**
- 사무실 화면에서 쿠마팀 캐릭터가 표시됨
- 에이전트가 작업 중이면 해당 캐릭터가 working 애니메이션
- 작업 완료 시 completed 애니메이션
- Job Card가 사무실 화이트보드에 표시

### M3: Polish & Extras (정교화 & 부가기능) -- 3주

**목표:** 사용자 경험 정교화, 부가 기능, 론칭 준비

| 태스크 | 설명 | 담당 |
|--------|------|------|
| M3-1 | OpenAI Image Gen -- 가구/인테리어 사용자 생성 기능 | 뚝딱이 |
| M3-2 | 사무실 레이아웃 에디터 (드래그 앤 드롭) | 뚝딱이 |
| M3-3 | 사무실 스크린샷 공유 기능 | 뚝딱이 |
| M3-4 | 일일 리포트 알림 | 뚝딱이 |
| M3-5 | 온보딩 튜토리얼 (첫 실행 가이드) | 뭉치 |
| M3-6 | README, 문서, 설치 가이드 작성 | 콩콩이 |
| M3-7 | 론칭 콘텐츠 제작 (GIF, 영상, 블로그) | 콩콩이 |
| M3-8 | 전체 QA & 버그 수정 | 밤토리 |
| M3-9 | npm 패키지 퍼블리싱 준비 | 뚝딱이 |

**완료 기준:**
- 모든 P0~P2 기능 구현 완료
- README에 스크린샷/GIF 포함
- npm에 배포 가능 상태
- 온보딩 가이드 완비

---

## 7. 프로젝트 구조

### 7.1 디렉토리 구조

```
kuma-studio/
|
|-- package.json                    # 루트 workspace 정의
|-- tsconfig.json                   # 공통 TypeScript 설정
|-- vitest.config.ts                # 테스트 설정
|-- CLAUDE.md                       # 에이전트 워크플로우 가이드
|-- LICENSE                         # Apache-2.0
|
|-- packages/
|   |
|   |-- browser-extension/          # 브라우저 확장 프로그램 (기존 kuma-picker 그대로)
|   |   |-- manifest.json
|   |   |-- background.js
|   |   |-- popup/
|   |   |   |-- popup.html
|   |   |   |-- popup.css
|   |   |   |-- main.js
|   |   |   |-- state.js
|   |   |   +-- view.js
|   |   |-- content/
|   |   |   |-- bridge.js
|   |   |   |-- job-cards.js
|   |   |   |-- playwright-runtime.js
|   |   |   |-- agent-actions-core.js
|   |   |   |-- agent-actions-gesture-overlay.js
|   |   |   |-- agent-actions-interaction.js
|   |   |   |-- constants.js
|   |   |   |-- page-context.js
|   |   |   |-- interactive.js
|   |   |   |-- runtime-observer.js
|   |   |   +-- runtime-observer-main.js
|   |   |-- shared/
|   |   +-- assets/
|   |       |-- icons/
|   |       +-- gestures/
|   |           +-- kuma-paw-tap.png
|   |
|   |-- server/                     # 데몬 서버 (kuma-pickerd 호환 + 스튜디오 기능)
|   |   |-- src/
|   |   |   |-- index.mjs           # 메인 엔트리
|   |   |   |-- cli.mjs             # CLI 명령어 파서
|   |   |   |-- server.mjs          # HTTP + WebSocket 서버
|   |   |   |-- server-support.mjs
|   |   |   |-- browser-transport.mjs
|   |   |   |-- browser-session-store.mjs
|   |   |   |-- browser-extension-status-store.mjs
|   |   |   |-- dev-selection-store.mjs
|   |   |   |-- job-card-store.mjs
|   |   |   |-- scene-store.mjs
|   |   |   |-- scene-schema.mjs
|   |   |   |-- state-home.mjs
|   |   |   |-- playwright-page-facade.mjs
|   |   |   |-- playwright-runner.mjs
|   |   |   |-- playwright-runner-support.mjs
|   |   |   |-- automation-client.mjs
|   |   |   |-- cli-options.mjs
|   |   |   |-- dev-selection-normalize.mjs
|   |   |   |
|   |   |   |-- studio/             # <-- 새로 추가
|   |   |   |   |-- studio-routes.mjs       # /studio/* 정적 파일 서빙
|   |   |   |   |-- studio-ws-events.mjs    # 대시보드/사무실용 WS 이벤트
|   |   |   |   |-- stats-store.mjs         # SQLite 기반 통계 저장
|   |   |   |   |-- token-tracker.mjs       # 토큰 소모량 추적
|   |   |   |   |-- agent-state.mjs         # 에이전트 상태 관리 (idle/working 등)
|   |   |   |   +-- image-gen.mjs           # OpenAI Image Gen API 래퍼
|   |   |   |
|   |   |   +-- browser-cli.mjs
|   |   +-- package.json
|   |
|   +-- studio-web/                 # 대시보드 & 가상 사무실 웹 프론트엔드
|       |-- package.json
|       |-- vite.config.ts
|       |-- index.html
|       |-- src/
|       |   |-- main.tsx
|       |   |-- App.tsx
|       |   |-- index.css
|       |   |
|       |   |-- stores/             # Zustand 상태관리
|       |   |   |-- use-dashboard-store.ts
|       |   |   |-- use-office-store.ts
|       |   |   +-- use-ws-store.ts
|       |   |
|       |   |-- hooks/
|       |   |   |-- use-websocket.ts
|       |   |   +-- use-agent-state.ts
|       |   |
|       |   |-- components/
|       |   |   |-- layout/
|       |   |   |   |-- Sidebar.tsx
|       |   |   |   |-- Header.tsx
|       |   |   |   +-- Layout.tsx
|       |   |   |
|       |   |   |-- dashboard/
|       |   |   |   |-- DashboardPage.tsx
|       |   |   |   |-- JobStatusPanel.tsx
|       |   |   |   |-- TokenUsageChart.tsx
|       |   |   |   |-- AceAgentWidget.tsx
|       |   |   |   |-- ActivityTimeline.tsx
|       |   |   |   +-- StatsCards.tsx
|       |   |   |
|       |   |   |-- office/
|       |   |   |   |-- OfficePage.tsx
|       |   |   |   |-- OfficeCanvas.tsx
|       |   |   |   |-- Character.tsx
|       |   |   |   |-- CharacterSprite.tsx
|       |   |   |   |-- Furniture.tsx
|       |   |   |   |-- Whiteboard.tsx
|       |   |   |   +-- OfficeBackground.tsx
|       |   |   |
|       |   |   +-- shared/
|       |   |       |-- JobCard.tsx
|       |   |       |-- AgentAvatar.tsx
|       |   |       +-- StatusBadge.tsx
|       |   |
|       |   |-- lib/
|       |   |   |-- ws-client.ts     # WebSocket 클라이언트
|       |   |   |-- api.ts           # REST API 클라이언트
|       |   |   +-- constants.ts
|       |   |
|       |   |-- types/
|       |   |   |-- agent.ts
|       |   |   |-- job-card.ts
|       |   |   |-- office.ts
|       |   |   +-- stats.ts
|       |   |
|       |   +-- assets/
|       |       |-- characters/      # 캐릭터 스프라이트/이미지
|       |       |-- furniture/       # 가구 이미지
|       |       +-- backgrounds/     # 사무실 배경
|       |
|       +-- public/
|           +-- favicon.ico
|
|-- scripts/
|   |-- install.mjs
|   |-- doctor.mjs
|   +-- generate-character.mjs      # OpenAI image gen으로 캐릭터 생성 스크립트
|
|-- docs/
|   +-- PLAN.md                     # 이 문서
|
+-- skills/                         # Claude Code 스킬 정의
```

### 7.2 패키지 의존성 그래프

```
browser-extension (Manifest V3, 순수 JS)
       |
       | WebSocket (ws://localhost:4312)
       v
    server (Node.js)
       |
       |-- kuma-pickerd 호환 기능 (기존 코드)
       |-- studio/ (새 기능: 통계, 이벤트, 이미지 생성)
       |-- 정적 파일 서빙 (studio-web 빌드 결과물)
       |
       | WebSocket (studio 이벤트 스트림)
       v
  studio-web (React + Vite)
       |
       |-- Dashboard (Recharts, 실시간 통계)
       +-- Virtual Office (Canvas/DOM, 캐릭터 애니메이션)
```

### 7.3 핵심 데이터 흐름

```
[브라우저 확장]
     |
     | 1. 사용자가 요소 픽 / 에이전트가 Playwright 명령 실행
     v
[server: browser-transport]
     |
     | 2. Job Card 생성/업데이트
     | 3. 통계 기록 (stats-store)
     v
[server: studio-ws-events]
     |
     | 4. WebSocket 이벤트 브로드캐스트
     v
[studio-web: WebSocket 클라이언트]
     |
     |-- 5a. Dashboard 업데이트 (job 리스트, 토큰 그래프)
     +-- 5b. Office 업데이트 (캐릭터 상태 변경 -> 애니메이션)
```

### 7.4 WebSocket 이벤트 프로토콜 (신규)

기존 `kuma-picker:*` 이벤트에 추가하여 `kuma-studio:*` 이벤트를 정의한다:

```typescript
// 서버 -> 프론트엔드 (대시보드/사무실)
interface StudioEvent {
  type: "kuma-studio:event";
  event:
    | { kind: "job-card-update"; card: JobCard }
    | { kind: "agent-state-change"; agentId: string; state: AgentState }
    | { kind: "token-usage"; agentId: string; tokens: number; model: string }
    | { kind: "stats-snapshot"; stats: DashboardStats }
    | { kind: "office-scene-update"; scene: OfficeScene };
}

type AgentState = "idle" | "working" | "thinking" | "completed" | "error";

interface DashboardStats {
  totalJobs: number;
  completedJobs: number;
  inProgressJobs: number;
  errorJobs: number;
  totalTokens: number;
  tokensByModel: Record<string, number>;
  tokensByAgent: Record<string, number>;
  aceAgent: { id: string; name: string; score: number } | null;
}

interface OfficeScene {
  characters: OfficeCharacter[];
  furniture: OfficeFurniture[];
  background: string;
}

interface OfficeCharacter {
  id: string;
  name: string;           // 예: "뚝딱이"
  animal: string;         // 예: "beaver"
  role: string;           // 예: "개발자"
  team: string;           // 예: "개발팀"
  state: AgentState;
  position: { x: number; y: number };
  spriteSheet: string;    // 스프라이트 시트 URL
}

interface OfficeFurniture {
  id: string;
  type: string;           // "desk" | "chair" | "whiteboard" | "plant" | ...
  position: { x: number; y: number };
  imageUrl: string;
}
```

### 7.5 주요 package.json 스크립트

```json
{
  "scripts": {
    "server:reload": "bash ./scripts/server-reload.sh",
    "kuma-studio:get-selection": "node ./packages/server/src/cli.mjs get-selection",
    "kuma-studio:get-job-card": "node ./packages/server/src/cli.mjs get-job-card",
    "kuma-studio:get-extension-status": "node ./packages/server/src/cli.mjs get-extension-status",
    "kuma-studio:get-browser-session": "node ./packages/server/src/cli.mjs get-browser-session",
    "kuma-studio:run": "node ./packages/server/src/cli.mjs run",
    "kuma-studio:set-job-status": "node ./packages/server/src/cli.mjs set-job-status",
    "kuma-studio:dashboard": "open http://localhost:4312/studio",
    "dev:studio": "npm run dev --workspace=studio-web",
    "build:studio": "npm run build --workspace=studio-web",
    "test": "vitest run --passWithNoTests",
    "skill:install": "node ./scripts/install.mjs",
    "skill:doctor": "node ./scripts/doctor.mjs"
  }
}
```

---

## 8. 기술 상세: 핵심 모듈 설계

### 8.1 통계 저장소 (stats-store.mjs)

SQLite를 사용하여 시계열 통계를 저장한다. better-sqlite3 패키지 사용.

**테이블 설계:**

```sql
-- 작업 이벤트 로그
CREATE TABLE job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  session_id TEXT,
  agent_id TEXT,
  status TEXT NOT NULL,           -- queued, in_progress, completed, error
  message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  tokens_used INTEGER DEFAULT 0,
  model TEXT
);

-- 토큰 소모량 (분 단위 집계)
CREATE TABLE token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  recorded_at TEXT DEFAULT (datetime('now'))
);

-- 에이전트 세션
CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  total_jobs INTEGER DEFAULT 0,
  completed_jobs INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0
);
```

### 8.2 에이전트 상태 관리 (agent-state.mjs)

에이전트의 현재 상태를 인메모리로 관리하고, 상태 변경 시 WebSocket으로 브로드캐스트한다.

```javascript
// 상태 전이 규칙
const STATE_TRANSITIONS = {
  idle:      ["working", "thinking"],
  working:   ["thinking", "completed", "error", "idle"],
  thinking:  ["working", "completed", "error", "idle"],
  completed: ["idle", "working"],
  error:     ["idle", "working"],
};

// Job Card 상태 -> 에이전트 상태 매핑
function mapJobStatusToAgentState(jobStatus) {
  switch (jobStatus) {
    case "in_progress": return "working";
    case "completed":   return "completed";
    case "error":       return "error";
    default:            return "idle";
  }
}
```

### 8.3 OpenAI Image Gen 통합 (image-gen.mjs)

```javascript
// 캐릭터 생성 프롬프트 템플릿
const CHARACTER_PROMPT_TEMPLATE = `
A cute 2.5D illustration of a {animal} character named {name},
working as a {role} in a cozy woodland office.
Style: soft lines, warm colors, large expressive eyes, chibi proportions.
The character is {state_description}.
Background: transparent or simple wooden desk.
Aspect ratio: 1:1, 512x512px.
`;

// 가구 생성 프롬프트 템플릿
const FURNITURE_PROMPT_TEMPLATE = `
A {furniture_type} for a cozy woodland animal office.
Style: warm wood tones, pastel accents, 2.5D isometric view.
Simple, clean design suitable for a pixel-art-inspired UI.
Background: transparent.
Aspect ratio: 1:1, 256x256px.
`;
```

### 8.4 캐릭터 스프라이트 시스템

각 캐릭터는 상태별로 다른 스프라이트/애니메이션을 가진다:

```
assets/characters/{character-id}/
  |-- idle.png          (또는 idle-spritesheet.png)
  |-- working.png
  |-- thinking.png
  |-- completed.png
  |-- error.png
  +-- meta.json         (프레임 정보, 애니메이션 속도)
```

**meta.json 예시:**
```json
{
  "id": "tookdaki",
  "name": "뚝딱이",
  "animal": "beaver",
  "team": "dev",
  "states": {
    "idle": {
      "frames": 4,
      "frameDuration": 500,
      "loop": true
    },
    "working": {
      "frames": 6,
      "frameDuration": 200,
      "loop": true
    },
    "thinking": {
      "frames": 3,
      "frameDuration": 800,
      "loop": true
    },
    "completed": {
      "frames": 5,
      "frameDuration": 150,
      "loop": false
    },
    "error": {
      "frames": 3,
      "frameDuration": 400,
      "loop": true
    }
  }
}
```

---

## 9. OKR (Objectives and Key Results) -- 2026 Q2

### Objective 1: 쿠마 스튜디오를 개발자 커뮤니티에서 인지도 있는 에이전트 시각화 도구로 론칭한다

| Key Result | 지표 | 목표 |
|------------|------|------|
| KR1.1 | M0~M2 마일스톤 완료 | 2026-05-31까지 |
| KR1.2 | GitHub Star 수 | 200+ (론칭 후 1개월) |
| KR1.3 | npm weekly downloads | 100+ (론칭 후 1개월) |

### Objective 2: 기존 쿠마피커 사용자의 원활한 마이그레이션을 보장한다

| Key Result | 지표 | 목표 |
|------------|------|------|
| KR2.1 | 기존 CLI 명령어 호환율 | 100% |
| KR2.2 | 기존 브라우저 확장 호환 | 변경 없이 연결 가능 |
| KR2.3 | 마이그레이션 가이드 제공 | M0 완료 시 |

### Objective 3: 가상 사무실이 "에이전트가 일하는 모습"을 직관적으로 전달한다

| Key Result | 지표 | 목표 |
|------------|------|------|
| KR3.1 | 캐릭터 12종 에셋 완성 | M2 완료 시 |
| KR3.2 | 상태 애니메이션 5종 구현 (idle/working/thinking/completed/error) | M2 완료 시 |
| KR3.3 | Job Card -> 캐릭터 상태 실시간 연동 | 1초 이내 반영 |

---

## 10. 리스크 & 대응

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| OpenAI Image Gen API 비용이 예상보다 높음 | 중 | 중 | 기본 캐릭터 에셋을 미리 생성해두고, 사용자 커스텀만 API 호출 |
| 캐릭터 애니메이션 성능 문제 | 중 | 중 | CSS Animation 우선, Canvas 폴백. requestAnimationFrame 최적화 |
| 기존 쿠마피커와의 호환성 깨짐 | 낮 | 높 | M0에서 스모크 테스트 철저히. 프로토콜 변경 시 버전 헤더 추가 |
| SQLite 의존성으로 설치 복잡도 증가 | 중 | 중 | better-sqlite3는 prebuild 제공. 실패 시 JSON 파일 폴백 |
| WebSocket 연결 불안정 | 낮 | 중 | 자동 재연결 로직 (지수 백오프). 연결 상태 UI 표시 |

---

## 11. 기술적 결정 사항 (ADR 요약)

### ADR-001: 가상 사무실 렌더링 방식

**결정:** DOM + CSS Animations (Canvas 아님)

**이유:**
- 캐릭터 수가 최대 12개로 적어 DOM 성능 문제 없음
- CSS Animations가 하드웨어 가속을 받아 부드러움
- React 컴포넌트로 자연스럽게 관리 가능
- 접근성(a11y) 지원 용이
- Canvas는 복잡도 대비 이득이 적음 (게임 수준 렌더링 불필요)

### ADR-002: 통계 저장소

**결정:** SQLite (better-sqlite3)

**이유:**
- 시계열 데이터 쿼리에 적합 (GROUP BY, 날짜 함수)
- 파일 기반이라 별도 DB 서버 불필요
- JSON 파일 대비 대량 데이터 처리 성능 우수
- Node.js 에코시스템에서 안정적 (better-sqlite3 prebuild)
- 설치 실패 시 JSON 파일 폴백 구현

### ADR-003: 모노레포 구조

**결정:** npm workspaces (Turborepo/nx 미사용)

**이유:**
- 기존 kuma-picker가 npm workspaces 사용 중
- 패키지 수가 3개로 적어 복잡한 빌드 오케스트레이터 불필요
- 설정 최소화, 진입 장벽 낮춤

### ADR-004: 브라우저 확장 프로그램 관계

**결정:** 기존 kuma-picker 확장을 그대로 사용, 코드 복사 (fork)

**이유:**
- kuma-picker 확장은 순수 JS (빌드 단계 없음)
- 프로토콜 수준에서 `kuma-picker:*` 메시지 타입 유지
- 향후 리브랜딩 시 manifest.json name만 변경
- 독립 배포 가능 (Chrome Web Store)

---

## 12. 성공 지표

| 지표 | M0 완료 시 | M1 완료 시 | M2 완료 시 | M3 완료 시 |
|------|-----------|-----------|-----------|-----------|
| 기존 CLI 호환율 | 100% | 100% | 100% | 100% |
| 대시보드 위젯 수 | - | 4+ | 4+ | 6+ |
| 캐릭터 에셋 수 | 0 | 0 | 12 (전체 팀) | 12+ |
| 애니메이션 상태 수 | 0 | 0 | 5 | 5 |
| 실시간 이벤트 지연 | - | < 500ms | < 500ms | < 200ms |
| 테스트 커버리지 | 기존 수준 | 60%+ | 70%+ | 80%+ |

---

## 부록 A: 쿠마팀 캐릭터 이미지 생성 프롬프트 가이드

OpenAI gpt-image-1 API로 캐릭터를 생성할 때 사용할 표준 프롬프트:

```
[공통 스타일 프리픽스]
"A cute 2.5D chibi-style animal character illustration.
Soft rounded lines, warm color palette (browns, oranges, greens, cream).
Large expressive eyes, friendly expression.
Wearing a small {team_color} scarf or badge.
Clean background, suitable for UI sprite.
512x512px, high quality."

[팀 컬러]
- 분석팀 (fox): 보라색/라벤더
- 개발팀 (wolf): 파란색/네이비
- 전략팀 (deer): 녹색/에메랄드
- 총괄 (bear): 주황색/골드

[상태별 포즈 가이드]
- idle: 편안하게 앉아있거나 커피 들고 있는 모습
- working: 노트북 앞에서 타이핑하거나 서류를 보는 모습
- thinking: 턱을 괴거나 하늘을 올려다보는 모습
- completed: 양 팔을 들거나 v 사인하는 모습
- error: 당황한 표정, 양 손을 들어올린 모습
```

---

## 부록 B: 기존 쿠마피커 코드 재사용 매핑

| 기존 파일 (kuma-picker) | 재사용 방식 | 변경 필요 사항 |
|------------------------|------------|---------------|
| packages/browser-extension/* | 전체 복사 | manifest name 변경 가능 (선택) |
| tools/kuma-pickerd/main.mjs | 포팅 -> packages/server/src/ | import 경로 수정 |
| tools/kuma-pickerd/lib/*.mjs | 포팅 -> packages/server/src/ | import 경로 수정 |
| tools/kuma-pickerd/lib/server.mjs | 확장 | studio-routes.mjs 마운트 추가 |
| tools/kuma-pickerd/lib/browser-transport.mjs | 확장 | studio 이벤트 브로드캐스트 훅 추가 |
| tools/kuma-pickerd/lib/job-card-store.mjs | 확장 | 통계 기록 훅 추가 |
| scripts/install.mjs | 복사 & 수정 | kuma-studio용 경로/이름 변경 |
| scripts/doctor.mjs | 복사 & 수정 | kuma-studio용 체크 항목 추가 |

---

*이 기획서는 노을이(전략팀 디렉터)가 콩콩이(C.A.T.H 분석), 뭉치(AARRR 분석), 쭈니(PLG 분석)의 프레임워크 결과를 통합하고, RICE 스코어링으로 우선순위를 확정한 문서입니다. 이 문서를 기반으로 M0부터 개발에 착수할 수 있습니다.*
