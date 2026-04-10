export function normalizeTeamConfigHashValue(value) {
  if (typeof value === "string") {
    return value.trim().replace(/\s+/gu, " ");
  }

  if (value == null) {
    return "";
  }

  return String(value);
}

export function toCanonicalTeamConfigHashShape(memberConfig = {}) {
  return {
    type: normalizeTeamConfigHashValue(memberConfig?.spawnType ?? memberConfig?.type),
    model: normalizeTeamConfigHashValue(memberConfig?.spawnModel ?? memberConfig?.model),
    options: normalizeTeamConfigHashValue(memberConfig?.spawnOptions ?? memberConfig?.options),
  };
}

export function buildTeamConfigSelfWriteHash(memberConfig = {}) {
  const canonical = toCanonicalTeamConfigHashShape(memberConfig);
  return `${canonical.type}\u0000${canonical.model}\u0000${canonical.options}`;
}
