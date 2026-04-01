import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEAM_SKILL_DIRECTORIES = ["dev-team", "analytics-team", "strategy-team"];

const DISPLAY_NAME_TO_ID = Object.freeze({
  "하울": "howl",
  "뚝딱이": "tookdaki",
  "새미": "saemi",
  "밤돌이": "bamdori",
  "루미": "rumi",
  "다람이": "darami",
  "부리": "buri",
  "노을이": "noeuri",
  "콩콩이": "kongkongi",
  "뭉치": "moongchi",
  "쭈니": "jjooni",
});

function parseTeamEmoji(markdown) {
  const heading = markdown.split(/\r?\n/).find((line) => line.startsWith("# /")) ?? "";
  const match = heading.match(/—\s*(\S+)/u);
  return match?.[1] ?? "";
}

function parseMemberRows(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /\|\s*닉네임\s*\|\s*모델\s*\|\s*역할\s*\|/.test(line));

  if (headerIndex === -1) {
    return [];
  }

  const members = [];

  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line.startsWith("|")) {
      break;
    }

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) {
      continue;
    }

    const [nicknameCell, modelCell, roleCell] = cells;
    const nicknameParts = nicknameCell.replace(/\*\*/g, "").trim().split(/\s+/).filter(Boolean);

    if (nicknameParts.length < 2) {
      continue;
    }

    const [emoji, ...displayNameParts] = nicknameParts;
    const displayName = displayNameParts.join(" ").trim();
    const id = DISPLAY_NAME_TO_ID[displayName];

    if (!id) {
      continue;
    }

    members.push({
      id,
      emoji,
      displayName,
      model: modelCell.trim(),
      role: roleCell.trim(),
    });
  }

  return members;
}

export function loadTeamMetadata(root = ".") {
  const teams = TEAM_SKILL_DIRECTORIES.map((teamName) => {
    const filePath = resolve(root, ".claude", "skills", teamName, "skill.md");
    let markdown;
    try {
      markdown = readFileSync(filePath, "utf8");
    } catch {
      return { name: teamName, emoji: "", members: [] };
    }

    return {
      name: teamName,
      emoji: parseTeamEmoji(markdown),
      members: parseMemberRows(markdown),
    };
  });

  return { teams };
}
