function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function startResearchForContent({
  contentItem,
  contentStore,
  experimentStore,
  experimentPipeline,
  sourceTrend = null,
} = {}) {
  if (!contentItem) {
    throw new Error("contentItem is required.");
  }
  if (!contentStore) {
    throw new Error("contentStore is required.");
  }
  if (!experimentStore) {
    throw new Error("experimentStore is required.");
  }
  if (!experimentPipeline) {
    throw new Error("experimentPipeline is required.");
  }

  const linkedExperiment =
    (contentItem.experimentId ? experimentStore.readById(contentItem.experimentId) : null) ??
    experimentStore.readBySourceContentId?.(contentItem.id) ??
    null;

  if (linkedExperiment) {
    const content = contentStore.update(contentItem.id, { experimentId: linkedExperiment.id });
    return {
      created: false,
      content,
      experiment: linkedExperiment,
    };
  }

  const created = experimentStore.write({
    title: contentItem.title,
    source: "ai-trend",
    status: "proposed",
    sourceContentId: contentItem.id,
    sourceTrendId: normalizeOptionalString(contentItem.sourceTrendId) ?? normalizeOptionalString(sourceTrend?.id),
    researchScore: contentItem.researchScore ?? null,
  });
  const started = experimentStore.update(created.id, {
    status: "in-progress",
    ...experimentPipeline.start(created),
  });
  const content = contentStore.update(contentItem.id, {
    experimentId: started?.id ?? created.id,
  });

  return {
    created: true,
    content,
    experiment: started ?? created,
  };
}
