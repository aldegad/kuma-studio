export type AgentState = "idle" | "working" | "thinking" | "completed" | "error";

export interface Agent {
  id: string;
  name: string;
  nameKo: string;
  animal: string;
  animalKo: string;
  role: string;
  roleKo: string;
  team: string;
  teamKo: string;
  state: AgentState;
  model?: string;
  emoji?: string;
  image?: string;
  skills?: string[];
}

export interface TeamMetadataMember {
  id: string;
  emoji: string;
  displayName: string;
  model: string;
  role: string;
}

export interface TeamMetadataTeam {
  name: string;
  emoji: string;
  members: TeamMetadataMember[];
}

export interface TeamMetadataResponse {
  teams: TeamMetadataTeam[];
}

export const KUMA_TEAM: Agent[] = [
  // ── 총괄 ──
  { id: "kuma", name: "Kuma", nameKo: "쿠마", animal: "bear", animalKo: "곰", role: "Leader", roleKo: "총괄 리더", team: "management", teamKo: "총괄", state: "idle", emoji: "🐻", model: "claude-opus-4-6", image: "/characters/kuma.jpg", skills: ["팀 조율", "제품 총괄"] },
  // ── 개발팀 ──
  { id: "howl", name: "Howl", nameKo: "하울", animal: "wolf", animalKo: "늑대", role: "Operator", roleKo: "오케스트레이터", team: "dev", teamKo: "개발팀", state: "idle", emoji: "🐺", model: "claude-opus-4-6", image: "/characters/howl.jpg", skills: ["품앗이 오케스트레이션", "Bash 게이트 검증"] },
  { id: "tookdaki", name: "Tookdaki", nameKo: "뚝딱이", animal: "beaver", animalKo: "비버", role: "Developer", roleKo: "개발자", team: "dev", teamKo: "개발팀", state: "idle", emoji: "🔨", model: "gpt-5.4-codex", image: "/characters/ttukddak.jpg", skills: ["코드 구현", "버그 수정", "리팩토링"] },
  { id: "saemi", name: "Saemi", nameKo: "새미", animal: "eagle", animalKo: "독수리", role: "Critic", roleKo: "비평가/리뷰어", team: "dev", teamKo: "개발팀", state: "idle", emoji: "🦅", model: "gpt-5.4-codex", image: "/characters/saemi.jpg", skills: ["코드 리뷰", "품질 분석"] },
  { id: "koon", name: "Koon", nameKo: "쿤", animal: "raccoon", animalKo: "너구리", role: "Publisher", roleKo: "퍼블리셔", team: "dev", teamKo: "개발팀", state: "idle", emoji: "🦝", model: "claude-opus-4-6", image: "/characters/koon.jpg", skills: ["frontend-design", "나노바나나"] },
  { id: "bamdori", name: "Bamdori", nameKo: "밤돌이", animal: "hedgehog", animalKo: "고슴도치", role: "QA", roleKo: "빌드/배포/검증", team: "dev", teamKo: "개발팀", state: "idle", emoji: "🦔", model: "claude-sonnet-4-6", image: "/characters/bamdori.jpg", skills: ["Kuma Picker", "빌드/배포", "디버깅"] },
  // ── 분석팀 ──
  { id: "rumi", name: "Rumi", nameKo: "루미", animal: "fox", animalKo: "여우", role: "Team Lead", roleKo: "분석팀장", team: "analytics", teamKo: "분석팀", state: "idle", emoji: "🦊", model: "claude-opus-4-6", image: "/characters/lumi.jpg", skills: ["분석 오케스트레이션", "질문 설계"] },
  { id: "darami", name: "Darami", nameKo: "다람이", animal: "squirrel", animalKo: "다람쥐", role: "Code Analyst", roleKo: "코드 분석", team: "analytics", teamKo: "분석팀", state: "idle", emoji: "🐿️", model: "gpt-5.4-codex", image: "/characters/darami.jpg", skills: ["코드 분석", "구조 파악", "의존성 추적"] },
  { id: "buri", name: "Buri", nameKo: "부리", animal: "owl", animalKo: "부엉이", role: "Researcher", roleKo: "외부 리서치", team: "analytics", teamKo: "분석팀", state: "idle", emoji: "🦉", model: "claude-sonnet-4-6", image: "/characters/buri.jpg", skills: ["웹 검색", "시장 리서치"] },
  // ── 전략팀 ──
  { id: "noeuri", name: "Noeuri", nameKo: "노을이", animal: "deer", animalKo: "사슴", role: "Director", roleKo: "전략 디렉터", team: "strategy", teamKo: "전략팀", state: "idle", emoji: "🦌", model: "claude-opus-4-6", image: "/characters/noeul.jpg", skills: ["제품 기획", "로드맵", "아키텍처 방향"] },
  { id: "kongkongi", name: "Kongkongi", nameKo: "콩콩이", animal: "rabbit", animalKo: "토끼", role: "Content/SNS", roleKo: "콘텐츠/SNS", team: "strategy", teamKo: "전략팀", state: "idle", emoji: "🐰", model: "claude-opus-4-6", image: "/characters/kongkong.jpg", skills: ["콘텐츠 기획", "SNS 마케팅", "브랜딩"] },
  { id: "moongchi", name: "Moongchi", nameKo: "뭉치", animal: "hamster", animalKo: "햄스터", role: "UX/Growth", roleKo: "UX/그로스", team: "strategy", teamKo: "전략팀", state: "idle", emoji: "🐹", model: "claude-opus-4-6", image: "/characters/mungchi.jpg", skills: ["유저 리서치", "UX 설계", "그로스 해킹"] },
  { id: "jjooni", name: "Jjooni", nameKo: "쭈니", animal: "bee", animalKo: "꿀벌", role: "Business", roleKo: "비즈니스", team: "strategy", teamKo: "전략팀", state: "idle", emoji: "🐝", model: "claude-opus-4-6", image: "/characters/jjooni.jpg", skills: ["비즈니스 모델", "수익화", "파트너십"] },
];

const AGENT_INDEX_BY_ID = new Map(KUMA_TEAM.map((agent, index) => [agent.id, index]));

export function applyTeamMetadata(metadata: TeamMetadataResponse): Agent[] {
  for (const team of metadata.teams) {
    for (const member of team.members) {
      const index = AGENT_INDEX_BY_ID.get(member.id);
      if (index == null) continue;

      const current = KUMA_TEAM[index];
      KUMA_TEAM[index] = {
        ...current,
        nameKo: member.displayName,
        roleKo: member.role,
        model: member.model,
        emoji: member.emoji,
      };
    }
  }
  return KUMA_TEAM;
}
