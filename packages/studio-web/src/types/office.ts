import type { AgentState } from "./agent";

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
  position: OfficePosition;
  spriteSheet: string;
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
