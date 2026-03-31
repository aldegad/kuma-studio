import type { OfficeCharacter } from "../../types/office";

interface CharacterSpriteProps {
  character: OfficeCharacter;
}

/** Emoji-based fallback sprites until real assets are generated */
const animalEmoji: Record<string, string> = {
  bear: "bear",
  fox: "fox_face",
  chipmunk: "chipmunk",
  eagle: "eagle",
  wolf: "wolf",
  beaver: "beaver",
  parrot: "parrot",
  hedgehog: "hedgehog",
  deer: "deer",
  rabbit: "rabbit",
  cat: "cat",
  hamster: "hamster",
};

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

  // Use sprite sheet if available, otherwise fall back to emoji
  if (character.spriteSheet) {
    return (
      <div className={`h-12 w-12 ${animation}`}>
        <img
          src={character.spriteSheet}
          alt={character.name}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={`flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl shadow-md ${animation}`}
      role="img"
      aria-label={`${character.name} (${character.animal}) - ${character.state}`}
    >
      <img
        src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${getEmojiCodePoint(emoji)}.svg`}
        alt={character.animal}
        className="h-7 w-7"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
          (e.target as HTMLImageElement).parentElement!.textContent = getAnimalFallback(character.animal);
        }}
      />
    </div>
  );
}

function getEmojiCodePoint(name: string): string {
  const emojiMap: Record<string, string> = {
    bear: "1f43b",
    fox_face: "1f98a",
    chipmunk: "1f43f",
    eagle: "1f985",
    wolf: "1f43a",
    beaver: "1f9ab",
    parrot: "1f99c",
    hedgehog: "1f994",
    deer: "1f98c",
    rabbit: "1f430",
    cat: "1f431",
    hamster: "1f439",
  };
  return emojiMap[name] ?? "1f43b";
}

function getAnimalFallback(animal: string): string {
  const fallback: Record<string, string> = {
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
  return fallback[animal] ?? animal[0]?.toUpperCase() ?? "?";
}
