import { TEAM_DATA } from "./team-schema.mjs";

const TEAMS = Array.isArray(TEAM_DATA.teams) ? TEAM_DATA.teams : [];
const MEMBERS = Array.isArray(TEAM_DATA.members) ? TEAM_DATA.members : [];

const MEMBER_ID_BY_DISPLAY_NAME = new Map(
  MEMBERS.flatMap((member) => {
    const displayName = member?.name?.ko;
    const { id } = member ?? {};
    return typeof displayName === "string" && typeof id === "string" ? [[displayName, id]] : [];
  }),
);

const MEMBERS_BY_ID = new Map(
  MEMBERS.flatMap((member) => {
    const { id } = member ?? {};
    return typeof id === "string" ? [[id, member]] : [];
  }),
);

const MEMBERS_BY_TEAM_ID = MEMBERS.reduce((map, member) => {
  const teamId = member?.team;
  if (typeof teamId !== "string") {
    return map;
  }

  const teamMembers = map.get(teamId) ?? [];
  teamMembers.push(member);
  map.set(teamId, teamMembers);
  return map;
}, new Map());

const TEAM_BY_SKILL_ID = new Map(
  TEAMS.flatMap((team) => {
    const skillId = normalizeSkillId(team?.skill);
    return skillId ? [[skillId, team]] : [];
  }),
);

const ACTIVE_TEAM_SKILL_IDS = Array.from(TEAM_BY_SKILL_ID.keys()).filter((skillId) => {
  const team = TEAM_BY_SKILL_ID.get(skillId);
  return typeof team?.pm === "string" && team.pm.length > 0;
});

function normalizeSkillId(skill) {
  return typeof skill === "string" ? skill.replace(/^\//u, "").trim() : "";
}

function toTeamMemberMetadata(member) {
  const displayName = member?.name?.ko;
  if (typeof displayName !== "string") {
    return null;
  }

  const id = MEMBER_ID_BY_DISPLAY_NAME.get(displayName);
  if (!id) {
    return null;
  }

  const fullMember = MEMBERS_BY_ID.get(id);
  if (!fullMember) {
    return null;
  }

  return {
    id,
    emoji: typeof fullMember.emoji === "string" ? fullMember.emoji : "",
    displayName,
    model: typeof fullMember.model === "string" ? fullMember.model : "",
    role: typeof fullMember.role?.ko === "string" ? fullMember.role.ko : "",
  };
}

function getTeamEmoji(team) {
  const pmId = typeof team?.pm === "string" ? team.pm : "";
  const pmMember = pmId ? MEMBERS_BY_ID.get(pmId) : null;

  if (typeof pmMember?.emoji === "string") {
    return pmMember.emoji;
  }

  const fallbackMember = (MEMBERS_BY_TEAM_ID.get(team?.id) ?? [])[0];
  return typeof fallbackMember?.emoji === "string" ? fallbackMember.emoji : "";
}

export function loadTeamMetadata(root = ".") {
  void root;

  const teams = ACTIVE_TEAM_SKILL_IDS.map((skillId) => {
    const team = TEAM_BY_SKILL_ID.get(skillId);
    const members = team ? MEMBERS_BY_TEAM_ID.get(team.id) ?? [] : [];

    return {
      name: skillId,
      emoji: getTeamEmoji(team),
      members: members.map(toTeamMemberMetadata).filter(Boolean),
    };
  });

  return { teams };
}

/**
 * Returns the agent hierarchy derived from team.json members.
 * Each entry: { id, nodeType, parentId, team }
 */
export function getAgentHierarchy() {
  return MEMBERS.map((member) => ({
    id: member.id,
    nodeType: member.nodeType,
    parentId: member.parentId ?? null,
    team: member.team,
  }));
}

/**
 * Returns a Map of member id → full member object from team.json.
 */
export function getMembersById() {
  return new Map(MEMBERS_BY_ID);
}

/**
 * Returns a Map of team id → array of member objects.
 */
export function getMembersByTeamId() {
  return new Map(
    Array.from(MEMBERS_BY_TEAM_ID.entries()).map(([k, v]) => [k, [...v]]),
  );
}

/**
 * Resolve a member id by their role keyword pattern.
 * Used by CLI set-agent-status to map descriptors to team member ids.
 */
export function resolveAgentIdByDescriptor({ description, subagentType, model }) {
  const desc = String(description ?? "").toLowerCase();
  const sub = String(subagentType ?? "").toLowerCase();
  const mdl = String(model ?? "").toLowerCase();

  const includesAny = (haystack, needles) =>
    needles.some((needle) => haystack.includes(needle));

  const findMemberById = (memberId) => (MEMBERS_BY_ID.has(memberId) ? memberId : null);
  const findMemberByRole = (teamId, roleIds) => {
    const teamMembers = MEMBERS_BY_TEAM_ID.get(teamId) ?? [];
    for (const member of teamMembers) {
      if (member.nodeType !== "worker") continue;
      if (roleIds.includes(member.roleId)) {
        return member.id;
      }
    }
    return null;
  };

  const findMemberByCapability = (teamId, capabilityIds) => {
    const teamMembers = MEMBERS_BY_TEAM_ID.get(teamId) ?? [];
    for (const member of teamMembers) {
      if (member.nodeType !== "worker") continue;
      const capabilities = Array.isArray(member.capabilities) ? member.capabilities : [];
      if (capabilityIds.some((capability) => capabilities.includes(capability))) {
        return member.id;
      }
    }
    return null;
  };

  if (sub === "codex") {
    // Review/critic → 새미
    if (includesAny(desc, ["review", "critic", "qa", "quality", "리뷰", "검토", "품질", "비평"])) {
      return findMemberByRole("dev", ["review"])
        ?? findMemberByCapability("dev", ["review", "security", "quality"])
        ?? "saemi";
    }

    // Code analysis → 다람이 (now in dev team)
    if (includesAny(desc, ["analysis", "analyze", "inspect", "explore", "trace", "investigate", "코드 분석", "분석", "구조", "의존성", "탐색", "조사"])) {
      return findMemberById("darami")
        ?? findMemberByRole("dev", ["developer"])
        ?? "tookdaki";
    }

    // Default codex worker → 뚝딱이
    return findMemberByRole("dev", ["developer"])
      ?? findMemberByCapability("dev", ["code", "implementation", "debug"])
      ?? "tookdaki";
  }

  if (mdl.includes("sonnet")) {
    // Research → find researcher in analytics team
    if (includesAny(desc, ["research", "search", "web", "market", "docs", "documentation", "리서치", "검색", "웹", "시장", "문서", "조사"])) {
      return findMemberByRole("analytics", ["researcher"])
        ?? findMemberByCapability("analytics", ["research", "web-search", "market-research"])
        ?? "buri";
    }

    // Default sonnet → find QA/build member in dev team
    return findMemberByRole("dev", ["qa"])
      ?? findMemberByCapability("dev", ["qa", "build", "deploy"])
      ?? "bamdori";
  }

  if (mdl.includes("opus")) {
    // Opus model → find designer/publisher in dev team
    return findMemberByRole("dev", ["ui"])
      ?? findMemberByCapability("dev", ["design", "frontend", "graphics"])
      ?? "koon";
  }

  return null;
}
