import { existsSync, mkdirSync, readFileSync, watchFile, unwatchFile, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createEmptyOfficeLayout,
  createEmptyScene,
  currentTimestamp,
  ensureOfficeLayoutShape,
  ensureSceneShape,
} from "./scene-schema.mjs";
import { resolveProjectMetaPath, resolveProjectStateDir } from "./state-home.mjs";

export class SceneStore {
  constructor(root, options = {}) {
    this.root = resolve(root);
    this.scenePath = resolve(resolveProjectStateDir(this.root), "scene.json");
    this.onChange = options.onChange ?? null;
  }

  ensure() {
    mkdirSync(dirname(this.scenePath), { recursive: true });

    try {
      readFileSync(this.scenePath, "utf8");
    } catch {
      const emptyScene = createEmptyScene();
      const initialScene = ensureSceneShape({
        ...emptyScene,
        meta: {
          ...emptyScene.meta,
          projectId: this.root,
          updatedAt: currentTimestamp(),
        },
      });
      writeFileSync(this.scenePath, `${JSON.stringify(initialScene, null, 2)}\n`, "utf8");
    }

    // Persist project metadata for list-projects discovery
    const metaPath = resolveProjectMetaPath(this.root);
    if (!existsSync(metaPath)) {
      writeFileSync(
        metaPath,
        JSON.stringify({ projectRoot: this.root, createdAt: currentTimestamp() }, null, 2) + "\n",
        "utf8",
      );
    }
  }

  read() {
    this.ensure();
    return ensureSceneShape(JSON.parse(readFileSync(this.scenePath, "utf8")));
  }

  write(scene, source = "http") {
    const previous = this.read();
    const next = ensureSceneShape(scene);
    const normalized = {
      ...next,
      meta: {
        ...previous.meta,
        ...next.meta,
        revision: (previous.meta?.revision ?? 0) + 1,
        updatedAt: currentTimestamp(),
      },
    };

    writeFileSync(this.scenePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    this.onChange?.(normalized, source);
    return normalized;
  }

  readOfficeLayout() {
    const scene = this.read();
    return ensureOfficeLayoutShape(scene.meta?.officeLayout ?? createEmptyOfficeLayout());
  }

  writeOfficeLayout(layout, source = "studio-office-layout") {
    const scene = this.read();
    scene.meta = {
      ...scene.meta,
      officeLayout: ensureOfficeLayoutShape(layout),
    };
    const next = this.write(scene, source);
    return ensureOfficeLayoutShape(next.meta?.officeLayout ?? createEmptyOfficeLayout());
  }

  addNode(node) {
    const scene = this.read();
    scene.nodes.push(node);
    return this.write(scene);
  }

  updateNode(nodeId, updates) {
    const scene = this.read();
    const target = scene.nodes.find((node) => node.id === nodeId);

    if (!target) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    Object.assign(target, updates);
    return this.write(scene);
  }

  removeNode(nodeId) {
    const scene = this.read();
    scene.nodes = scene.nodes.filter((node) => node.id !== nodeId);
    if (scene.meta?.selectedStudyId === nodeId) {
      scene.meta.selectedStudyId = null;
    }
    return this.write(scene);
  }

  updateMeta(updates) {
    const scene = this.read();
    const nextMeta = scene.meta ?? {};

    if ("selectedStudyId" in updates) {
      nextMeta.selectedStudyId = updates.selectedStudyId == null ? null : String(updates.selectedStudyId);
    }

    if ("officeLayout" in updates) {
      nextMeta.officeLayout = ensureOfficeLayoutShape(updates.officeLayout);
    }

    scene.meta = nextMeta;
    return this.write(scene);
  }
}

export function watchSceneFile(store, onSceneChange, interval = 750) {
  store.ensure();

  const listener = (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs) return;

    try {
      onSceneChange(store.read(), "file-watch");
    } catch {
      // Ignore partial writes and invalid temporary states.
    }
  };

  watchFile(store.scenePath, { interval }, listener);

  return () => {
    unwatchFile(store.scenePath, listener);
  };
}
