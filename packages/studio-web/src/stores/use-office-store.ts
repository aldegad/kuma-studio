import { create } from "zustand";
import type { OfficeLayoutSnapshot, OfficeScene } from "../types/office";
import type { Agent, AgentState } from "../types/agent";
import { buildDefaultOfficeCharacters, DEFAULT_OFFICE_SCENE } from "../lib/office-scene";

interface OfficeState {
  scene: OfficeScene;
  setScene: (scene: OfficeScene) => void;
  applyLayout: (layout: OfficeLayoutSnapshot) => void;
  updateCharacterState: (characterId: string, state: AgentState) => void;
  updateCharacterPosition: (characterId: string, position: { x: number; y: number }) => void;
  updateFurniturePosition: (furnitureId: string, position: { x: number; y: number }) => void;
  syncCharactersFromTeam: (agents: Agent[]) => void;
}

export const useOfficeStore = create<OfficeState>((set) => ({
  scene: DEFAULT_OFFICE_SCENE,

  setScene: (scene) => set({ scene }),

  applyLayout: (layout) =>
    set((prev) => {
      const characterPositions = new Map(layout.characters.map((character) => [character.id, character.position]));
      const furnitureById = new Map(layout.furniture.map((furniture) => [furniture.id, furniture]));
      const knownFurnitureIds = new Set(prev.scene.furniture.map((furniture) => furniture.id));
      const appendedFurniture = layout.furniture.filter((furniture) => !knownFurnitureIds.has(furniture.id));

      return {
        scene: {
          ...prev.scene,
          background: layout.background,
          characters: prev.scene.characters.map((character) => {
            const position = characterPositions.get(character.id);
            return position ? { ...character, position } : character;
          }),
          furniture: [
            ...prev.scene.furniture.map((furniture) => {
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

  updateCharacterState: (characterId, state) =>
    set((prev) => ({
      scene: {
        ...prev.scene,
        characters: prev.scene.characters.map((c) =>
          c.id === characterId ? { ...c, state } : c,
        ),
      },
    })),

  updateCharacterPosition: (characterId, position) =>
    set((prev) => ({
      scene: {
        ...prev.scene,
        characters: prev.scene.characters.map((character) =>
          character.id === characterId ? { ...character, position } : character,
        ),
      },
    })),

  updateFurniturePosition: (furnitureId, position) =>
    set((prev) => ({
      scene: {
        ...prev.scene,
        furniture: prev.scene.furniture.map((furniture) =>
          furniture.id === furnitureId ? { ...furniture, position } : furniture,
        ),
      },
    })),

  syncCharactersFromTeam: (agents) =>
    set((prev) => {
      const existingCharacters = new Map(prev.scene.characters.map((c) => [c.id, c]));
      return {
        scene: {
          ...prev.scene,
          characters: buildDefaultOfficeCharacters(agents).map((character) => {
            const existing = existingCharacters.get(character.id);
            if (!existing) return character;
            return { ...character, position: existing.position, spriteSheet: existing.spriteSheet, state: existing.state };
          }),
        },
      };
    }),
}));
