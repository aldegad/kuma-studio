"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  addSceneNode,
  createSceneEventSource,
  fetchScene,
  parseSceneEvent,
  removeSceneNode,
  updateSceneMeta,
  updateSceneNode,
} from "./scene-daemon";
import {
  autoArrangeStudies,
  clampZoom,
  createStudy,
  DEFAULT_TOOLBAR_SAFE_TOP,
  getLastVisibleStudyId,
  getNextZIndex,
  resolveSceneStudies,
  sortStudies,
} from "./scene-layout";
import {
  clampCanvasPosition,
  type KumaPickerComponentItem,
  type KumaPickerScene,
  type KumaPickerStudy,
  type KumaPickerSyncState,
  type KumaPickerViewport,
} from "./types";

interface UseKumaPickerWorkspaceOptions {
  items: KumaPickerComponentItem[];
  itemsById: Map<string, KumaPickerComponentItem>;
}

export function useKumaPickerWorkspace({ items, itemsById }: UseKumaPickerWorkspaceOptions) {
  const [studies, setStudies] = useState<KumaPickerStudy[]>([]);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [toolbarSafeTop, setToolbarSafeTop] = useState(DEFAULT_TOOLBAR_SAFE_TOP);
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [isSceneReady, setIsSceneReady] = useState(false);
  const [syncState, setSyncState] = useState<KumaPickerSyncState>("connecting");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const syncStateRef = useRef<KumaPickerSyncState>("connecting");
  const remoteRevisionRef = useRef(0);
  const localDirtyRef = useRef(false);
  const pendingRemoteSyncRef = useRef(false);
  const pendingMutationCountRef = useRef(0);
  const studiesRef = useRef<KumaPickerStudy[]>([]);
  const mutationQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    syncStateRef.current = syncState;
  }, [syncState]);

  useEffect(() => {
    studiesRef.current = studies;
  }, [studies]);

  const applyResolvedScene = useCallback(
    (resolved: ReturnType<typeof resolveSceneStudies>) => {
      remoteRevisionRef.current = resolved.revision;
      setStudies(resolved.studies);
      setLastSavedAt(resolved.updatedAt ?? null);
      setSelectedStudyId(
        resolved.selectedStudyId &&
          resolved.studies.some((study) => study.id === resolved.selectedStudyId && !study.hidden)
          ? resolved.selectedStudyId
          : getLastVisibleStudyId(resolved.studies),
      );
    },
    [],
  );

  const applyLoadedScene = useCallback(
    (scene: KumaPickerScene) => {
      applyResolvedScene(resolveSceneStudies(scene, itemsById, toolbarSafeTop, zoom));
      localDirtyRef.current = false;
      setSyncState("connected");
    },
    [applyResolvedScene, itemsById, toolbarSafeTop, zoom],
  );

  const reloadScene = useCallback(async () => {
    try {
      setSyncState("connecting");
      const scene = await fetchScene();
      applyLoadedScene(scene);
      setIsSceneReady(true);
    } catch {
      setSyncState("offline");
      setIsSceneReady(true);
    }
  }, [applyLoadedScene]);

  useEffect(() => {
    let active = true;

    const loadInitialScene = async () => {
      try {
        setSyncState("connecting");
        const scene = await fetchScene();
        if (!active) return;

        applyLoadedScene(scene);
      } catch {
        if (!active) return;
        setSyncState("offline");
      } finally {
        if (active) {
          setIsSceneReady(true);
        }
      }
    };

    void loadInitialScene();

    return () => {
      active = false;
    };
  }, [applyLoadedScene]);

  useEffect(() => {
    if (!isSceneReady) return;
    if (typeof window === "undefined" || typeof window.EventSource === "undefined") return;

    const eventSource = createSceneEventSource();

    const syncFromRemoteEvent = async () => {
      try {
        const scene = await fetchScene();
        applyResolvedScene(resolveSceneStudies(scene, itemsById, toolbarSafeTop, zoom));
        if (syncStateRef.current !== "saving") {
          setSyncState("connected");
        }
      } catch {
        if (syncStateRef.current !== "saving") {
          setSyncState("offline");
        }
      }
    };

    const handleSceneEvent = (event: MessageEvent<string>) => {
      const payload = parseSceneEvent(event.data);
      if (!payload) return;

      if (payload.updatedAt) {
        setLastSavedAt(payload.updatedAt);
      }

      if (payload.source !== "file-watch" && payload.revision === remoteRevisionRef.current) {
        if (syncStateRef.current === "offline") {
          setSyncState("connected");
        }
        return;
      }

      if (pendingMutationCountRef.current > 0 || localDirtyRef.current) {
        pendingRemoteSyncRef.current = true;
        return;
      }

      void syncFromRemoteEvent();
    };

    eventSource.addEventListener("scene", handleSceneEvent as EventListener);
    eventSource.onopen = () => {
      if (syncStateRef.current === "offline" || syncStateRef.current === "connecting") {
        setSyncState("connected");
      }
    };
    eventSource.onerror = () => {
      if (syncStateRef.current !== "saving") {
        setSyncState("offline");
      }
    };

    return () => {
      eventSource.removeEventListener("scene", handleSceneEvent as EventListener);
      eventSource.close();
    };
  }, [applyResolvedScene, isSceneReady, itemsById, toolbarSafeTop, zoom]);

  useEffect(() => {
    if (copyState !== "copied") return;
    const timeoutId = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  const filteredItems = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();

    return items.filter((item) => {
      if (!normalized) return true;

      return [
        item.title,
        item.description ?? "",
        item.category,
        item.componentPath,
        item.sourceKind,
        item.sourceRoute ?? "",
        item.sourceFilePath ?? "",
        ...item.tags,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [deferredQuery, items]);

  const visibleStudies = useMemo(() => sortStudies(studies).filter((study) => !study.hidden), [studies]);
  const isReadOnly = syncState === "offline";

  const queueSceneMutation = useCallback(
    (run: () => Promise<KumaPickerScene>) => {
      if (isReadOnly) return;

      localDirtyRef.current = true;
      pendingMutationCountRef.current += 1;
      setSyncState("saving");

      mutationQueueRef.current = mutationQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const scene = await run();
            applyResolvedScene(resolveSceneStudies(scene, itemsById, toolbarSafeTop, zoom));
          } catch {
            try {
              const scene = await fetchScene();
              applyResolvedScene(resolveSceneStudies(scene, itemsById, toolbarSafeTop, zoom));
              setSyncState("connected");
            } catch {
              setSyncState("offline");
            }
          } finally {
            pendingMutationCountRef.current = Math.max(0, pendingMutationCountRef.current - 1);
            if (pendingMutationCountRef.current === 0) {
              localDirtyRef.current = false;
              if (pendingRemoteSyncRef.current) {
                pendingRemoteSyncRef.current = false;
                void fetchScene()
                  .then((scene) => {
                    applyResolvedScene(resolveSceneStudies(scene, itemsById, toolbarSafeTop, zoom));
                    setSyncState("connected");
                  })
                  .catch(() => {
                    setSyncState("offline");
                  });
              } else if (syncStateRef.current !== "offline") {
                setSyncState("connected");
              }
            } else if (syncStateRef.current !== "offline") {
              setSyncState("saving");
            }
          }
        });
    },
    [applyResolvedScene, isReadOnly, itemsById, toolbarSafeTop, zoom],
  );

  const selectStudy = useCallback(
    (studyId: string | null) => {
      if (selectedStudyId === studyId) {
        setSelectedStudyId(studyId);
        return;
      }

      setSelectedStudyId(studyId);
      if (isReadOnly) return;

      queueSceneMutation(() =>
        updateSceneMeta({
          selectedStudyId: studyId,
        }),
      );
    },
    [isReadOnly, queueSceneMutation, selectedStudyId],
  );

  const addItemToCanvas = useCallback(
    (itemId: string, point?: { x: number; y: number }) => {
      if (isReadOnly) return;

      const item = itemsById.get(itemId);
      if (!item) return;

      const nextStudy = createStudy(item, studiesRef.current, toolbarSafeTop, zoom, point);
      setStudies((current) => [...current, nextStudy]);
      setSelectedStudyId(nextStudy.id);
      queueSceneMutation(async () => {
        await addSceneNode(nextStudy);
        return updateSceneMeta({ selectedStudyId: nextStudy.id });
      });
    },
    [isReadOnly, itemsById, queueSceneMutation, toolbarSafeTop, zoom],
  );

  const bringStudyToFront = useCallback(
    (studyId: string) => {
      if (isReadOnly) return;

      setStudies((current) => {
        const target = current.find((study) => study.id === studyId);
        if (!target || target.locked) return current;

        const nextZIndex = getNextZIndex(current);
        if (target.zIndex === nextZIndex - 1) return current;

        localDirtyRef.current = true;
        return current.map((study) => (study.id === studyId ? { ...study, zIndex: nextZIndex } : study));
      });
    },
    [isReadOnly],
  );

  const updateStudyPosition = useCallback(
    (studyId: string, x: number, y: number) => {
      if (isReadOnly) return;

      localDirtyRef.current = true;
      setStudies((current) =>
        current.map((study) => {
          if (study.id !== studyId || study.locked) return study;
          const nextPosition = clampCanvasPosition(study.viewport, x, y);
          return {
            ...study,
            ...nextPosition,
          };
        }),
      );
    },
    [isReadOnly],
  );

  const commitStudyPlacement = useCallback(
    (studyId: string) => {
      if (isReadOnly) return;

      const study = studiesRef.current.find((currentStudy) => currentStudy.id === studyId);
      if (!study || study.locked) return;

      queueSceneMutation(() =>
        updateSceneNode(studyId, {
          x: study.x,
          y: study.y,
          zIndex: study.zIndex,
        }),
      );
    },
    [isReadOnly, queueSceneMutation],
  );

  const updateStudyViewport = useCallback(
    (studyId: string, viewport: KumaPickerViewport) => {
      let patch: { viewport: KumaPickerViewport; x: number; y: number } | null = null;

      setStudies((current) =>
        current.map((study) => {
          if (study.id !== studyId || study.locked) return study;

          const nextPosition = clampCanvasPosition(viewport, study.x, study.y);
          const nextStudy = {
            ...study,
            viewport,
            ...nextPosition,
          };

          patch = {
            viewport,
            x: nextPosition.x,
            y: nextPosition.y,
          };

          return nextStudy;
        }),
      );

      if (!patch || isReadOnly) return;
      queueSceneMutation(() => updateSceneNode(studyId, patch as { viewport: KumaPickerViewport; x: number; y: number }));
    },
    [isReadOnly, queueSceneMutation],
  );

  const removeStudy = useCallback(
    (studyId: string) => {
      if (isReadOnly) return;

      setStudies((current) => current.filter((study) => study.id !== studyId));
      const nextStudies = studiesRef.current.filter((study) => study.id !== studyId);
      const nextSelectedStudyId = selectedStudyId === studyId ? getLastVisibleStudyId(nextStudies) : selectedStudyId;
      setSelectedStudyId((selected) => {
        if (selected !== studyId) return selected;
        return nextSelectedStudyId;
      });

      queueSceneMutation(async () => {
        await removeSceneNode(studyId);
        return updateSceneMeta({ selectedStudyId: nextSelectedStudyId });
      });
    },
    [isReadOnly, queueSceneMutation, selectedStudyId],
  );

  const clearBoard = useCallback(() => {
    if (isReadOnly) return;

    const studyIds = studiesRef.current.map((study) => study.id);
    if (studyIds.length === 0) return;

    setStudies([]);
    setSelectedStudyId(null);
    queueSceneMutation(async () => {
      await Promise.all(studyIds.map((studyId) => removeSceneNode(studyId)));
      return updateSceneMeta({ selectedStudyId: null });
    });
  }, [isReadOnly, queueSceneMutation]);

  const arrangeBoard = useCallback(() => {
    if (isReadOnly) return;

    const previousStudies = studiesRef.current;
    const nextStudies = autoArrangeStudies(previousStudies, itemsById, toolbarSafeTop, zoom);
    setStudies(nextStudies);
    queueSceneMutation(async () => {
      const changedStudies = nextStudies.filter((study) => {
        const previousStudy = previousStudies.find((candidate) => candidate.id === study.id);
        return previousStudy && (previousStudy.x !== study.x || previousStudy.y !== study.y);
      });

      await Promise.all(
        changedStudies.map((study) =>
          updateSceneNode(study.id, {
            x: study.x,
            y: study.y,
          }),
        ),
      );

      return fetchScene();
    });
  }, [isReadOnly, itemsById, queueSceneMutation, toolbarSafeTop, zoom]);

  const exportLayout = useCallback(async () => {
    if (isReadOnly) return;

    const payload = sortStudies(studiesRef.current).map((study) => {
      const item = itemsById.get(study.itemId);
      return {
        studyId: study.id,
        itemId: study.itemId,
        title: study.title,
        viewport: study.viewport,
        x: study.x,
        y: study.y,
        zIndex: study.zIndex,
        hidden: Boolean(study.hidden),
        locked: Boolean(study.locked),
        path: item?.componentPath ?? "",
      };
    });

    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopyState("copied");
  }, [isReadOnly, itemsById]);

  return {
    copyState,
    filteredItems,
    isReadOnly,
    lastSavedAt,
    query,
    reloadScene,
    selectedStudyId,
    setQuery,
    setToolbarSafeTop,
    setZoom: (value: number) => setZoom(clampZoom(value)),
    selectStudy,
    syncState,
    toolbarSafeTop,
    visibleStudies,
    zoom,
    actions: {
      addItemToCanvas,
      arrangeBoard,
      bringStudyToFront,
      clearBoard,
      commitStudyPlacement,
      exportLayout,
      removeStudy,
      updateStudyPosition,
      updateStudyViewport,
    },
  };
}
