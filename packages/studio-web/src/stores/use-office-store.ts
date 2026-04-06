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

const IDLE_GRACE_PERIOD_MS = 10_000;
const ACTIVE_AGENT_STATES = new Set<AgentState>(["working", "thinking"]);
const idleGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface OfficeState {
  scene: OfficeScene;
  /** Set of character IDs that were manually dragged (suppresses auto-position until next state change) */
  draggedIds: Set<string>;
  /** Most recent timestamp at which each character was seen actively working/thinking. */
  lastWorkingAt: Record<string, number>;
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

function clearIdleGraceTimer(characterId: string) {
  const timer = idleGraceTimers.get(characterId);
  if (timer) {
    clearTimeout(timer);
    idleGraceTimers.delete(characterId);
  }
}

/** Patch desk/sofa auto-position anchors with stored furniture positions from localStorage. */
function patchLayoutFurniturePositions(layout: ProjectLayout): ProjectLayout {
  const stored = readStoredPositions("kuma-office-furniture-positions");
  let patched = false;
  const deskPositions = { ...layout.deskPositions };
  const sofaPositions = { ...layout.sofaPositions };
  for (const [id, pos] of Object.entries(stored)) {
    if (id.startsWith("desk-")) {
      const memberId = id.slice(5);
      if (memberId in deskPositions) {
        deskPositions[memberId] = pos;
        patched = true;
      }
      continue;
    }

    if (id.startsWith("sofa-")) {
      const teamId = id.slice(5);
      if (teamId in sofaPositions) {
        sofaPositions[teamId] = pos;
        patched = true;
      }
    }
  }
  return patched ? { ...layout, deskPositions, sofaPositions } : layout;
}

function scheduleIdleGraceReposition(characterId: string, delayMs: number) {
  clearIdleGraceTimer(characterId);

  if (delayMs <= 0) {
    return;
  }

  const timer = setTimeout(() => {
    idleGraceTimers.delete(characterId);
    useOfficeStore.setState((prev) => {
      const character = prev.scene.characters.find((entry: OfficeCharacter) => entry.id === characterId);
      if (!character || character.state !== "idle") {
        return prev;
      }

      const idlePosition = getAutoPosition(
        characterId,
        "idle",
        character.team,
        prev.activeLayout.deskPositions,
        prev.activeLayout.sofaPositions,
      );

      if (!idlePosition || positionsEqual(character.position, idlePosition)) {
        return prev;
      }

      return {
        scene: {
          ...prev.scene,
          characters: prev.scene.characters.map((entry: OfficeCharacter) =>
            entry.id === characterId ? { ...entry, position: idlePosition } : entry,
          ),
        },
      };
    });
  }, delayMs);

  idleGraceTimers.set(characterId, timer);
}

export const useOfficeStore = create<OfficeState>((set) => ({
  scene: applyStoredPositions(DEFAULT_OFFICE_SCENE),
  draggedIds: readStoredCharacterIds(),
  lastWorkingAt: {},
  activeLayout: patchLayoutFurniturePositions(DEFAULT_PROJECT_LAYOUT),

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

  updateCharacterState: (characterId, state, task = undefined) => {
    let graceDelayMs = 0;
    let shouldScheduleIdleGrace = false;
    let shouldClearIdleGrace = false;

    set((prev) => {
      const character = prev.scene.characters.find((c: OfficeCharacter) => c.id === characterId);
      if (!character) {
        shouldClearIdleGrace = true;
        return prev;
      }

      const now = Date.now();
      const nextTask = task !== undefined ? task : state === "idle" ? null : character.task ?? null;
      const activeState = ACTIVE_AGENT_STATES.has(state);
      const lastWorkingAt = activeState
        ? { ...prev.lastWorkingAt, [characterId]: now }
        : prev.lastWorkingAt;
      const lastActiveAt = lastWorkingAt[characterId] ?? 0;
      const withinIdleGrace =
        state === "idle" &&
        lastActiveAt > 0 &&
        now - lastActiveAt < IDLE_GRACE_PERIOD_MS;
      const autoState = withinIdleGrace ? "working" : state;
      const autoPos = getAutoPosition(
        characterId,
        autoState,
        character.team,
        prev.activeLayout.deskPositions,
        prev.activeLayout.sofaPositions,
      );
      const shouldMove = autoPos != null && !positionsEqual(character.position, autoPos);
      const stateChanged = character.state !== state || character.task !== nextTask;
      const wasDragged = prev.draggedIds.has(characterId);

      shouldClearIdleGrace = activeState || !withinIdleGrace;
      shouldScheduleIdleGrace = withinIdleGrace;
      graceDelayMs = Math.max(IDLE_GRACE_PERIOD_MS - (now - lastActiveAt), 0);

      if (!stateChanged && !shouldMove && !wasDragged && lastWorkingAt === prev.lastWorkingAt) {
        return prev;
      }

      return {
        lastWorkingAt,
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
                  // Auto-move to desk/sofa on state change, with idle grace keeping desk position briefly.
                  ...(autoPos ? { position: autoPos } : {}),
                }
              : c,
          ),
        },
      };
    });

    if (shouldClearIdleGrace) {
      clearIdleGraceTimer(characterId);
    }

    if (shouldScheduleIdleGrace) {
      scheduleIdleGraceReposition(characterId, graceDelayMs);
    }
  },

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
    set((prev) => {
      // Keep auto-position anchors in sync with draggable furniture.
      let activeLayout = prev.activeLayout;
      if (furnitureId.startsWith("desk-")) {
        const memberId = furnitureId.slice(5);
        if (memberId in activeLayout.deskPositions) {
          activeLayout = {
            ...activeLayout,
            deskPositions: { ...activeLayout.deskPositions, [memberId]: position },
          };
        }
      }

      if (furnitureId.startsWith("sofa-")) {
        const teamId = furnitureId.slice(5);
        if (teamId in activeLayout.sofaPositions) {
          activeLayout = {
            ...activeLayout,
            sofaPositions: { ...activeLayout.sofaPositions, [teamId]: position },
          };
        }
      }
      return {
        activeLayout,
        scene: {
          ...prev.scene,
          furniture: prev.scene.furniture.map((f: OfficeFurniture) =>
            f.id === furnitureId ? { ...f, position } : f,
          ),
        },
      };
    }),

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

      const patchedLayout = patchLayoutFurniturePositions(layout);

      // Reposition characters: keep persisted manual positions only while the member is still marked as dragged.
      const characters = prev.scene.characters.map((c: OfficeCharacter) => {
        const stored = prev.draggedIds.has(c.id) ? storedCharPositions[c.id] : null;
        if (stored) return { ...c, position: stored };
        const newPos = getAutoPosition(
          c.id, c.state, c.team,
          patchedLayout.deskPositions, patchedLayout.sofaPositions,
        );
        return newPos ? { ...c, position: newPos } : c;
      });

      // Reposition furniture: prefer localStorage > layout default
      const furniture = layout.furniture.map((f: OfficeFurniture) => {
        const stored = storedFurniturePositions[f.id];
        return stored ? { ...f, position: stored } : f;
      });

      return {
        activeLayout: patchedLayout,
        draggedIds: new Set(prev.draggedIds),
        scene: {
          ...prev.scene,
          characters,
          furniture,
        },
      };
    }),
}));
