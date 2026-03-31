export type AgentState = "idle" | "working" | "thinking" | "completed" | "error";

export interface Agent {
  id: string;
  name: string;
  animal: string;
  role: string;
  team: string;
  state: AgentState;
}

export const KUMA_TEAM: Agent[] = [
  { id: "kuma", name: "Kuma", animal: "bear", role: "Leader", team: "management", state: "idle" },
  { id: "rumi", name: "Rumi", animal: "fox", role: "Team Lead", team: "analytics", state: "idle" },
  { id: "darami", name: "Darami", animal: "chipmunk", role: "SNS/Marketing", team: "analytics", state: "idle" },
  { id: "buri", name: "Buri", animal: "eagle", role: "Market Analysis", team: "analytics", state: "idle" },
  { id: "howl", name: "Howl", animal: "wolf", role: "Operator", team: "dev", state: "idle" },
  { id: "tookdaki", name: "Tookdaki", animal: "beaver", role: "Developer", team: "dev", state: "idle" },
  { id: "saemi", name: "Saemi", animal: "parrot", role: "Critic", team: "dev", state: "idle" },
  { id: "bamdori", name: "Bamdori", animal: "hedgehog", role: "QA", team: "dev", state: "idle" },
  { id: "noeuri", name: "Noeuri", animal: "deer", role: "Director", team: "strategy", state: "idle" },
  { id: "kongkongi", name: "Kongkongi", animal: "rabbit", role: "Content/SNS", team: "strategy", state: "idle" },
  { id: "moongchi", name: "Moongchi", animal: "cat", role: "UX/Growth", team: "strategy", state: "idle" },
  { id: "jjooni", name: "Jjooni", animal: "hamster", role: "Business", team: "strategy", state: "idle" },
];
