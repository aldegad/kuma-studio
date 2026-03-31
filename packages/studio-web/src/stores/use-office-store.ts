import { create } from "zustand";
import type { OfficeScene, OfficeCharacter, OfficeFurniture } from "../types/office";
import type { AgentState } from "../types/agent";
import { KUMA_TEAM } from "../types/agent";

interface OfficeState {
  scene: OfficeScene;
  setScene: (scene: OfficeScene) => void;
  updateCharacterState: (characterId: string, state: AgentState) => void;
}

const defaultCharacters: OfficeCharacter[] = KUMA_TEAM.map((agent, i) => ({
  ...agent,
  position: { x: 80 + (i % 4) * 200, y: 120 + Math.floor(i / 4) * 160 },
  spriteSheet: "",
}));

const defaultFurniture: OfficeFurniture[] = [
  { id: "desk-1", type: "desk", position: { x: 100, y: 200 }, imageUrl: "" },
  { id: "desk-2", type: "desk", position: { x: 300, y: 200 }, imageUrl: "" },
  { id: "desk-3", type: "desk", position: { x: 500, y: 200 }, imageUrl: "" },
  { id: "desk-4", type: "desk", position: { x: 700, y: 200 }, imageUrl: "" },
  { id: "whiteboard-1", type: "whiteboard", position: { x: 400, y: 50 }, imageUrl: "" },
  { id: "plant-1", type: "plant", position: { x: 50, y: 50 }, imageUrl: "" },
  { id: "plant-2", type: "plant", position: { x: 850, y: 50 }, imageUrl: "" },
];

export const useOfficeStore = create<OfficeState>((set) => ({
  scene: {
    characters: defaultCharacters,
    furniture: defaultFurniture,
    background: "woodland-office",
  },

  setScene: (scene) => set({ scene }),

  updateCharacterState: (characterId, state) =>
    set((prev) => ({
      scene: {
        ...prev.scene,
        characters: prev.scene.characters.map((c) =>
          c.id === characterId ? { ...c, state } : c,
        ),
      },
    })),
}));
