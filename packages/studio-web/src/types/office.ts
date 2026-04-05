import type { AgentState } from "./agent.js";

export interface OfficePosition {
  x: number;
  y: number;
}

export interface OfficeCharacter {
  id: string;
  name: string;
  animal: string;
  role: string;
  team: string;
  state: AgentState;
  task?: string | null;
  position: OfficePosition;
  spriteSheet: string;
  image?: string;
}

export interface OfficeFurniture {
  id: string;
  type: "desk" | "chair" | "whiteboard" | "plant" | "coffee" | string;
  position: OfficePosition;
  imageUrl: string;
}

export interface OfficeScene {
  characters: OfficeCharacter[];
  furniture: OfficeFurniture[];
  background: string;
}

export interface OfficeLayoutSnapshot {
  characters: Array<Pick<OfficeCharacter, "id" | "position">>;
  furniture: OfficeFurniture[];
  background: string;
}
