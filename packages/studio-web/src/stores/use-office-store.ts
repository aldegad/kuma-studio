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
const DISPATCH_APPROACH_DURATION_MS = 5_000;
const ACTIVE_AGENT_STATES = new Set<AgentState>(["working", "thinking"]);
const idleGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const dispatchApproachTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  playDispatchApproach: (characterId: string, targetCharacterId: string, durationMs?: number) => void;
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

function clearDispatchApproachTimer(characterId: string) {
  const timer = dispatchApproachTimers.get(characterId);
  if (timer) {
    clearTimeout(timer);
    dispatchApproachTimers.delete(characterId);
  }
}

function computeDispatchApproachPosition(
  actor: OfficeCharacter,
  target: OfficeCharacter,
): { x: number; y: number } {
  const dx = target.position.x - actor.position.x;
  const dy = target.position.y - actor.position.y;
  const distance = Math.hypot(dx, dy);

  if (!Number.isFinite(distance) || distance < 1) {
    return {
      x: target.position.x + 64,
      y: target.position.y,
    };
  }

  const standOff = Math.max(52, Math.min(76, distance * 0.35));
  return {
    x: Math.round(target.position.x - (dx / distance) * standOff),
    y: Math.round(target.position.y - (dy / distance) * standOff),
  };
}

function restoreCharacterAutoPosition(characterId: string) {
  useOfficeStore.setState((prev) => {
    const character = prev.scene.characters.find((entry: OfficeCharacter) => entry.id === characterId);
    if (!character || prev.draggedIds.has(characterId)) {
      return prev;
    }

    const now = Date.now();
    const lastActiveAt = prev.lastWorkingAt[characterId] ?? 0;
    const withinIdleGrace =
      character.state === "idle" &&
      lastActiveAt > 0 &&
      now - lastActiveAt < IDLE_GRACE_PERIOD_MS;
    const autoState = withinIdleGrace ? "working" : character.state;
    const autoPosition = getAutoPosition(
      characterId,
      autoState,
      character.team,
      prev.activeLayout.deskPositions,
      prev.activeLayout.sofaPositions,
      prev.activeLayout.teamMemberIdsByTeam,
    );

    if (!autoPosition || positionsEqual(autoPosition, character.position)) {
      return prev;
    }

    return {
      scene: {
        ...prev.scene,
        characters: prev.scene.characters.map((entry: OfficeCharacter) =>
          entry.id === characterId ? { ...entry, position: autoPosition } : entry,
        ),
      },
    };
  });
}

function patchLayoutAnchorPositions(
  layout: ProjectLayout,
  positions: Record<string, { x: number; y: number }>,
): ProjectLayout {
  let patched = false;
  const deskPositions = { ...layout.deskPositions };
  const sofaPositions = { ...layout.sofaPositions };

  for (const [id, pos] of Object.entries(positions)) {
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

/** Patch desk/sofa auto-position anchors with stored furniture positions from localStorage. */
function patchLayoutFurniturePositions(layout: ProjectLayout): ProjectLayout {
  return patchLayoutAnchorPositions(layout, readStoredPositions("kuma-office-furniture-positions"));
}

function patchLayoutFromFurniture(layout: ProjectLayout, furniture: Pick<OfficeFurniture, "id" | "position">[]): ProjectLayout {
  return patchLayoutAnchorPositions(
    layout,
    Object.fromEntries(furniture.map((item) => [item.id, item.position])),
  );
}

function repositionIdleTeamMembers(
  characters: OfficeCharacter[],
  activeLayout: ProjectLayout,
  teamId: string,
  draggedIds: Set<string>,
): OfficeCharacter[] {
  return characters.map((character) => {
    if (character.team !== teamId) {
      return character;
    }

    if (draggedIds.has(character.id)) {
      return character;
    }

    if (character.state !== "idle" && character.state !== "completed") {
      return character;
    }

    const autoPosition = getAutoPosition(
      character.id,
      character.state,
      character.team,
      activeLayout.deskPositions,
      activeLayout.sofaPositions,
      activeLayout.teamMemberIdsByTeam,
    );

    if (!autoPosition || positionsEqual(character.position, autoPosition)) {
      return character;
    }

    return { ...character, position: autoPosition };
  });
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
        prev.activeLayout.teamMemberIdsByTeam,
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
      const furniture = prev.scene.furniture.map((item: OfficeFurniture) => {
        const next = furnitureById.get(item.id);
        return next
          ? { ...item, type: next.type, position: next.position, imageUrl: next.imageUrl }
          : item;
      });
      const activeLayout = patchLayoutFromFurniture(prev.activeLayout, furniture);

      return {
        activeLayout,
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
                  activeLayout.deskPositions,
                  activeLayout.sofaPositions,
                  activeLayout.teamMemberIdsByTeam,
                );
            const position = autoPosition ?? layoutPosition ?? character.position;
            return positionsEqual(position, character.position) ? character : { ...character, position };
          }),
          furniture,
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
        prev.activeLayout.teamMemberIdsByTeam,
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
      let idleTeamId: string | null = null;
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
          idleTeamId = teamId;
          activeLayout = {
            ...activeLayout,
            sofaPositions: { ...activeLayout.sofaPositions, [teamId]: position },
          };
        }
      }

      const characters = idleTeamId
        ? repositionIdleTeamMembers(prev.scene.characters, activeLayout, idleTeamId, prev.draggedIds)
        : prev.scene.characters;
      return {
        activeLayout,
        scene: {
          ...prev.scene,
          characters,
          furniture: prev.scene.furniture.map((f: OfficeFurniture) =>
            f.id === furnitureId ? { ...f, position } : f,
          ),
        },
      };
    }),

  playDispatchApproach: (characterId, targetCharacterId, durationMs = DISPATCH_APPROACH_DURATION_MS) => {
    const normalizedCharacterId = String(characterId ?? "").trim();
    const normalizedTargetId = String(targetCharacterId ?? "").trim();
    if (!normalizedCharacterId || !normalizedTargetId || normalizedCharacterId === normalizedTargetId) {
      return;
    }

    clearDispatchApproachTimer(normalizedCharacterId);

    set((prev) => {
      if (prev.draggedIds.has(normalizedCharacterId)) {
        return prev;
      }

      const character = prev.scene.characters.find((entry: OfficeCharacter) => entry.id === normalizedCharacterId);
      const target = prev.scene.characters.find((entry: OfficeCharacter) => entry.id === normalizedTargetId);
      if (!character || !target) {
        return prev;
      }

      const approachPosition = computeDispatchApproachPosition(character, target);
      if (positionsEqual(approachPosition, character.position)) {
        return prev;
      }

      return {
        scene: {
          ...prev.scene,
          characters: prev.scene.characters.map((entry: OfficeCharacter) =>
            entry.id === normalizedCharacterId ? { ...entry, position: approachPosition } : entry,
          ),
        },
      };
    });

    const timer = setTimeout(() => {
      dispatchApproachTimers.delete(normalizedCharacterId);
      restoreCharacterAutoPosition(normalizedCharacterId);
    }, durationMs);
    dispatchApproachTimers.set(normalizedCharacterId, timer);
  },

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
      const currentFurniturePositions = Object.fromEntries(
        prev.scene.furniture.map((item: OfficeFurniture) => [item.id, item.position]),
      ) as Record<string, { x: number; y: number }>;

      // Reposition characters: keep persisted manual positions only while the member is still marked as dragged.
      const furniture = layout.furniture.map((f: OfficeFurniture) => {
        const stored = storedFurniturePositions[f.id];
        if (stored) {
          return { ...f, position: stored };
        }

        const current = currentFurniturePositions[f.id];
        return current ? { ...f, position: current } : f;
      });
      const patchedLayout = patchLayoutFromFurniture(layout, furniture);

      const characters = prev.scene.characters.map((c: OfficeCharacter) => {
        const stored = prev.draggedIds.has(c.id) ? storedCharPositions[c.id] : null;
        if (stored) return { ...c, position: stored };
        const newPos = getAutoPosition(
          c.id, c.state, c.team,
          patchedLayout.deskPositions, patchedLayout.sofaPositions,
          patchedLayout.teamMemberIdsByTeam,
        );
        return newPos ? { ...c, position: newPos } : c;
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
