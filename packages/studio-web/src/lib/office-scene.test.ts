import { describe, it, expect } from "vitest";
import {
  TEAM_POSITIONS,
  TEAM_ZONES,
  HIERARCHY_LINES,
  FURNITURE_SIZES,
  DEFAULT_OFFICE_CHARACTERS,
  buildDefaultOfficeCharacters,
  sceneToLayout,
  DEFAULT_OFFICE_SCENE,
} from "./office-scene";

describe("office-scene", () => {
  it("TEAM_POSITIONS has entry for all 13 team members", () => {
    const expected = [
      "kuma", "howl", "tookdaki", "saemi", "koon", "bamdori",
      "lumi", "darami", "buri",
      "noeuri", "kongkongi", "moongchi", "jjooni",
    ];
    for (const id of expected) {
      expect(TEAM_POSITIONS[id]).toBeDefined();
      expect(TEAM_POSITIONS[id].x).toBeTypeOf("number");
      expect(TEAM_POSITIONS[id].y).toBeTypeOf("number");
    }
  });

  it("TEAM_ZONES has 4 zones", () => {
    expect(TEAM_ZONES).toHaveLength(4);
    const teams = TEAM_ZONES.map((z) => z.team);
    expect(teams).toContain("management");
    expect(teams).toContain("dev");
    expect(teams).toContain("analytics");
    expect(teams).toContain("strategy");
  });

  it("HIERARCHY_LINES all reference valid positions", () => {
    for (const line of HIERARCHY_LINES) {
      expect(TEAM_POSITIONS[line.from]).toBeDefined();
      expect(TEAM_POSITIONS[line.to]).toBeDefined();
    }
  });

  it("FURNITURE_SIZES has standard types", () => {
    expect(FURNITURE_SIZES.desk).toBeDefined();
    expect(FURNITURE_SIZES.whiteboard).toBeDefined();
    expect(FURNITURE_SIZES.plant).toBeDefined();
  });

  it("buildDefaultOfficeCharacters returns 13 characters", () => {
    const chars = buildDefaultOfficeCharacters();
    expect(chars).toHaveLength(13);
    expect(chars[0].position).toBeDefined();
  });

  it("DEFAULT_OFFICE_CHARACTERS equals buildDefaultOfficeCharacters()", () => {
    expect(DEFAULT_OFFICE_CHARACTERS).toHaveLength(13);
  });

  it("sceneToLayout preserves character and furniture ids", () => {
    const layout = sceneToLayout(DEFAULT_OFFICE_SCENE);
    expect(layout.characters.length).toBe(DEFAULT_OFFICE_SCENE.characters.length);
    expect(layout.furniture.length).toBe(DEFAULT_OFFICE_SCENE.furniture.length);
    expect(layout.background).toBe("woodland-office");
  });
});
