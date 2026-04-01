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
  { id: "kuma", name: "Kuma", nameKo: "쿠마", animal: "bear", animalKo: "곰", role: "Leader", roleKo: "총괄 리더", team: "management", teamKo: "총괄", state: "idle", model: "claude-opus-4-6", image: "/characters/kuma.jpg" },
  { id: "rumi", name: "Rumi", nameKo: "루미", animal: "fox", animalKo: "여우", role: "Team Lead", roleKo: "분석팀장", team: "analytics", teamKo: "분석팀", state: "idle", model: "claude-opus-4-6", image: "/characters/lumi.jpg" },
  { id: "darami", name: "Darami", nameKo: "다람이", animal: "chipmunk", animalKo: "다람쥐", role: "SNS/Marketing", roleKo: "SNS/마케팅 분석", team: "analytics", teamKo: "분석팀", state: "idle", model: "gpt-5.4-codex", image: "/characters/darami.jpg" },
  { id: "buri", name: "Buri", nameKo: "부리", animal: "eagle", animalKo: "독수리", role: "Market Analysis", roleKo: "시장 분석", team: "analytics", teamKo: "분석팀", state: "idle", model: "claude-sonnet-4-6", image: "/characters/buri.jpg" },
  { id: "howl", name: "Howl", nameKo: "하울", animal: "wolf", animalKo: "늑대", role: "Operator", roleKo: "오퍼레이터", team: "dev", teamKo: "개발팀", state: "idle", model: "claude-opus-4-6", image: "/characters/howl.jpg" },
  { id: "tookdaki", name: "Tookdaki", nameKo: "뚝딱이", animal: "beaver", animalKo: "비버", role: "Developer", roleKo: "개발자", team: "dev", teamKo: "개발팀", state: "idle", model: "gpt-5.4-codex", image: "/characters/ttukddak.jpg" },
  { id: "saemi", name: "Saemi", nameKo: "새미", animal: "parrot", animalKo: "앵무새", role: "Critic", roleKo: "비평가", team: "dev", teamKo: "개발팀", state: "idle", model: "gpt-5.4-codex", image: "/characters/saemi.jpg" },
  { id: "bamdori", name: "Bamdori", nameKo: "밤돌이", animal: "hedgehog", animalKo: "고슴도치", role: "QA", roleKo: "QA 담당", team: "dev", teamKo: "개발팀", state: "idle", emoji: "🦔", model: "claude-sonnet-4-6", image: "/characters/bamdori.jpg" },
  { id: "koon", name: "Koon", nameKo: "쿤", animal: "raccoon", animalKo: "너구리", role: "Publisher", roleKo: "퍼블리셔", team: "dev", teamKo: "개발팀", state: "idle", emoji: "🦝", model: "claude-opus-4-6", image: "/characters/koon.jpg" },
  { id: "noeuri", name: "Noeuri", nameKo: "노을이", animal: "deer", animalKo: "사슴", role: "Director", roleKo: "전략 디렉터", team: "strategy", teamKo: "전략팀", state: "idle", model: "claude-opus-4-6", image: "/characters/noeul.jpg" },
  { id: "kongkongi", name: "Kongkongi", nameKo: "콩콩이", animal: "rabbit", animalKo: "토끼", role: "Content/SNS", roleKo: "콘텐츠/SNS", team: "strategy", teamKo: "전략팀", state: "idle", model: "claude-opus-4-6", image: "/characters/kongkong.jpg" },
  { id: "moongchi", name: "Moongchi", nameKo: "뭉치", animal: "cat", animalKo: "고양이", role: "UX/Growth", roleKo: "UX/그로스", team: "strategy", teamKo: "전략팀", state: "idle", emoji: "🐹", model: "claude-opus-4-6", image: "/characters/mungchi.jpg" },
  { id: "jjooni", name: "Jjooni", nameKo: "쭈니", animal: "hamster", animalKo: "햄스터", role: "Business", roleKo: "비즈니스", team: "strategy", teamKo: "전략팀", state: "idle", model: "claude-opus-4-6", image: "/characters/jjooni.jpg" },
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
