import teamData from "../../../shared/team.json";
import { KUMA_TEAM } from "../types/agent";
import type { Agent } from "../types/agent";
import type { OfficeCharacter, OfficeFurniture, OfficeLayoutSnapshot, OfficeScene } from "../types/office";

// ---------------------------------------------------------------------------
// Team zone layout — dynamic desk/sofa generation
// ---------------------------------------------------------------------------

interface TeamZoneConfig {
  origin: { x: number; y: number };
  cols: number;
}

const TEAM_ZONE_LAYOUT: Record<string, TeamZoneConfig> = {
  management: { origin: { x: 830, y: 100 }, cols: 2 },
  dev:        { origin: { x: 200, y: 580 }, cols: 3 },
  analytics:  { origin: { x: 1350, y: 580 }, cols: 2 },
  strategy:   { origin: { x: 750, y: 1250 }, cols: 3 },
};

const DESK_SPACING = { x: 220, y: 180 };
const SOFA_GAP_Y = 70;

// Teams that get a sofa
const SOFA_TEAMS = ["management", "dev", "analytics", "strategy"];

// ---------------------------------------------------------------------------
// Scene member data
// ---------------------------------------------------------------------------

const SCENE_TEAM_MEMBERS = teamData.members.map((member) => ({
  ...member,
  id: member.id,
  parentId: member.parentId ?? null,
}));

const TEAM_ORDER_INDEX = new Map(teamData.teams.map((team, index) => [team.id, index]));
const MEMBER_ORDER_INDEX = new Map(SCENE_TEAM_MEMBERS.map((member, index) => [member.id, index]));

// ---------------------------------------------------------------------------
// Dynamic position computation
// ---------------------------------------------------------------------------

/** Group members by team */
function groupByTeam(members: typeof SCENE_TEAM_MEMBERS) {
  const groups = new Map<string, typeof members>();
  for (const member of members) {
    const list = groups.get(member.team) ?? [];
    list.push(member);
    groups.set(member.team, list);
  }
  return groups;
}

/** Compute desk position for a member within their team zone */
function computeDeskPosition(teamId: string, indexInTeam: number): { x: number; y: number } {
  const config = TEAM_ZONE_LAYOUT[teamId] ?? TEAM_ZONE_LAYOUT.dev;
  const col = indexInTeam % config.cols;
  const row = Math.floor(indexInTeam / config.cols);
  return {
    x: config.origin.x + col * DESK_SPACING.x,
    y: config.origin.y + row * DESK_SPACING.y,
  };
}

/** Compute sofa center position for a team */
function computeSofaCenter(teamId: string, memberCount: number): { x: number; y: number } {
  const config = TEAM_ZONE_LAYOUT[teamId] ?? TEAM_ZONE_LAYOUT.dev;
  const rows = Math.ceil(memberCount / config.cols);
  return {
    x: config.origin.x + (config.cols - 1) * DESK_SPACING.x / 2,
    y: config.origin.y + rows * DESK_SPACING.y + SOFA_GAP_Y,
  };
}

// ---------------------------------------------------------------------------
// Build desk & sofa position maps (computed once from team data)
// ---------------------------------------------------------------------------

const teamGroups = groupByTeam(SCENE_TEAM_MEMBERS);

/** Member ID → desk position */
export const DESK_POSITIONS: Record<string, { x: number; y: number }> = {};

/** Team ID → sofa center position */
export const SOFA_POSITIONS: Record<string, { x: number; y: number }> = {};

for (const [teamId, members] of teamGroups) {
  members.forEach((member, index) => {
    DESK_POSITIONS[member.id] = computeDeskPosition(teamId, index);
  });

  if (SOFA_TEAMS.includes(teamId)) {
    SOFA_POSITIONS[teamId] = computeSofaCenter(teamId, members.length);
  }
}

/**
 * TEAM_POSITIONS — used for initial placement & hierarchy lines.
 * Characters start at their desk position.
 */
export const TEAM_POSITIONS: Record<string, { x: number; y: number }> = { ...DESK_POSITIONS };

// ---------------------------------------------------------------------------
// Auto-positioning: working → desk, idle → sofa scatter
// ---------------------------------------------------------------------------

/** Get the target position for a character based on their current state.
 *  Accepts optional project-specific position maps for per-project offices. */
export function getAutoPosition(
  memberId: string,
  state: string,
  team: string,
  deskPos: Record<string, { x: number; y: number }> = DESK_POSITIONS,
  sofaPos: Record<string, { x: number; y: number }> = SOFA_POSITIONS,
): { x: number; y: number } | null {
  if (state === "working" || state === "thinking") {
    return deskPos[memberId] ?? null;
  }

  if (state === "idle" || state === "completed") {
    const sofaCenter = sofaPos[team];
    if (!sofaCenter) {
      // Unknown team — stay at desk
      return deskPos[memberId] ?? null;
    }
    // Scatter around sofa based on member ID hash
    const hash = memberId.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const angle = (hash % 6) * (Math.PI / 3);
    const radius = 40 + (hash % 30);
    return {
      x: sofaCenter.x + Math.cos(angle) * radius,
      y: sofaCenter.y + Math.sin(angle) * radius - 20,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Dynamic furniture generation
// ---------------------------------------------------------------------------

/** Build furniture list dynamically based on team members */
export function buildDynamicFurniture(members: typeof SCENE_TEAM_MEMBERS = SCENE_TEAM_MEMBERS): OfficeFurniture[] {
  const furniture: OfficeFurniture[] = [];
  const groups = groupByTeam(members);

  // Generate 1 desk per member
  for (const [teamId, teamMembers] of groups) {
    teamMembers.forEach((member, index) => {
      const pos = computeDeskPosition(teamId, index);
      furniture.push({
        id: `desk-${member.id}`,
        type: "desk",
        position: pos,
        imageUrl: "",
      });
    });
  }

  // Generate 1 sofa per team
  for (const teamId of SOFA_TEAMS) {
    const teamMembers = groups.get(teamId);
    if (!teamMembers || teamMembers.length === 0) continue;
    const pos = computeSofaCenter(teamId, teamMembers.length);
    furniture.push({
      id: `sofa-${teamId}`,
      type: "sofa",
      position: pos,
      imageUrl: "",
    });
  }

  // Decorative furniture — positioned to complement team zones
  furniture.push(
    { id: "whiteboard-1", type: "whiteboard", position: { x: 650, y: 120 }, imageUrl: "" },
    { id: "plant-1", type: "plant", position: { x: 70, y: 70 }, imageUrl: "" },
    { id: "plant-2", type: "plant", position: { x: 1900, y: 70 }, imageUrl: "" },
    { id: "plant-3", type: "plant", position: { x: 70, y: 1600 }, imageUrl: "" },
    { id: "plant-4", type: "plant", position: { x: 1900, y: 1600 }, imageUrl: "" },
    { id: "coffee-1", type: "coffee", position: { x: 980, y: 850 }, imageUrl: "" },
    { id: "bookshelf-1", type: "bookshelf", position: { x: 70, y: 850 }, imageUrl: "" },
    { id: "watercooler-1", type: "watercooler", position: { x: 1900, y: 850 }, imageUrl: "" },
  );

  return furniture;
}

// ---------------------------------------------------------------------------
// Default characters
// ---------------------------------------------------------------------------

function getOverflowPosition(index: number): { x: number; y: number } {
  return {
    x: 80 + (index % 4) * 200,
    y: 120 + Math.floor(index / 4) * 160,
  };
}

export function buildDefaultOfficeCharacters(team: Agent[] = KUMA_TEAM): OfficeCharacter[] {
  return team.map((agent, index) => ({
    ...agent,
    position: TEAM_POSITIONS[agent.id] ?? getOverflowPosition(index),
    spriteSheet: "",
    image: agent.image,
  }));
}

export const DEFAULT_OFFICE_CHARACTERS: OfficeCharacter[] = buildDefaultOfficeCharacters();

// ---------------------------------------------------------------------------
// Default scene (uses dynamic furniture)
// ---------------------------------------------------------------------------

export const DEFAULT_OFFICE_FURNITURE: OfficeFurniture[] = buildDynamicFurniture();

export const DEFAULT_OFFICE_SCENE: OfficeScene = {
  characters: DEFAULT_OFFICE_CHARACTERS,
  furniture: DEFAULT_OFFICE_FURNITURE,
  background: "woodland-office",
};

// ---------------------------------------------------------------------------
// Canvas & furniture sizes
// ---------------------------------------------------------------------------

export const OFFICE_CANVAS_SIZE = {
  width: 900,
  height: 600,
} as const;

export const FURNITURE_SIZES: Record<string, { w: number; h: number }> = {
  desk: { w: 200, h: 144 },
  chair: { w: 100, h: 100 },
  whiteboard: { w: 200, h: 160 },
  plant: { w: 90, h: 110 },
  coffee: { w: 170, h: 128 },
  bookshelf: { w: 150, h: 170 },
  sofa: { w: 200, h: 144 },
  printer: { w: 128, h: 128 },
  watercooler: { w: 90, h: 112 },
};

// ---------------------------------------------------------------------------
// Team zones — visual grouping (NO labels — labels removed per spec)
// ---------------------------------------------------------------------------

export interface TeamZone {
  team: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const TEAM_ZONE_COLORS: Record<string, string> = {
  management: "rgba(217, 119, 6, 0.04)",
  dev: "rgba(59, 130, 246, 0.05)",
  analytics: "rgba(249, 115, 22, 0.05)",
  strategy: "rgba(34, 197, 94, 0.05)",
};

function buildTeamZonesForMembers(members: typeof SCENE_TEAM_MEMBERS): TeamZone[] {
  const groups = groupByTeam(members);
  const zones: TeamZone[] = [];

  for (const [teamId, teamMembers] of groups) {
    const config = TEAM_ZONE_LAYOUT[teamId];
    if (!config) continue;

    const rows = Math.ceil(teamMembers.length / config.cols);
    const hasSofa = SOFA_TEAMS.includes(teamId);
    const pad = 60;

    zones.push({
      team: teamId,
      color: TEAM_ZONE_COLORS[teamId] ?? "rgba(107, 114, 128, 0.04)",
      x: config.origin.x - pad,
      y: config.origin.y - pad,
      w: (config.cols - 1) * DESK_SPACING.x + 200 + pad * 2,
      h: (rows - 1) * DESK_SPACING.y + 144 + (hasSofa ? SOFA_GAP_Y + 144 : 0) + pad * 2,
    });
  }

  return zones;
}

function buildTeamZones(): TeamZone[] {
  return buildTeamZonesForMembers(SCENE_TEAM_MEMBERS);
}

export const TEAM_ZONES: TeamZone[] = buildTeamZones();

// ---------------------------------------------------------------------------
// Project layout — per-project office generation
// ---------------------------------------------------------------------------

export interface ProjectLayout {
  furniture: OfficeFurniture[];
  deskPositions: Record<string, { x: number; y: number }>;
  sofaPositions: Record<string, { x: number; y: number }>;
  teamZones: TeamZone[];
}

/** Build a complete office layout for a given set of member IDs.
 *  When memberIds is null/undefined, builds for ALL members (default view). */
export function buildProjectLayout(memberIds?: string[] | null): ProjectLayout {
  const members = memberIds
    ? SCENE_TEAM_MEMBERS.filter((m) => memberIds.includes(m.id))
    : SCENE_TEAM_MEMBERS;

  const groups = groupByTeam(members);
  const deskPositions: Record<string, { x: number; y: number }> = {};
  const sofaPositions: Record<string, { x: number; y: number }> = {};

  for (const [teamId, teamMembers] of groups) {
    teamMembers.forEach((member, index) => {
      deskPositions[member.id] = computeDeskPosition(teamId, index);
    });
    if (SOFA_TEAMS.includes(teamId) && teamMembers.length > 0) {
      sofaPositions[teamId] = computeSofaCenter(teamId, teamMembers.length);
    }
  }

  return {
    furniture: buildDynamicFurniture(members),
    deskPositions,
    sofaPositions,
    teamZones: buildTeamZonesForMembers(members),
  };
}

/** Default project layout (all members) */
export const DEFAULT_PROJECT_LAYOUT: ProjectLayout = {
  furniture: DEFAULT_OFFICE_FURNITURE,
  deskPositions: { ...DESK_POSITIONS },
  sofaPositions: { ...SOFA_POSITIONS },
  teamZones: TEAM_ZONES,
};

// ---------------------------------------------------------------------------
// Hierarchy connection lines
// ---------------------------------------------------------------------------

const TEAM_HIERARCHY_COLORS: Record<string, { lead: string; member: string }> = {
  dev: { lead: "rgba(59, 130, 246, 0.15)", member: "rgba(59, 130, 246, 0.1)" },
  analytics: { lead: "rgba(249, 115, 22, 0.15)", member: "rgba(249, 115, 22, 0.1)" },
  strategy: { lead: "rgba(34, 197, 94, 0.15)", member: "rgba(34, 197, 94, 0.1)" },
};

export const HIERARCHY_LINES: { from: string; to: string; color: string }[] = SCENE_TEAM_MEMBERS
  .filter((member) => member.parentId != null)
  .sort((left, right) => {
    const leadPriority = (left.nodeType === "team" ? 0 : 1) - (right.nodeType === "team" ? 0 : 1);
    if (leadPriority !== 0) return leadPriority;

    const teamOrder = (TEAM_ORDER_INDEX.get(left.team) ?? Number.MAX_SAFE_INTEGER)
      - (TEAM_ORDER_INDEX.get(right.team) ?? Number.MAX_SAFE_INTEGER);
    if (teamOrder !== 0) return teamOrder;

    return (MEMBER_ORDER_INDEX.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (MEMBER_ORDER_INDEX.get(right.id) ?? Number.MAX_SAFE_INTEGER);
  })
  .map((member) => {
    const colors = TEAM_HIERARCHY_COLORS[member.team] ?? {
      lead: "rgba(107, 114, 128, 0.15)",
      member: "rgba(107, 114, 128, 0.1)",
    };

    return {
      from: member.parentId ?? "kuma",
      to: member.id,
      color: member.nodeType === "team" ? colors.lead : colors.member,
    };
  });

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function sceneToLayout(scene: OfficeScene): OfficeLayoutSnapshot {
  return {
    background: scene.background,
    characters: scene.characters.map((character) => ({
      id: character.id,
      position: character.position,
    })),
    furniture: scene.furniture.map((furniture) => ({
      id: furniture.id,
      type: furniture.type,
      position: furniture.position,
      imageUrl: furniture.imageUrl,
    })),
  };
}

// ---------------------------------------------------------------------------
// Animal fallbacks (used by office-capture.ts)
// ---------------------------------------------------------------------------

function createAnimalFallback(animal: string, used: Set<string>): string {
  const normalized = animal.trim().toLowerCase();
  for (let length = 1; length <= normalized.length; length += 1) {
    const candidate = normalized.slice(0, length);
    const fallback = candidate[0].toUpperCase() + candidate.slice(1);
    if (!used.has(fallback)) {
      used.add(fallback);
      return fallback;
    }
  }
  let suffix = 2;
  while (true) {
    const fallback = `${normalized[0].toUpperCase()}${suffix}`;
    if (!used.has(fallback)) {
      used.add(fallback);
      return fallback;
    }
    suffix += 1;
  }
}

export const ANIMAL_FALLBACKS: Record<string, string> = (() => {
  const used = new Set<string>();
  const animals = Array.from(new Set(SCENE_TEAM_MEMBERS.map((member) => member.animal.en)));
  return Object.fromEntries(
    animals.map((animal) => [animal, createAnimalFallback(animal, used)]),
  );
})();

/** Sofa team label lookup (for rendering labels on sofa furniture) */
export const SOFA_TEAM_LABELS: Record<string, string> = {
  dev: "개발팀 휴게실",
  analytics: "분석팀 휴게실",
  strategy: "전략팀 휴게실",
};

/** Desk member info lookup (for rendering name plates on desk furniture) */
const TEAM_NAME_KO_MAP: Record<string, string> = Object.fromEntries(
  teamData.teams.map((team) => [team.id, team.name.ko]),
);

export const DESK_MEMBER_INFO: Record<string, { name: string; teamName: string; emoji: string }> = Object.fromEntries(
  SCENE_TEAM_MEMBERS.map((member) => [
    member.id,
    { name: member.name.ko, teamName: TEAM_NAME_KO_MAP[member.team] ?? member.team, emoji: member.emoji },
  ]),
);
