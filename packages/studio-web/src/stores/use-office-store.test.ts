import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAutoPosition } from "../lib/office-scene";

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

    expect(
      useOfficeStore.getState().scene.characters.find((character) => character.id === "kuma")?.position,
    ).toEqual(draggedDeskPosition);
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

    expect(
      useOfficeStore.getState().scene.characters.find((character) => character.id === "kuma")?.position,
    ).toEqual(storedDeskPosition);
  });

  it("keeps idle characters at their desk during the 10s grace period, then moves them to the sofa", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T16:35:00Z"));

    const useOfficeStore = await loadStore();
    const characterId = "tookdaki";

    useOfficeStore.getState().updateCharacterState(characterId, "working");

    const stateAfterWorking = useOfficeStore.getState();
    const deskPosition = stateAfterWorking.activeLayout.deskPositions[characterId];
    expect(
      stateAfterWorking.scene.characters.find((character) => character.id === characterId)?.position,
    ).toEqual(deskPosition);

    vi.advanceTimersByTime(5_000);
    useOfficeStore.getState().updateCharacterState(characterId, "idle");

    const stateDuringGrace = useOfficeStore.getState();
    const idlePosition = getAutoPosition(
      characterId,
      "idle",
      stateDuringGrace.scene.characters.find((character) => character.id === characterId)?.team ?? "dev",
      stateDuringGrace.activeLayout.deskPositions,
      stateDuringGrace.activeLayout.sofaPositions,
    );

    expect(
      stateDuringGrace.scene.characters.find((character) => character.id === characterId),
    ).toMatchObject({
      state: "idle",
      position: deskPosition,
    });

    vi.advanceTimersByTime(4_999);
    expect(
      useOfficeStore.getState().scene.characters.find((character) => character.id === characterId)?.position,
    ).toEqual(deskPosition);

    vi.advanceTimersByTime(1);
    expect(
      useOfficeStore.getState().scene.characters.find((character) => character.id === characterId)?.position,
    ).toEqual(idlePosition);
  });
});
