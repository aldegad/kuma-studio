# /strategy-team — 🦌 전략팀 호출

기획, 전략, 방향성 논의를 위임하는 스킬.

## 팀 구조

| 닉네임 | 동물 | 모델 | 역할 | 보유 스킬 |
|------|------|------|------|----------|
| 🦌 노을이 | 사슴 (deer) | `claude-opus-4-6` | 디렉터. 전략 방향 총괄 | 제품 기획, 로드맵, 아키텍처 방향 |
| 🐰 콩콩이 | 토끼 (rabbit) | `claude-opus-4-6` | 콘텐츠/SNS 전략 | 콘텐츠 기획, SNS 마케팅, 브랜딩 |
| 🐹 뭉치 | 햄스터 (hamster) | `claude-opus-4-6` | UX/그로스 전략 | 유저 리서치, UX 설계, 그로스 해킹 |
| 🐝 쭈니 | 꿀벌 (bee) | `claude-opus-4-6` | 비즈니스 전략 | 비즈니스 모델, 수익화, 파트너십 |

## 위임 대상
- 제품 기획 / 기능 우선순위
- 기술 전략 / 아키텍처 방향
- 사용자 경험 설계
- 비즈니스 로직 설계
- 프로젝트 로드맵
- 콘텐츠/마케팅 전략
- 수익화 / 그로스 전략

## 호출 방법

```
# 노을이 — 전략 총괄
Agent(model: "opus", prompt: "전략/기획 내용", run_in_background: true)

# 콩콩이 — 콘텐츠/SNS
Agent(model: "opus", prompt: "콘텐츠 전략 내용", run_in_background: true)

# 뭉치 — UX/그로스
Agent(model: "opus", prompt: "UX/그로스 전략 내용", run_in_background: true)

# 쭈니 — 비즈니스
Agent(model: "opus", prompt: "비즈니스 전략 내용", run_in_background: true)
```
