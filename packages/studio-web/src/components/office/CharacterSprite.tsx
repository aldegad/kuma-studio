import { useMemo } from "react";
import { flatTeamMembers } from "../../lib/team-schema";
import type { OfficeCharacter } from "../../types/office";

interface CharacterSpriteProps {
  character: OfficeCharacter;
}

/** Randomize blink delay so characters don't blink in sync */
function useBlinkDelay(id: string): string {
  return useMemo(() => {
    const hash = id.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return `${(hash % 30) / 10}s`;
  }, [id]);
}

type TeamMemberSpriteData = {
  animal?: {
    en?: string;
  };
  emoji?: string;
};

type AnimalSpriteData = {
  emoji: string;
  codePoint: string;
  fallback: string;
};

const PREFERRED_ANIMAL_ORDER = [
  "bear",
  "fox",
  "eagle",
  "wolf",
  "beaver",
  "hedgehog",
  "deer",
  "rabbit",
  "hamster",
  "raccoon",
  "squirrel",
  "owl",
  "bee",
];

const memberAnimalData = (flatTeamMembers as TeamMemberSpriteData[]).reduce<Record<string, Pick<AnimalSpriteData, "emoji" | "codePoint">>>((acc, member) => {
  const animal = member.animal?.en;
  const emoji = member.emoji;

  if (!animal || !emoji) {
    return acc;
  }

  acc[animal] = {
    emoji,
    codePoint: toEmojiCodePoint(emoji),
  };

  return acc;
}, {});

const resolvedAnimalData = buildResolvedAnimalData(memberAnimalData, PREFERRED_ANIMAL_ORDER);

/** Emoji-based fallback sprites until real assets are generated */
const animalEmoji: Record<string, string> = Object.fromEntries(
  Object.entries(resolvedAnimalData).map(([animal, data]) => [animal, data.emoji]),
);

const emojiCodePointMap: Record<string, string> = Object.entries(resolvedAnimalData).reduce<Record<string, string>>((acc, [animal, data]) => {
  acc[animal] = data.codePoint;
  acc[data.emoji] = data.codePoint;
  return acc;
}, {});

const animalFallbackMap: Record<string, string> = Object.fromEntries(
  Object.entries(resolvedAnimalData).map(([animal, data]) => [animal, data.fallback]),
);

const stateAnimation: Record<string, string> = {
  idle: "",
  working: "animate-bounce",
  thinking: "animate-pulse",
  completed: "animate-ping-once",
  error: "animate-shake",
};

export function CharacterSprite({ character }: CharacterSpriteProps) {
  const emoji = animalEmoji[character.animal] ?? "bear";
  const animation = stateAnimation[character.state] ?? "";
  const blinkDelay = useBlinkDelay(character.id);
  const isIdle = character.state === "idle";

  // Use sprite sheet if available
  if (character.spriteSheet) {
    const spriteSrc = character.spriteSheet.startsWith("/")
      ? `${import.meta.env.BASE_URL.replace(/\/$/, "")}${character.spriteSheet}`
      : character.spriteSheet;
    return (
      <div className={`h-20 w-20 ${animation} ${isIdle ? "animate-idle-blink" : ""}`} style={isIdle ? { animationDelay: blinkDelay } : undefined}>
        <img
          src={spriteSrc}
          alt={character.name}
          className="h-full w-full rounded-full object-cover shadow-md"
        />
      </div>
    );
  }

  // Use character image if available, falling back to emoji on error
  if (character.image) {
    const imageSrc = character.image.startsWith("/")
      ? `${import.meta.env.BASE_URL.replace(/\/$/, "")}${character.image}`
      : character.image;
    return (
      <div className={`h-20 w-20 ${animation}`}>
        <img
          src={imageSrc}
          alt={character.name}
          className="h-full w-full rounded-full object-cover shadow-md"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            img.style.display = "none";
            const parent = img.parentElement;
            if (parent) {
              parent.className = `flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-3xl shadow-md ${animation}`;
              parent.setAttribute("role", "img");
              parent.setAttribute("aria-label", `${character.name} (${character.animal}) - ${character.state}`);
              parent.textContent = getAnimalFallback(character.animal);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-3xl shadow-md ${animation} ${isIdle ? "animate-idle-blink" : ""}`}
      style={isIdle ? { animationDelay: blinkDelay } : undefined}
      role="img"
      aria-label={`${character.name} (${character.animal}) - ${character.state}`}
    >
      <img
        src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${getEmojiCodePoint(emoji)}.svg`}
        alt={character.animal}
        className="h-9 w-9"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
          (e.target as HTMLImageElement).parentElement!.textContent = getAnimalFallback(character.animal);
        }}
      />
    </div>
  );
}

function getEmojiCodePoint(name: string): string {
  return emojiCodePointMap[name] ?? "1f43b";
}

function getAnimalFallback(animal: string): string {
  return animalFallbackMap[animal] ?? animal[0]?.toUpperCase() ?? "?";
}

function buildResolvedAnimalData(
  animals: Record<string, Pick<AnimalSpriteData, "emoji" | "codePoint">>,
  preferredOrder: string[],
): Record<string, AnimalSpriteData> {
  const orderedAnimals = [
    ...preferredOrder,
    ...Object.keys(animals).filter((animal) => !preferredOrder.includes(animal)),
  ];
  const resolved: Record<string, AnimalSpriteData> = {};
  const animalsByInitial: Record<string, string[]> = {};

  for (const animal of orderedAnimals) {
    const source = animals[animal];

    if (!source) {
      continue;
    }

    const initial = animal[0]?.toLowerCase();

    if (!initial) {
      continue;
    }

    const previousAnimals = animalsByInitial[initial] ?? [];

    resolved[animal] = {
      emoji: source.emoji,
      codePoint: source.codePoint,
      fallback: buildAnimalFallback(animal, previousAnimals),
    };

    previousAnimals.push(animal);
    animalsByInitial[initial] = previousAnimals;
  }

  return resolved;
}

function buildAnimalFallback(animal: string, previousAnimals: string[]): string {
  const initial = animal[0]?.toUpperCase();

  if (!initial) {
    return "?";
  }

  if (previousAnimals.length === 0) {
    return initial;
  }

  const usedLetters = new Set(
    previousAnimals.flatMap((name) => Array.from(name.slice(1).toLowerCase().replace(/[^a-z]/g, ""))),
  );
  const nextLetter = Array.from(animal.slice(1).toLowerCase().replace(/[^a-z]/g, "")).find((letter) => !usedLetters.has(letter))
    ?? animal[1]?.toLowerCase();

  return nextLetter ? `${initial}${nextLetter}` : initial;
}

function toEmojiCodePoint(emoji: string): string {
  return Array.from(emoji.replace(/[\uFE0E\uFE0F]/g, ""))
    .map((char) => char.codePointAt(0)?.toString(16))
    .filter((codePoint): codePoint is string => Boolean(codePoint))
    .join("-");
}
