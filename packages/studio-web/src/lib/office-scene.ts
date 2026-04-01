import { KUMA_TEAM } from "../types/agent";
import type { Agent } from "../types/agent";
import type { OfficeCharacter, OfficeFurniture, OfficeLayoutSnapshot, OfficeScene } from "../types/office";

/**
 * Team-grouped initial positions.
 * Characters are clustered by team so the office layout feels organized.
 */
export const TEAM_POSITIONS: Record<string, { x: number; y: number }> = {
  // -- 총괄 (center top) --
  kuma:      { x: 500, y: 80 },
  // -- 개발팀 (left area) --
  howl:      { x: 120, y: 160 },
  tookdaki:  { x: 260, y: 160 },
  saemi:     { x: 120, y: 300 },
  koon:      { x: 260, y: 300 },
  bamdori:   { x: 190, y: 430 },
  // -- 분석팀 (right top) --
  rumi:      { x: 660, y: 160 },
  darami:    { x: 800, y: 160 },
  buri:      { x: 730, y: 290 },
  // -- 전략팀 (right bottom) --
  noeuri:    { x: 660, y: 380 },
  kongkongi: { x: 800, y: 380 },
  moongchi:  { x: 660, y: 510 },
  jjooni:    { x: 800, y: 510 },
};

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
  { id: "desk-1", type: "desk", position: { x: 100, y: 200 }, imageUrl: "" },
  { id: "desk-2", type: "desk", position: { x: 300, y: 200 }, imageUrl: "" },
  { id: "desk-3", type: "desk", position: { x: 500, y: 200 }, imageUrl: "" },
  { id: "desk-4", type: "desk", position: { x: 700, y: 200 }, imageUrl: "" },
  { id: "whiteboard-1", type: "whiteboard", position: { x: 400, y: 90 }, imageUrl: "" },
  { id: "plant-1", type: "plant", position: { x: 50, y: 60 }, imageUrl: "" },
  { id: "plant-2", type: "plant", position: { x: 850, y: 60 }, imageUrl: "" },
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
  desk: { w: 64, h: 40 },
  chair: { w: 32, h: 32 },
  whiteboard: { w: 80, h: 60 },
  plant: { w: 28, h: 36 },
  coffee: { w: 20, h: 20 },
};

/** Team zone bounding rectangles for visual grouping in the office */
export const TEAM_ZONES: { team: string; label: string; color: string; x: number; y: number; w: number; h: number }[] = [
  { team: "management", label: "총괄", color: "rgba(217, 119, 6, 0.06)", x: 430, y: 30, w: 160, h: 100 },
  { team: "dev", label: "개발팀", color: "rgba(59, 130, 246, 0.06)", x: 60, y: 110, w: 280, h: 380 },
  { team: "analytics", label: "분석팀", color: "rgba(249, 115, 22, 0.06)", x: 600, y: 110, w: 260, h: 230 },
  { team: "strategy", label: "전략팀", color: "rgba(34, 197, 94, 0.06)", x: 600, y: 330, w: 260, h: 240 },
];

/** Hierarchy connection lines: from parent → child positions */
export const HIERARCHY_LINES: { from: string; to: string; color: string }[] = [
  // kuma → team leads
  { from: "kuma", to: "howl", color: "rgba(59, 130, 246, 0.15)" },
  { from: "kuma", to: "rumi", color: "rgba(249, 115, 22, 0.15)" },
  { from: "kuma", to: "noeuri", color: "rgba(34, 197, 94, 0.15)" },
  // howl → dev workers
  { from: "howl", to: "tookdaki", color: "rgba(59, 130, 246, 0.1)" },
  { from: "howl", to: "saemi", color: "rgba(59, 130, 246, 0.1)" },
  { from: "howl", to: "koon", color: "rgba(59, 130, 246, 0.1)" },
  { from: "howl", to: "bamdori", color: "rgba(59, 130, 246, 0.1)" },
  // rumi → analytics workers
  { from: "rumi", to: "darami", color: "rgba(249, 115, 22, 0.1)" },
  { from: "rumi", to: "buri", color: "rgba(249, 115, 22, 0.1)" },
  // noeuri → strategy workers
  { from: "noeuri", to: "kongkongi", color: "rgba(34, 197, 94, 0.1)" },
  { from: "noeuri", to: "moongchi", color: "rgba(34, 197, 94, 0.1)" },
  { from: "noeuri", to: "jjooni", color: "rgba(34, 197, 94, 0.1)" },
];

export const ANIMAL_FALLBACKS: Record<string, string> = {
  bear: "B",
  fox: "F",
  chipmunk: "C",
  eagle: "E",
  wolf: "W",
  beaver: "Bv",
  parrot: "P",
  hedgehog: "H",
  deer: "D",
  rabbit: "R",
  cat: "Ca",
  hamster: "Ha",
};

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
