import { create } from "zustand";
import type { OfficeCharacter, OfficeFurniture, OfficeLayoutSnapshot, OfficeScene } from "../types/office.js";
import type { Agent, AgentState } from "../types/agent.js";
import { buildDefaultOfficeCharacters, DEFAULT_OFFICE_SCENE } from "../lib/office-scene.js";

interface OfficeState {
  scene: OfficeScene;
  setScene: (scene: OfficeScene) => void;
  applyLayout: (layout: OfficeLayoutSnapshot) => void;
  updateCharacterState: (characterId: string, state: AgentState, task?: string | null) => void;
  updateCharacterPosition: (characterId: string, position: { x: number; y: number }) => void;
  updateFurniturePosition: (furnitureId: string, position: { x: number; y: number }) => void;
  syncCharactersFromTeam: (agents: Agent[]) => void;
}

export const useOfficeStore = create<OfficeState>((set) => ({
  scene: DEFAULT_OFFICE_SCENE,

  setScene: (scene) => set({ scene }),

  applyLayout: (layout) =>
    set((prev) => {
      const characterPositions = new Map(layout.characters.map((character: Pick<OfficeCharacter, "id" | "position">) => [character.id, character.position] as const));
      const furnitureById = new Map(layout.furniture.map((furniture: OfficeFurniture) => [furniture.id, furniture] as const));
      const knownFurnitureIds = new Set(prev.scene.furniture.map((furniture: OfficeFurniture) => furniture.id));
      const appendedFurniture = layout.furniture.filter((furniture: OfficeFurniture) => !knownFurnitureIds.has(furniture.id));

      return {
        scene: {
          ...prev.scene,
          background: layout.background,
          characters: prev.scene.characters.map((character: OfficeCharacter) => {
            const position = characterPositions.get(character.id);
            return position ? { ...character, position } : character;
          }),
          furniture: [
            ...prev.scene.furniture.map((furniture: OfficeFurniture) => {
              const nextFurniture = furnitureById.get(furniture.id);
              return nextFurniture
                ? {
                    ...furniture,
                    type: nextFurniture.type,
                    position: nextFurniture.position,
                    imageUrl: nextFurniture.imageUrl,
                  }
                : furniture;
            }),
            ...appendedFurniture,
          ],
        },
      };
    }),

  updateCharacterState: (characterId, state, task = undefined) =>
    set((prev) => ({
      scene: {
        ...prev.scene,
        characters: prev.scene.characters.map((c: OfficeCharacter) =>
          c.id === characterId
            ? {
                ...c,
                state,
                task:
                  task !== undefined
                    ? task
                    : state === "idle"
                      ? null
                      : c.task ?? null,
              }
            : c,
        ),
      },
    })),

  updateCharacterPosition: (characterId, position) =>
    set((prev) => ({
      scene: {
        ...prev.scene,
        characters: prev.scene.characters.map((character: OfficeCharacter) =>
          character.id === characterId ? { ...character, position } : character,
        ),
      },
    })),

  updateFurniturePosition: (furnitureId, position) =>
    set((prev) => ({
      scene: {
        ...prev.scene,
        furniture: prev.scene.furniture.map((furniture: OfficeFurniture) =>
          furniture.id === furnitureId ? { ...furniture, position } : furniture,
        ),
      },
    })),

  syncCharactersFromTeam: (agents) =>
    set((prev) => {
      const existingCharacters = new Map(prev.scene.characters.map((c: OfficeCharacter) => [c.id, c] as const));
      return {
        scene: {
          ...prev.scene,
          characters: buildDefaultOfficeCharacters(agents).map((character: OfficeCharacter) => {
            const existing = existingCharacters.get(character.id);
            if (!existing) return character;
            return {
              ...character,
              position: existing.position,
              spriteSheet: existing.spriteSheet,
              state: existing.state,
              task: existing.task ?? null,
            };
          }),
        },
      };
    }),
}));
