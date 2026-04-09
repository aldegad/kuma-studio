import { teamData } from "./team-schema";
import { KUMA_TEAM } from "../types/agent";
import type { Agent } from "../types/agent";
import type { OfficeCharacter, OfficeFurniture, OfficeLayoutSnapshot, OfficeScene } from "../types/office";

// ---------------------------------------------------------------------------
// Team zone layout — dynamic desk/sofa generation
// ---------------------------------------------------------------------------

interface TeamZoneConfig {
  origin: { x: number; y: number };
  cols: number;
  hasSofa: boolean;
  zoneColor: string;
}

const DESK_SPACING = { x: 220, y: 180 };
const SOFA_GAP_Y = 70;
const WORKING_POSITION_OFFSET = { x: 28, y: 18 };
const WORKING_POSITION_JITTER = { x: 6, y: 4 };
const IDLE_SOFA_ORIGIN_OFFSET_Y = 12;
const IDLE_BASE_RADIUS = 92;
const IDLE_RADIUS_STEP = 24;
const IDLE_MIN_GAP = 70;
const SOFA_EXCLUSION_RADIUS = { x: 92, y: 60 };
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DEFAULT_TEAM_ZONE_CONFIG: TeamZoneConfig = {
  origin: { x: 220, y: 160 },
  cols: 2,
  hasSofa: true,
  zoneColor: "rgba(107, 114, 128, 0.04)",
};

// ---------------------------------------------------------------------------
// Scene member data
// ---------------------------------------------------------------------------

const OFFICE_TEAM_MEMBERS = teamData.members.map((member) => ({
  ...member,
  id: member.id,
  parentId: member.parentId ?? null,
}));

const TEAM_CONFIG_BY_ID = new Map<string, TeamZoneConfig>(
  teamData.teams.map((team) => [
    team.id,
    {
      origin: team.office.origin,
      cols: team.office.cols,
      hasSofa: team.office.hasSofa,
      zoneColor: team.office.zoneColor,
    },
  ]),
);
const SOFA_TEAM_IDS = teamData.teams.filter((team) => team.office.hasSofa).map((team) => team.id);
const TEAM_ORDER_INDEX = new Map(teamData.teams.map((team, index) => [team.id, index]));
const MEMBER_ORDER_INDEX = new Map(OFFICE_TEAM_MEMBERS.map((member, index) => [member.id, index]));

// ---------------------------------------------------------------------------
// Dynamic position computation
// ---------------------------------------------------------------------------

/** Group members by team */
function groupByTeam(members: typeof OFFICE_TEAM_MEMBERS) {
  const groups = new Map<string, typeof members>();
  for (const member of members) {
    const list = groups.get(member.team) ?? [];
    list.push(member);
    groups.set(member.team, list);
  }
  return groups;
}

function getTeamZoneConfig(teamId: string): TeamZoneConfig {
  return TEAM_CONFIG_BY_ID.get(teamId) ?? DEFAULT_TEAM_ZONE_CONFIG;
}

/** Compute desk position for a member within their team zone */
function computeDeskPosition(teamId: string, indexInTeam: number): { x: number; y: number } {
  const config = getTeamZoneConfig(teamId);
  const col = indexInTeam % config.cols;
  const row = Math.floor(indexInTeam / config.cols);
  return {
    x: config.origin.x + col * DESK_SPACING.x,
    y: config.origin.y + row * DESK_SPACING.y,
  };
}

/** Compute sofa center position for a team */
function computeSofaCenter(teamId: string, memberCount: number): { x: number; y: number } {
  const config = getTeamZoneConfig(teamId);
  const rows = Math.ceil(memberCount / config.cols);
  return {
    x: config.origin.x + (config.cols - 1) * DESK_SPACING.x / 2,
    y: config.origin.y + rows * DESK_SPACING.y + SOFA_GAP_Y,
  };
}

function getMemberStableHash(memberId: string): number {
  return memberId.split("").reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
}

function distanceBetween(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isInsideSofaExclusionZone(
  point: { x: number; y: number },
  sofaCenter: { x: number; y: number },
): boolean {
  const dx = (point.x - sofaCenter.x) / SOFA_EXCLUSION_RADIUS.x;
  const dy = (point.y - sofaCenter.y) / SOFA_EXCLUSION_RADIUS.y;
  return dx * dx + dy * dy < 1;
}

function computeWorkingPosition(
  memberId: string,
  deskAnchor: { x: number; y: number },
): { x: number; y: number } {
  const hash = getMemberStableHash(memberId);
  const jitterX = ((hash % 3) - 1) * WORKING_POSITION_JITTER.x;
  const jitterY = ((Math.floor(hash / 3) % 3) - 1) * WORKING_POSITION_JITTER.y;

  return {
    x: deskAnchor.x + WORKING_POSITION_OFFSET.x + jitterX,
    y: deskAnchor.y + WORKING_POSITION_OFFSET.y + jitterY,
  };
}

function buildIdleScatterPositions(
  sofaCenter: { x: number; y: number },
  teamMemberIds: string[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const orderedMemberIds = teamMemberIds
    .slice()
    .sort((left, right) => (MEMBER_ORDER_INDEX.get(left) ?? 0) - (MEMBER_ORDER_INDEX.get(right) ?? 0));
  const scatterOrigin = {
    x: sofaCenter.x,
    y: sofaCenter.y + IDLE_SOFA_ORIGIN_OFFSET_Y,
  };

  for (const [index, memberId] of orderedMemberIds.entries()) {
    const hash = getMemberStableHash(memberId);
    let angle = -Math.PI / 2 + index * GOLDEN_ANGLE + ((hash % 11) - 5) * 0.04;
    let radius = IDLE_BASE_RADIUS + Math.floor(index / 5) * IDLE_RADIUS_STEP + (hash % 9);
    let candidate = {
      x: scatterOrigin.x + Math.cos(angle) * radius,
      y: scatterOrigin.y + Math.sin(angle) * Math.max(radius * 0.72, 62),
    };

    let attempts = 0;
    while (attempts < 18) {
      const overlappingMember = Array.from(positions.values()).find(
        (position) => distanceBetween(position, candidate) < IDLE_MIN_GAP,
      );
      const onSofa = isInsideSofaExclusionZone(candidate, sofaCenter);

      if (!overlappingMember && !onSofa) {
        break;
      }

      angle += 0.42;
      radius += 10;
      candidate = {
        x: scatterOrigin.x + Math.cos(angle) * radius,
        y: scatterOrigin.y + Math.sin(angle) * Math.max(radius * 0.72, 62),
      };
      attempts += 1;
    }

    positions.set(memberId, candidate);
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Build desk & sofa position maps (computed once from team data)
// ---------------------------------------------------------------------------

const teamGroups = groupByTeam(OFFICE_TEAM_MEMBERS);
const TEAM_MEMBER_IDS_BY_TEAM = Object.fromEntries(
  Array.from(teamGroups.entries()).map(([teamId, members]) => [teamId, members.map((member) => member.id)]),
) as Record<string, string[]>;

/** Member ID → desk position */
export const DESK_POSITIONS: Record<string, { x: number; y: number }> = {};

/** Team ID → sofa center position */
export const SOFA_POSITIONS: Record<string, { x: number; y: number }> = {};

for (const [teamId, members] of teamGroups) {
  members.forEach((member, index) => {
    DESK_POSITIONS[member.id] = computeDeskPosition(teamId, index);
  });

  if (getTeamZoneConfig(teamId).hasSofa) {
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

function getIdleTeamMemberIds(
  team: string,
  memberId: string,
  teamMemberIdsByTeam: Record<string, string[]>,
): string[] {
  const fullTeamMemberIds = TEAM_MEMBER_IDS_BY_TEAM[team];
  if (Array.isArray(fullTeamMemberIds) && fullTeamMemberIds.length > 0) {
    return fullTeamMemberIds;
  }

  const scopedTeamMemberIds = teamMemberIdsByTeam[team];
  if (Array.isArray(scopedTeamMemberIds) && scopedTeamMemberIds.length > 0) {
    return scopedTeamMemberIds.includes(memberId) ? scopedTeamMemberIds : [...scopedTeamMemberIds, memberId];
  }

  return [memberId];
}

/** Get the target position for a character based on their current state.
 *  Accepts optional project-specific position maps for per-project offices. */
export function getAutoPosition(
  memberId: string,
  state: string,
  team: string,
  deskPos: Record<string, { x: number; y: number }> = DESK_POSITIONS,
  sofaPos: Record<string, { x: number; y: number }> = SOFA_POSITIONS,
  teamMemberIdsByTeam: Record<string, string[]> = TEAM_MEMBER_IDS_BY_TEAM,
): { x: number; y: number } | null {
  if (state === "working" || state === "thinking") {
    const deskAnchor = deskPos[memberId];
    return deskAnchor ? computeWorkingPosition(memberId, deskAnchor) : null;
  }

  if (state === "idle" || state === "completed") {
    const sofaCenter = sofaPos[team];
    if (!sofaCenter) {
      // Unknown team — stay at desk
      return deskPos[memberId] ?? null;
    }
    const teamMemberIds = getIdleTeamMemberIds(team, memberId, teamMemberIdsByTeam);
    const scatterPositions = buildIdleScatterPositions(sofaCenter, teamMemberIds);
    return scatterPositions.get(memberId) ?? deskPos[memberId] ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Dynamic furniture generation
// ---------------------------------------------------------------------------

/** Build furniture list dynamically based on team members */
export function buildDynamicFurniture(members: typeof OFFICE_TEAM_MEMBERS = OFFICE_TEAM_MEMBERS): OfficeFurniture[] {
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
  for (const teamId of SOFA_TEAM_IDS) {
    const teamMembers = groups.get(teamId);
    if (!teamMembers || teamMembers.length === 0) continue;
    // Sofas are shared team furniture, so their anchors stay fixed even when
    // a project view filters the visible member subset.
    const pos = SOFA_POSITIONS[teamId] ?? computeSofaCenter(teamId, teamMembers.length);
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
  return team.map((agent, index) => {
    // Idle agents start at sofa scatter positions, not desks
    const autoPos = agent.state === "idle" || agent.state === "completed"
      ? getAutoPosition(agent.id, agent.state, agent.team)
      : null;
    return {
      ...agent,
      position: autoPos ?? TEAM_POSITIONS[agent.id] ?? getOverflowPosition(index),
      spriteSheet: "",
      image: agent.image,
    };
  });
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

function buildTeamZonesForMembers(members: typeof OFFICE_TEAM_MEMBERS): TeamZone[] {
  const groups = groupByTeam(members);
  const zones: TeamZone[] = [];

  for (const [teamId, teamMembers] of groups) {
    const config = getTeamZoneConfig(teamId);
    const rows = Math.ceil(teamMembers.length / config.cols);
    const pad = 60;

    zones.push({
      team: teamId,
      color: config.zoneColor,
      x: config.origin.x - pad,
      y: config.origin.y - pad,
      w: (config.cols - 1) * DESK_SPACING.x + 200 + pad * 2,
      h: (rows - 1) * DESK_SPACING.y + 144 + (config.hasSofa ? SOFA_GAP_Y + 144 : 0) + pad * 2,
    });
  }

  return zones;
}

function buildTeamZones(): TeamZone[] {
  return buildTeamZonesForMembers(OFFICE_TEAM_MEMBERS);
}

export const TEAM_ZONES: TeamZone[] = buildTeamZones();

// ---------------------------------------------------------------------------
// Project layout — per-project office generation
// ---------------------------------------------------------------------------

export interface ProjectLayout {
  furniture: OfficeFurniture[];
  deskPositions: Record<string, { x: number; y: number }>;
  sofaPositions: Record<string, { x: number; y: number }>;
  teamMemberIdsByTeam: Record<string, string[]>;
  teamZones: TeamZone[];
}

/** Build a complete office layout for a given set of member IDs.
 *  When memberIds is null/undefined, builds for ALL members (default view). */
export function buildProjectLayout(memberIds?: string[] | null): ProjectLayout {
  const members = memberIds
    ? OFFICE_TEAM_MEMBERS.filter((m) => memberIds.includes(m.id))
    : OFFICE_TEAM_MEMBERS;

  const groups = groupByTeam(members);
  const deskPositions: Record<string, { x: number; y: number }> = { ...DESK_POSITIONS };
  const sofaPositions: Record<string, { x: number; y: number }> = { ...SOFA_POSITIONS };
  const teamMemberIdsByTeam = Object.fromEntries(
    Object.entries(TEAM_MEMBER_IDS_BY_TEAM).map(([teamId, teamMembers]) => [teamId, [...teamMembers]]),
  ) as Record<string, string[]>;

  for (const [teamId, teamMembers] of groups) {
    teamMembers.forEach((member, index) => {
      deskPositions[member.id] = computeDeskPosition(teamId, index);
    });
    if (getTeamZoneConfig(teamId).hasSofa && teamMembers.length > 0) {
      // Use full-team sofa positions so idle characters always go to the correct
      // rest area regardless of which project view is active.
      sofaPositions[teamId] = SOFA_POSITIONS[teamId] ?? computeSofaCenter(teamId, teamMembers.length);
    }
  }

  return {
    furniture: buildDynamicFurniture(members),
    deskPositions,
    sofaPositions,
    teamMemberIdsByTeam,
    teamZones: buildTeamZonesForMembers(members),
  };
}

/** Default project layout (all members) */
export const DEFAULT_PROJECT_LAYOUT: ProjectLayout = {
  furniture: DEFAULT_OFFICE_FURNITURE,
  deskPositions: { ...DESK_POSITIONS },
  sofaPositions: { ...SOFA_POSITIONS },
  teamMemberIdsByTeam: Object.fromEntries(
    Object.entries(TEAM_MEMBER_IDS_BY_TEAM).map(([teamId, teamMembers]) => [teamId, [...teamMembers]]),
  ) as Record<string, string[]>,
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

export const HIERARCHY_LINES: { from: string; to: string; color: string }[] = OFFICE_TEAM_MEMBERS
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

/** Sofa team label lookup (for rendering labels on sofa furniture) */
export const SOFA_TEAM_LABELS: Record<string, string> = Object.fromEntries(
  teamData.teams
    .filter((team) => team.office.hasSofa)
    .map((team) => [
    team.id,
    `${team.name.ko}${team.id === "system" ? " 라운지" : " 휴게실"}`,
  ]),
);

/** Desk member info lookup (for rendering name plates on desk furniture) */
const TEAM_NAME_KO_MAP: Record<string, string> = Object.fromEntries(
  teamData.teams.map((team) => [team.id, team.name.ko]),
);

export const DESK_MEMBER_INFO: Record<string, { name: string; teamName: string; emoji: string }> = Object.fromEntries(
  OFFICE_TEAM_MEMBERS.map((member) => [
    member.id,
    { name: member.name.ko, teamName: TEAM_NAME_KO_MAP[member.team] ?? member.team, emoji: member.emoji },
  ]),
);
