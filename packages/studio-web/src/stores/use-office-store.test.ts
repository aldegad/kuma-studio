import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_LAYOUT, getAutoPosition, SOFA_POSITIONS } from "../lib/office-scene";

class LocalStorageMock {
  #store = new Map<string, string>();

  clear() {
    this.#store.clear();
  }

  getItem(key: string) {
    return this.#store.has(key) ? this.#store.get(key)! : null;
  }

  key(index: number) {
    return Array.from(this.#store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.#store.delete(key);
  }

  setItem(key: string, value: string) {
    this.#store.set(key, value);
  }

  get length() {
    return this.#store.size;
  }
}

function installLocalStorage(storage: LocalStorageMock) {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

async function loadStore() {
  vi.resetModules();
  return (await import("./use-office-store")).useOfficeStore;
}

describe("useOfficeStore", () => {
  beforeEach(() => {
    installLocalStorage(new LocalStorageMock());
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("syncs deskPositions when a desk is dragged", async () => {
    const useOfficeStore = await loadStore();
    const draggedDeskPosition = { x: 333, y: 444 };

    useOfficeStore.getState().updateFurniturePosition("desk-kuma", draggedDeskPosition);

    expect(useOfficeStore.getState().activeLayout.deskPositions.kuma).toEqual(draggedDeskPosition);

    useOfficeStore.getState().updateCharacterState("kuma", "working");
    const expectedWorkingPosition = getAutoPosition(
      "kuma",
      "working",
      "system",
      useOfficeStore.getState().activeLayout.deskPositions,
      useOfficeStore.getState().activeLayout.sofaPositions,
      useOfficeStore.getState().activeLayout.teamMemberIdsByTeam,
    );

    expect(
      useOfficeStore.getState().scene.characters.find((character) => character.id === "kuma")?.position,
    ).toEqual(expectedWorkingPosition);
  });

  it("rehydrates stored desk positions into auto-position anchors", async () => {
    const storage = new LocalStorageMock();
    const storedDeskPosition = { x: 777, y: 888 };
    storage.setItem(
      "kuma-office-furniture-positions",
      JSON.stringify({ "desk-kuma": storedDeskPosition }),
    );
    installLocalStorage(storage);

    const useOfficeStore = await loadStore();

    expect(useOfficeStore.getState().activeLayout.deskPositions.kuma).toEqual(storedDeskPosition);

    useOfficeStore.getState().switchProject(["kuma"]);
    useOfficeStore.getState().updateCharacterState("kuma", "working");
    const expectedWorkingPosition = getAutoPosition(
      "kuma",
      "working",
      "system",
      useOfficeStore.getState().activeLayout.deskPositions,
      useOfficeStore.getState().activeLayout.sofaPositions,
      useOfficeStore.getState().activeLayout.teamMemberIdsByTeam,
    );

    expect(
      useOfficeStore.getState().scene.characters.find((character) => character.id === "kuma")?.position,
    ).toEqual(expectedWorkingPosition);
  });

  it("syncs saved desk and sofa positions into activeLayout while ignoring obsolete furniture ids", async () => {
    const useOfficeStore = await loadStore();
    const savedDeskPosition = { x: 612, y: 378 };
    const savedSofaPosition = { x: 1125, y: 296 };

    useOfficeStore.getState().applyLayout({
      background: "woodland-office",
      characters: [],
      furniture: [
        { id: "desk-kuma", type: "desk", position: savedDeskPosition, imageUrl: "" },
        { id: "sofa-system", type: "sofa", position: savedSofaPosition, imageUrl: "" },
        { id: "sofa-management", type: "sofa", position: { x: 1189, y: 511 }, imageUrl: "" },
      ],
    });

    expect(useOfficeStore.getState().activeLayout.deskPositions.kuma).toEqual(savedDeskPosition);
    expect(useOfficeStore.getState().activeLayout.sofaPositions.system).toEqual(savedSofaPosition);
    expect(
      useOfficeStore.getState().scene.furniture.find((furniture) => furniture.id === "sofa-management"),
    ).toBeUndefined();
  });

  it("keeps applied furniture positions when switching project views", async () => {
    const useOfficeStore = await loadStore();
    const savedSofaPosition = { x: 1125, y: 296 };

    useOfficeStore.getState().applyLayout({
      background: "woodland-office",
      characters: [],
      furniture: [
        { id: "sofa-system", type: "sofa", position: savedSofaPosition, imageUrl: "" },
      ],
    });

    useOfficeStore.getState().switchProject(["kuma", "jjooni"]);

    expect(useOfficeStore.getState().activeLayout.sofaPositions.system).toEqual(savedSofaPosition);
    expect(
      useOfficeStore.getState().scene.furniture.find((furniture) => furniture.id === "sofa-system")?.position,
    ).toEqual(savedSofaPosition);
  });

  it("keeps idle characters at their desk during the 10s grace period, then moves them to the sofa", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T16:35:00Z"));

    const useOfficeStore = await loadStore();
    const characterId = "tookdaki";

    useOfficeStore.getState().updateCharacterState(characterId, "working");

    const stateAfterWorking = useOfficeStore.getState();
    const deskPosition = stateAfterWorking.activeLayout.deskPositions[characterId];
    const workingPosition = getAutoPosition(
      characterId,
      "working",
      stateAfterWorking.scene.characters.find((character) => character.id === characterId)?.team ?? "dev",
      stateAfterWorking.activeLayout.deskPositions,
      stateAfterWorking.activeLayout.sofaPositions,
      stateAfterWorking.activeLayout.teamMemberIdsByTeam,
    );
    expect(
      stateAfterWorking.scene.characters.find((character) => character.id === characterId)?.position,
    ).toEqual(workingPosition);

    vi.advanceTimersByTime(5_000);
    useOfficeStore.getState().updateCharacterState(characterId, "idle");

    const stateDuringGrace = useOfficeStore.getState();
    const idlePosition = getAutoPosition(
      characterId,
      "idle",
      stateDuringGrace.scene.characters.find((character) => character.id === characterId)?.team ?? "dev",
      stateDuringGrace.activeLayout.deskPositions,
      stateDuringGrace.activeLayout.sofaPositions,
      stateDuringGrace.activeLayout.teamMemberIdsByTeam,
    );

    expect(
      stateDuringGrace.scene.characters.find((character) => character.id === characterId),
    ).toMatchObject({
      state: "idle",
      position: workingPosition,
    });

    vi.advanceTimersByTime(4_999);
    expect(
      useOfficeStore.getState().scene.characters.find((character) => character.id === characterId)?.position,
    ).toEqual(workingPosition);

    vi.advanceTimersByTime(1);
    expect(
      useOfficeStore.getState().scene.characters.find((character) => character.id === characterId)?.position,
    ).toEqual(idlePosition);

    expect(workingPosition).not.toEqual(deskPosition);
  });

  it("keeps the dev sofa anchor fixed for filtered project views so darami can idle at the sofa", async () => {
    const useOfficeStore = await loadStore();

    useOfficeStore.getState().switchProject(["darami", "tookdaki"]);

    const state = useOfficeStore.getState();
    const darami = state.scene.characters.find((character) => character.id === "darami");
    const devSofa = state.scene.furniture.find((furniture) => furniture.id === "sofa-dev");
    const expectedIdlePosition = getAutoPosition(
      "darami",
      darami?.state ?? "idle",
      "dev",
      state.activeLayout.deskPositions,
      state.activeLayout.sofaPositions,
      state.activeLayout.teamMemberIdsByTeam,
    );

    expect(state.activeLayout.sofaPositions.dev).toEqual(SOFA_POSITIONS.dev);
    expect(devSofa?.position).toEqual(SOFA_POSITIONS.dev);
    expect(darami?.position).toEqual(expectedIdlePosition);
    expect(darami?.position).not.toEqual(state.activeLayout.deskPositions.darami);
  });

  it("keeps idle system and dev members in their stable sofa slots when a filtered project view is active", async () => {
    const useOfficeStore = await loadStore();

    useOfficeStore.getState().switchProject(["darami", "kongkongi", "kuma", "jjooni"]);

    const state = useOfficeStore.getState();
    const positions = Object.fromEntries(
      ["darami", "kuma", "jjooni"].map((id) => [
        id,
        state.scene.characters.find((character) => character.id === id)?.position ?? null,
      ]),
    );

    expect(state.activeLayout.teamMemberIdsByTeam.dev).toEqual(DEFAULT_PROJECT_LAYOUT.teamMemberIdsByTeam.dev);
    expect(state.activeLayout.teamMemberIdsByTeam.system).toEqual(DEFAULT_PROJECT_LAYOUT.teamMemberIdsByTeam.system);
    expect(positions.darami).toEqual(
      getAutoPosition("darami", "idle", "dev", state.activeLayout.deskPositions, state.activeLayout.sofaPositions, state.activeLayout.teamMemberIdsByTeam),
    );
    expect(positions.kuma).toEqual(
      getAutoPosition("kuma", "idle", "system", state.activeLayout.deskPositions, state.activeLayout.sofaPositions, state.activeLayout.teamMemberIdsByTeam),
    );
    expect(positions.jjooni).toEqual(
      getAutoPosition("jjooni", "idle", "system", state.activeLayout.deskPositions, state.activeLayout.sofaPositions, state.activeLayout.teamMemberIdsByTeam),
    );
  });

  it("repositions idle members of the dragged sofa team without sending them to desk centers", async () => {
    const useOfficeStore = await loadStore();
    const nextSystemSofaPosition = {
      x: SOFA_POSITIONS.system.x + 180,
      y: SOFA_POSITIONS.system.y + 40,
    };
    const nextStrategyAnalyticsSofaPosition = {
      x: SOFA_POSITIONS["strategy-analytics"].x - 120,
      y: SOFA_POSITIONS["strategy-analytics"].y + 35,
    };

    useOfficeStore.getState().switchProject(["kuma", "jjooni", "noeuri", "lumi", "buri"]);
    useOfficeStore.getState().updateFurniturePosition("sofa-system", nextSystemSofaPosition);
    useOfficeStore.getState().updateFurniturePosition("sofa-strategy-analytics", nextStrategyAnalyticsSofaPosition);

    const state = useOfficeStore.getState();
    const positions = Object.fromEntries(
      ["kuma", "jjooni", "noeuri", "lumi", "buri"].map((id) => [
        id,
        state.scene.characters.find((character) => character.id === id)?.position ?? null,
      ]),
    );

    expect(state.activeLayout.sofaPositions.system).toEqual(nextSystemSofaPosition);
    expect(state.activeLayout.sofaPositions["strategy-analytics"]).toEqual(nextStrategyAnalyticsSofaPosition);

    for (const id of ["kuma", "jjooni", "noeuri"] as const) {
      expect(positions[id]).toEqual(
        getAutoPosition(id, "idle", "system", state.activeLayout.deskPositions, state.activeLayout.sofaPositions, state.activeLayout.teamMemberIdsByTeam),
      );
      expect(positions[id]).not.toEqual(state.activeLayout.deskPositions[id]);
    }

    for (const id of ["lumi", "buri"] as const) {
      expect(positions[id]).toEqual(
        getAutoPosition(id, "idle", "strategy-analytics", state.activeLayout.deskPositions, state.activeLayout.sofaPositions, state.activeLayout.teamMemberIdsByTeam),
      );
      expect(positions[id]).not.toEqual(state.activeLayout.deskPositions[id]);
    }
  });
});
