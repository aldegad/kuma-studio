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

/** Read stored positions from localStorage (returns empty object on failure) */
function readStoredPositions(key: string): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Apply persisted character & furniture positions from localStorage */
function applyStoredPositions(scene: OfficeScene): OfficeScene {
  const charPositions = readStoredPositions("kuma-office-character-positions");
  const furniturePositions = readStoredPositions("kuma-office-furniture-positions");
  return {
    ...scene,
    characters: scene.characters.map((c) => {
      const pos = charPositions[c.id];
      return pos ? { ...c, position: pos } : c;
    }),
    furniture: scene.furniture.map((f) => {
      const pos = furniturePositions[f.id];
      return pos ? { ...f, position: pos } : f;
    }),
  };
}

function readStoredCharacterIds(): Set<string> {
  return new Set(Object.keys(readStoredPositions("kuma-office-character-positions")));
}

function positionsEqual(
  left: { x: number; y: number } | null | undefined,
  right: { x: number; y: number } | null | undefined,
): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

export const useOfficeStore = create<OfficeState>((set) => ({
  scene: applyStoredPositions(DEFAULT_OFFICE_SCENE),
  draggedIds: readStoredCharacterIds(),
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
            const layoutPosition = characterPositions.get(character.id);
            const autoPosition = prev.draggedIds.has(character.id)
              ? null
              : getAutoPosition(
                  character.id,
                  character.state,
                  character.team,
                  prev.activeLayout.deskPositions,
                  prev.activeLayout.sofaPositions,
                );
            const position = autoPosition ?? layoutPosition ?? character.position;
            return positionsEqual(position, character.position) ? character : { ...character, position };
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
      const character = prev.scene.characters.find((c: OfficeCharacter) => c.id === characterId);
      if (!character) {
        return prev;
      }

      const nextTask = task !== undefined ? task : state === "idle" ? null : character.task ?? null;
      // Use project-specific desk/sofa positions for auto-positioning
      const autoPos = getAutoPosition(
        characterId,
        state,
        character.team,
        prev.activeLayout.deskPositions,
        prev.activeLayout.sofaPositions,
      );
      const shouldMove = autoPos != null && !positionsEqual(character.position, autoPos);
      const stateChanged = character.state !== state || character.task !== nextTask;
      const wasDragged = prev.draggedIds.has(characterId);

      if (!stateChanged && !shouldMove && !wasDragged) {
        return prev;
      }

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
                  task: nextTask,
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

      // Load user-dragged positions from localStorage
      const storedCharPositions = readStoredPositions("kuma-office-character-positions");
      const storedFurniturePositions = readStoredPositions("kuma-office-furniture-positions");

      // Reposition characters: keep persisted manual positions only while the member is still marked as dragged.
      const characters = prev.scene.characters.map((c: OfficeCharacter) => {
        const stored = prev.draggedIds.has(c.id) ? storedCharPositions[c.id] : null;
        if (stored) return { ...c, position: stored };
        const newPos = getAutoPosition(
          c.id, c.state, c.team,
          layout.deskPositions, layout.sofaPositions,
        );
        return newPos ? { ...c, position: newPos } : c;
      });

      // Reposition furniture: prefer localStorage > layout default
      const furniture = layout.furniture.map((f: OfficeFurniture) => {
        const stored = storedFurniturePositions[f.id];
        return stored ? { ...f, position: stored } : f;
      });

      return {
        activeLayout: layout,
        draggedIds: new Set(prev.draggedIds),
        scene: {
          ...prev.scene,
          characters,
          furniture,
        },
      };
    }),
}));
