import { describe, it, expect } from "vitest";
import { teamData } from "./team-schema";
import {
  TEAM_POSITIONS,
  TEAM_ZONES,
  HIERARCHY_LINES,
  FURNITURE_SIZES,
  DEFAULT_OFFICE_CHARACTERS,
  buildDefaultOfficeCharacters,
  buildProjectLayout,
  sceneToLayout,
  DEFAULT_OFFICE_SCENE,
  DEFAULT_PROJECT_LAYOUT,
  getAutoPosition,
  SOFA_POSITIONS,
} from "./office-scene";

describe("office-scene", () => {
  it("reflects darami in the dev team from team.json", () => {
    expect(teamData.members.find((member) => member.id === "darami")?.team).toBe("dev");
  });

  it("TEAM_POSITIONS has entry for every team.json member", () => {
    const expected = teamData.members.map((member) => member.id);
    for (const id of expected) {
      expect(TEAM_POSITIONS[id]).toBeDefined();
      expect(TEAM_POSITIONS[id].x).toBeTypeOf("number");
      expect(TEAM_POSITIONS[id].y).toBeTypeOf("number");
    }
  });

  it("TEAM_ZONES matches the configured teams", () => {
    expect(TEAM_ZONES).toHaveLength(teamData.teams.length);
    const teams = TEAM_ZONES.map((z) => z.team);
    for (const team of teamData.teams) {
      expect(teams).toContain(team.id);
    }
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

  it("buildDefaultOfficeCharacters returns every configured member", () => {
    const chars = buildDefaultOfficeCharacters();
    expect(chars).toHaveLength(teamData.members.length);
    expect(chars[0].position).toBeDefined();
  });

  it("DEFAULT_OFFICE_CHARACTERS equals buildDefaultOfficeCharacters()", () => {
    expect(DEFAULT_OFFICE_CHARACTERS).toHaveLength(teamData.members.length);
  });

  it("spreads idle teammates around the sofa without landing on the sofa center", () => {
    const devMembers = teamData.members.filter((member) => member.team === "dev");
    const idlePositions = devMembers.map((member) =>
      getAutoPosition(
        member.id,
        "idle",
        "dev",
        DEFAULT_PROJECT_LAYOUT.deskPositions,
        DEFAULT_PROJECT_LAYOUT.sofaPositions,
        DEFAULT_PROJECT_LAYOUT.teamMemberIdsByTeam,
      ),
    );
    const sofaCenter = DEFAULT_PROJECT_LAYOUT.sofaPositions.dev;

    for (const position of idlePositions) {
      expect(position).toBeTruthy();
      expect(Math.hypot(position!.x - sofaCenter.x, position!.y - sofaCenter.y)).toBeGreaterThan(70);
    }

    for (let index = 0; index < idlePositions.length; index += 1) {
      for (let next = index + 1; next < idlePositions.length; next += 1) {
        expect(Math.hypot(
          idlePositions[index]!.x - idlePositions[next]!.x,
          idlePositions[index]!.y - idlePositions[next]!.y,
        )).toBeGreaterThan(55);
      }
    }
  });

  it("computes stable idle positions for every sofa team", () => {
    const sofaTeams = teamData.teams.filter((team) => team.office.hasSofa).map((team) => team.id);

    for (const teamId of sofaTeams) {
      const teamMembers = teamData.members.filter((member) => member.team === teamId);
      const sofaCenter = DEFAULT_PROJECT_LAYOUT.sofaPositions[teamId];

      expect(sofaCenter).toBeTruthy();

      for (const member of teamMembers) {
        const position = getAutoPosition(
          member.id,
          "idle",
          teamId,
          DEFAULT_PROJECT_LAYOUT.deskPositions,
          DEFAULT_PROJECT_LAYOUT.sofaPositions,
          DEFAULT_PROJECT_LAYOUT.teamMemberIdsByTeam,
        );

        expect(position).toBeTruthy();
        expect(position).not.toEqual(DEFAULT_PROJECT_LAYOUT.deskPositions[member.id]);
        expect(Math.hypot(position!.x - sofaCenter.x, position!.y - sofaCenter.y)).toBeGreaterThan(60);
      }
    }
  });

  it("offsets working positions to the front-right of each desk", () => {
    const deskPosition = DEFAULT_PROJECT_LAYOUT.deskPositions.kuma;
    const workingPosition = getAutoPosition(
      "kuma",
      "working",
      "system",
      DEFAULT_PROJECT_LAYOUT.deskPositions,
      DEFAULT_PROJECT_LAYOUT.sofaPositions,
      DEFAULT_PROJECT_LAYOUT.teamMemberIdsByTeam,
    );

    expect(workingPosition).toBeTruthy();
    expect(workingPosition).not.toEqual(deskPosition);
    expect(workingPosition!.x).toBeGreaterThan(deskPosition.x);
    expect(workingPosition!.y).toBeGreaterThan(deskPosition.y);
  });

  it("keeps team sofas fixed when building a filtered project layout", () => {
    const layout = buildProjectLayout(["darami", "tookdaki"]);
    const devSofa = layout.furniture.find((furniture) => furniture.id === "sofa-dev");
    const daramiIdlePosition = getAutoPosition(
      "darami",
      "idle",
      "dev",
      layout.deskPositions,
      layout.sofaPositions,
      layout.teamMemberIdsByTeam,
    );

    expect(layout.sofaPositions.dev).toEqual(SOFA_POSITIONS.dev);
    expect(devSofa?.position).toEqual(SOFA_POSITIONS.dev);
    expect(daramiIdlePosition).toBeTruthy();
    expect(daramiIdlePosition).not.toEqual(layout.deskPositions.darami);
  });

  it("keeps idle scatter positions stable across filtered project views", () => {
    const layout = buildProjectLayout(["darami", "kongkongi", "kuma", "jjooni"]);
    const expectedDaramiIdlePosition = getAutoPosition(
      "darami",
      "idle",
      "dev",
      DEFAULT_PROJECT_LAYOUT.deskPositions,
      DEFAULT_PROJECT_LAYOUT.sofaPositions,
      DEFAULT_PROJECT_LAYOUT.teamMemberIdsByTeam,
    );
    const expectedKumaIdlePosition = getAutoPosition(
      "kuma",
      "idle",
      "system",
      DEFAULT_PROJECT_LAYOUT.deskPositions,
      DEFAULT_PROJECT_LAYOUT.sofaPositions,
      DEFAULT_PROJECT_LAYOUT.teamMemberIdsByTeam,
    );
    const expectedJjooniIdlePosition = getAutoPosition(
      "jjooni",
      "idle",
      "system",
      DEFAULT_PROJECT_LAYOUT.deskPositions,
      DEFAULT_PROJECT_LAYOUT.sofaPositions,
      DEFAULT_PROJECT_LAYOUT.teamMemberIdsByTeam,
    );

    expect(layout.teamMemberIdsByTeam.dev).toEqual(teamData.members.filter((member) => member.team === "dev").map((member) => member.id));
    expect(layout.teamMemberIdsByTeam.system).toEqual(teamData.members.filter((member) => member.team === "system").map((member) => member.id));

    expect(
      getAutoPosition("darami", "idle", "dev", layout.deskPositions, layout.sofaPositions, layout.teamMemberIdsByTeam),
    ).toEqual(expectedDaramiIdlePosition);
    expect(
      getAutoPosition("kuma", "idle", "system", layout.deskPositions, layout.sofaPositions, layout.teamMemberIdsByTeam),
    ).toEqual(expectedKumaIdlePosition);
    expect(
      getAutoPosition("jjooni", "idle", "system", layout.deskPositions, layout.sofaPositions, layout.teamMemberIdsByTeam),
    ).toEqual(expectedJjooniIdlePosition);
  });

  it("sceneToLayout preserves character and furniture ids", () => {
    const layout = sceneToLayout(DEFAULT_OFFICE_SCENE);
    expect(layout.characters.length).toBe(DEFAULT_OFFICE_SCENE.characters.length);
    expect(layout.furniture.length).toBe(DEFAULT_OFFICE_SCENE.furniture.length);
    expect(layout.background).toBe("woodland-office");
  });
});
