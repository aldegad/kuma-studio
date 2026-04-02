export type AgentState = "idle" | "working" | "thinking" | "completed" | "error";
export type NodeType = "session" | "team" | "worker";
export type TeamSkillId = "kuma" | "dev-team" | "analytics-team" | "strategy-team";
export type InstalledSkillId =
  | "codex-autoresearch"
  | "gateproof-full-security-check"
  | "imagegen"
  | "kuma-picker";
export type CapabilitySkillId = "codex:rescue" | "nano-banana" | "security-threat-intel";
export type AgentSkillId =
  | TeamSkillId
  | InstalledSkillId
  | CapabilitySkillId
  | `codex-autoresearch:${string}`;

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
  nodeType?: NodeType;
  parentId?: string;
  model?: string;
  emoji?: string;
  image?: string;
  skills?: AgentSkillId[];
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
  // ── 총괄 (session layer) ──
  { id: "kuma", name: "Kuma", nameKo: "쿠마", animal: "bear", animalKo: "곰", role: "Leader", roleKo: "총괄 리더", team: "management", teamKo: "총괄", state: "idle", nodeType: "session", emoji: "🐻", model: "claude-opus-4-6", image: "/characters/kuma.jpg", skills: ["kuma", "dev-team", "analytics-team", "strategy-team"] },
  // ── 개발팀 (team layer) ──
  { id: "howl", name: "Howl", nameKo: "하울", animal: "wolf", animalKo: "늑대", role: "Operator", roleKo: "오케스트레이터", team: "dev", teamKo: "개발팀", state: "idle", nodeType: "team", parentId: "kuma", emoji: "🐺", model: "claude-opus-4-6", image: "/characters/howl.jpg", skills: ["dev-team", "codex:rescue"] },
  { id: "tookdaki", name: "Tookdaki", nameKo: "뚝딱이", animal: "beaver", animalKo: "비버", role: "Developer", roleKo: "개발자", team: "dev", teamKo: "개발팀", state: "idle", nodeType: "worker", parentId: "howl", emoji: "🔨", model: "gpt-5.4-codex", image: "/characters/ttukddak.jpg", skills: ["codex:rescue", "codex-autoresearch:fix", "codex-autoresearch:debug"] },
  { id: "saemi", name: "Saemi", nameKo: "새미", animal: "eagle", animalKo: "독수리", role: "Critic", roleKo: "비평가/리뷰어", team: "dev", teamKo: "개발팀", state: "idle", nodeType: "worker", parentId: "howl", emoji: "🦅", model: "gpt-5.4-codex", image: "/characters/saemi.jpg", skills: ["codex:rescue", "security-threat-intel", "gateproof-full-security-check", "codex-autoresearch:security"] },
  { id: "koon", name: "Koon", nameKo: "쿤", animal: "raccoon", animalKo: "너구리", role: "Publisher", roleKo: "퍼블리셔", team: "dev", teamKo: "개발팀", state: "idle", nodeType: "worker", parentId: "howl", emoji: "🦝", model: "claude-opus-4-6", image: "/characters/koon.jpg", skills: ["nano-banana", "imagegen"] },
  { id: "bamdori", name: "Bamdori", nameKo: "밤돌이", animal: "hedgehog", animalKo: "고슴도치", role: "QA", roleKo: "빌드/배포/검증", team: "dev", teamKo: "개발팀", state: "idle", nodeType: "worker", parentId: "howl", emoji: "🦔", model: "claude-sonnet-4-6", image: "/characters/bamdori.jpg", skills: ["kuma-picker", "codex-autoresearch:ship"] },
  // ── 분석팀 (team layer) ──
  { id: "rumi", name: "Rumi", nameKo: "루미", animal: "fox", animalKo: "여우", role: "Team Lead", roleKo: "분석팀장", team: "analytics", teamKo: "분석팀", state: "idle", nodeType: "team", parentId: "kuma", emoji: "🦊", model: "claude-opus-4-6", image: "/characters/lumi.jpg", skills: ["analytics-team"] },
  { id: "darami", name: "Darami", nameKo: "다람이", animal: "squirrel", animalKo: "다람쥐", role: "Code Analyst", roleKo: "코드 분석", team: "analytics", teamKo: "분석팀", state: "idle", nodeType: "worker", parentId: "rumi", emoji: "🐿️", model: "gpt-5.4-codex", image: "/characters/darami.jpg", skills: ["codex:rescue", "codex-autoresearch:learn"] },
  { id: "buri", name: "Buri", nameKo: "부리", animal: "owl", animalKo: "부엉이", role: "Researcher", roleKo: "외부 리서치", team: "analytics", teamKo: "분석팀", state: "idle", nodeType: "worker", parentId: "rumi", emoji: "🦉", model: "claude-sonnet-4-6", image: "/characters/buri.jpg", skills: ["codex-autoresearch", "codex-autoresearch:security"] },
  // ── 전략팀 (team layer) ──
  { id: "noeuri", name: "Noeuri", nameKo: "노을이", animal: "deer", animalKo: "사슴", role: "Director", roleKo: "전략 디렉터", team: "strategy", teamKo: "전략팀", state: "idle", nodeType: "team", parentId: "kuma", emoji: "🦌", model: "claude-opus-4-6", image: "/characters/noeul.jpg", skills: ["strategy-team", "codex-autoresearch:plan", "codex-autoresearch:reason"] },
  { id: "kongkongi", name: "Kongkongi", nameKo: "콩콩이", animal: "rabbit", animalKo: "토끼", role: "Content/SNS", roleKo: "콘텐츠/SNS", team: "strategy", teamKo: "전략팀", state: "idle", nodeType: "worker", parentId: "noeuri", emoji: "🐰", model: "claude-opus-4-6", image: "/characters/kongkong.jpg", skills: ["codex-autoresearch:ship", "nano-banana"] },
  { id: "moongchi", name: "Moongchi", nameKo: "뭉치", animal: "hamster", animalKo: "햄스터", role: "UX/Growth", roleKo: "UX/그로스", team: "strategy", teamKo: "전략팀", state: "idle", nodeType: "worker", parentId: "noeuri", emoji: "🐹", model: "claude-opus-4-6", image: "/characters/mungchi.jpg", skills: ["codex-autoresearch:scenario", "codex-autoresearch:predict"] },
  { id: "jjooni", name: "Jjooni", nameKo: "쭈니", animal: "bee", animalKo: "꿀벌", role: "Business", roleKo: "비즈니스", team: "strategy", teamKo: "전략팀", state: "idle", nodeType: "worker", parentId: "noeuri", emoji: "🐝", model: "claude-opus-4-6", image: "/characters/jjooni.jpg", skills: ["codex-autoresearch:predict", "codex-autoresearch:reason"] },
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
