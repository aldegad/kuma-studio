import type { AgentState } from "./agent";

export interface OfficeCharacter {
  id: string;
  name: string;
  animal: string;
  role: string;
  team: string;
  state: AgentState;
  position: { x: number; y: number };
  spriteSheet: string;
}

export interface OfficeFurniture {
  id: string;
  type: "desk" | "chair" | "whiteboard" | "plant" | "coffee" | string;
  position: { x: number; y: number };
  imageUrl: string;
}

export interface OfficeScene {
  characters: OfficeCharacter[];
  furniture: OfficeFurniture[];
  background: string;
}
