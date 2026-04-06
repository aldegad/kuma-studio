import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
