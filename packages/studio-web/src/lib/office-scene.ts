import teamData from "../../../shared/team.json";
import { KUMA_TEAM } from "../types/agent";
import type { Agent } from "../types/agent";
import type { OfficeCharacter, OfficeFurniture, OfficeLayoutSnapshot, OfficeScene } from "../types/office";

const LEGACY_SCENE_MEMBER_IDS: Record<string, string> = {
  lumi: "rumi",
};

const TEAM_LAYOUT_SLOTS: Record<string, Array<{ x: number; y: number }>> = {
  management: [{ x: 500, y: 80 }],
  dev: [
    { x: 120, y: 160 },
    { x: 260, y: 160 },
    { x: 120, y: 300 },
    { x: 260, y: 300 },
    { x: 190, y: 430 },
  ],
  analytics: [
    { x: 660, y: 160 },
    { x: 800, y: 160 },
    { x: 730, y: 290 },
  ],
  strategy: [
    { x: 660, y: 380 },
    { x: 800, y: 380 },
    { x: 660, y: 510 },
    { x: 800, y: 510 },
  ],
};

const TEAM_HIERARCHY_COLORS: Record<string, { lead: string; member: string }> = {
  dev: {
    lead: "rgba(59, 130, 246, 0.15)",
    member: "rgba(59, 130, 246, 0.1)",
  },
  analytics: {
    lead: "rgba(249, 115, 22, 0.15)",
    member: "rgba(249, 115, 22, 0.1)",
  },
  strategy: {
    lead: "rgba(34, 197, 94, 0.15)",
    member: "rgba(34, 197, 94, 0.1)",
  },
};

function toSceneMemberId(id: string | null | undefined): string | null {
  if (id == null) return null;
  return LEGACY_SCENE_MEMBER_IDS[id] ?? id;
}

function getOverflowPosition(index: number): { x: number; y: number } {
  return {
    x: 80 + (index % 4) * 200,
    y: 120 + Math.floor(index / 4) * 160,
  };
}

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

const SCENE_TEAM_MEMBERS = teamData.members.map((member) => ({
  ...member,
  id: toSceneMemberId(member.id) ?? member.id,
  parentId: toSceneMemberId(member.parentId),
}));

const TEAM_ORDER_INDEX = new Map(teamData.teams.map((team, index) => [team.id, index]));
const MEMBER_ORDER_INDEX = new Map(SCENE_TEAM_MEMBERS.map((member, index) => [member.id, index]));
const TEAM_LABELS = Object.fromEntries(teamData.teams.map((team) => [team.id, team.name.ko])) as Record<string, string>;

/**
 * Team-grouped initial positions.
 * Characters are clustered by team so the office layout feels organized.
 */
export const TEAM_POSITIONS: Record<string, { x: number; y: number }> = Object.fromEntries(
  teamData.teams.flatMap((team) => {
    const members = teamData.members.filter((member) => member.team === team.id);
    const slots = TEAM_LAYOUT_SLOTS[team.id] ?? [];

    return members.flatMap((member, index) => {
      const position = slots[index] ?? getOverflowPosition(index);
      const sceneId = toSceneMemberId(member.id) ?? member.id;
      const entries: Array<[string, { x: number; y: number }]> = [[sceneId, position]];

      if (sceneId !== member.id) {
        entries.push([member.id, position]);
      }

      return entries;
    });
  }),
);

export function buildDefaultOfficeCharacters(team: Agent[] = KUMA_TEAM): OfficeCharacter[] {
  return team.map((agent, index) => ({
    ...agent,
    position: TEAM_POSITIONS[agent.id] ?? { x: 80 + (index % 4) * 200, y: 120 + Math.floor(index / 4) * 160 },
    spriteSheet: "",
    image: agent.image,
  }));
}

export const DEFAULT_OFFICE_CHARACTERS: OfficeCharacter[] = buildDefaultOfficeCharacters();

export const DEFAULT_OFFICE_FURNITURE: OfficeFurniture[] = [
  // Dev team desks (left zone)
  { id: "desk-dev-1", type: "desk", position: { x: 140, y: 200 }, imageUrl: "" },
  { id: "desk-dev-2", type: "desk", position: { x: 260, y: 200 }, imageUrl: "" },
  { id: "desk-dev-3", type: "desk", position: { x: 140, y: 320 }, imageUrl: "" },
  { id: "desk-dev-4", type: "desk", position: { x: 260, y: 320 }, imageUrl: "" },
  // Analytics team desks (right-top zone)
  { id: "desk-ana-1", type: "desk", position: { x: 680, y: 200 }, imageUrl: "" },
  { id: "desk-ana-2", type: "desk", position: { x: 790, y: 200 }, imageUrl: "" },
  // Strategy team desks (right-bottom zone)
  { id: "desk-str-1", type: "desk", position: { x: 680, y: 430 }, imageUrl: "" },
  { id: "desk-str-2", type: "desk", position: { x: 790, y: 430 }, imageUrl: "" },
  // Whiteboard (top center)
  { id: "whiteboard-1", type: "whiteboard", position: { x: 450, y: 80 }, imageUrl: "" },
  // Corner plants
  { id: "plant-1", type: "plant", position: { x: 40, y: 50 }, imageUrl: "" },
  { id: "plant-2", type: "plant", position: { x: 860, y: 50 }, imageUrl: "" },
  { id: "plant-3", type: "plant", position: { x: 40, y: 560 }, imageUrl: "" },
  { id: "plant-4", type: "plant", position: { x: 860, y: 560 }, imageUrl: "" },
  // Common area (center)
  { id: "sofa-1", type: "sofa", position: { x: 450, y: 340 }, imageUrl: "" },
  { id: "coffee-1", type: "coffee", position: { x: 450, y: 420 }, imageUrl: "" },
  // Utility area (bottom center)
  { id: "printer-1", type: "printer", position: { x: 360, y: 530 }, imageUrl: "" },
  { id: "watercooler-1", type: "watercooler", position: { x: 540, y: 530 }, imageUrl: "" },
  // Bookshelf (side wall)
  { id: "bookshelf-1", type: "bookshelf", position: { x: 40, y: 300 }, imageUrl: "" },
];

export const DEFAULT_OFFICE_SCENE: OfficeScene = {
  characters: DEFAULT_OFFICE_CHARACTERS,
  furniture: DEFAULT_OFFICE_FURNITURE,
  background: "woodland-office",
};

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

/** Team zone bounding rectangles for visual grouping in the office */
export const TEAM_ZONES: { team: string; label: string; color: string; x: number; y: number; w: number; h: number }[] = [
  { team: "management", label: TEAM_LABELS.management ?? "총괄", color: "rgba(217, 119, 6, 0.06)", x: 430, y: 30, w: 160, h: 100 },
  { team: "dev", label: TEAM_LABELS.dev ?? "개발팀", color: "rgba(59, 130, 246, 0.06)", x: 60, y: 110, w: 280, h: 380 },
  { team: "analytics", label: TEAM_LABELS.analytics ?? "분석팀", color: "rgba(249, 115, 22, 0.06)", x: 600, y: 110, w: 260, h: 230 },
  { team: "strategy", label: TEAM_LABELS.strategy ?? "전략팀", color: "rgba(34, 197, 94, 0.06)", x: 600, y: 330, w: 260, h: 240 },
];

/** Hierarchy connection lines: from parent → child positions */
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

export const ANIMAL_FALLBACKS: Record<string, string> = (() => {
  const used = new Set<string>();
  const animals = Array.from(new Set(SCENE_TEAM_MEMBERS.map((member) => member.animal.en)));

  return Object.fromEntries(
    animals.map((animal) => [animal, createAnimalFallback(animal, used)]),
  );
})();

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
