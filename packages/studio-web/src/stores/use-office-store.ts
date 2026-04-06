import { create } from "zustand";
import type { OfficeCharacter, OfficeFurniture, OfficeLayoutSnapshot, OfficeScene } from "../types/office.js";
import type { Agent, AgentState } from "../types/agent.js";
import {
  buildDefaultOfficeCharacters,
  buildProjectLayout,
  DEFAULT_OFFICE_SCENE,
  DEFAULT_PROJECT_LAYOUT,
  getAutoPosition,
  type ProjectLayout,
} from "../lib/office-scene.js";

interface OfficeState {
  scene: OfficeScene;
  /** Set of character IDs that were manually dragged (suppresses auto-position until next state change) */
  draggedIds: Set<string>;
  /** Active project layout (desk/sofa positions for auto-positioning) */
  activeLayout: ProjectLayout;
  setScene: (scene: OfficeScene) => void;
  applyLayout: (layout: OfficeLayoutSnapshot) => void;
  updateCharacterState: (characterId: string, state: AgentState, task?: string | null) => void;
  updateCharacterPosition: (characterId: string, position: { x: number; y: number }) => void;
  updateFurniturePosition: (furnitureId: string, position: { x: number; y: number }) => void;
  syncCharactersFromTeam: (agents: Agent[]) => void;
  markDragged: (characterId: string) => void;
  /** Switch to a project view: rebuilds furniture and positions for given members */
  switchProject: (memberIds: string[] | null) => void;
}

export const useOfficeStore = create<OfficeState>((set) => ({
  scene: DEFAULT_OFFICE_SCENE,
  draggedIds: new Set<string>(),
  activeLayout: DEFAULT_PROJECT_LAYOUT,

  setScene: (scene) => set({ scene }),

  applyLayout: (layout) =>
    set((prev) => {
      const characterPositions = new Map(layout.characters.map((c: Pick<OfficeCharacter, "id" | "position">) => [c.id, c.position] as const));
      const furnitureById = new Map(layout.furniture.map((f: OfficeFurniture) => [f.id, f] as const));
      const knownFurnitureIds = new Set(prev.scene.furniture.map((f: OfficeFurniture) => f.id));
      const appendedFurniture = layout.furniture.filter((f: OfficeFurniture) => !knownFurnitureIds.has(f.id));

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
              const next = furnitureById.get(furniture.id);
              return next
                ? { ...furniture, type: next.type, position: next.position, imageUrl: next.imageUrl }
                : furniture;
            }),
            ...appendedFurniture,
          ],
        },
      };
    }),

  updateCharacterState: (characterId, state, task = undefined) =>
    set((prev) => {
      // Find the character to get their team for auto-positioning
      const character = prev.scene.characters.find((c: OfficeCharacter) => c.id === characterId);
      // Use project-specific desk/sofa positions for auto-positioning
      const autoPos = character
        ? getAutoPosition(characterId, state, character.team, prev.activeLayout.deskPositions, prev.activeLayout.sofaPositions)
        : null;

      return {
        // Clear dragged flag on state change — auto-position takes over
        draggedIds: (() => {
          const next = new Set(prev.draggedIds);
          next.delete(characterId);
          return next;
        })(),
        scene: {
          ...prev.scene,
          characters: prev.scene.characters.map((c: OfficeCharacter) =>
            c.id === characterId
              ? {
                  ...c,
                  state,
                  task: task !== undefined ? task : state === "idle" ? null : c.task ?? null,
                  // Auto-move to desk/sofa on state change
                  ...(autoPos ? { position: autoPos } : {}),
                }
              : c,
          ),
        },
      };
    }),

  updateCharacterPosition: (characterId, position) =>
    set((prev) => ({
      scene: {
        ...prev.scene,
        characters: prev.scene.characters.map((c: OfficeCharacter) =>
          c.id === characterId ? { ...c, position } : c,
        ),
      },
    })),

  updateFurniturePosition: (furnitureId, position) =>
    set((prev) => ({
      scene: {
        ...prev.scene,
        furniture: prev.scene.furniture.map((f: OfficeFurniture) =>
          f.id === furnitureId ? { ...f, position } : f,
        ),
      },
    })),

  markDragged: (characterId) =>
    set((prev) => {
      const next = new Set(prev.draggedIds);
      next.add(characterId);
      return { draggedIds: next };
    }),

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

  switchProject: (memberIds) =>
    set((prev) => {
      const layout = memberIds ? buildProjectLayout(memberIds) : DEFAULT_PROJECT_LAYOUT;

      // Reposition characters to their new desk/sofa positions
      const characters = prev.scene.characters.map((c: OfficeCharacter) => {
        const newPos = getAutoPosition(
          c.id, c.state, c.team,
          layout.deskPositions, layout.sofaPositions,
        );
        return newPos ? { ...c, position: newPos } : c;
      });

      return {
        activeLayout: layout,
        draggedIds: new Set<string>(),
        scene: {
          ...prev.scene,
          characters,
          furniture: layout.furniture,
        },
      };
    }),
}));
