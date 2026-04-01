import { useEffect, useState } from "react";

const IDLE_EMOTES = ["💤", "☕", "💭", "📖", "🎵", "✨", "🌟", "💫"];

export function useRandomEmote(characterId: string, isIdle: boolean): string | null {
  const [emote, setEmote] = useState<string | null>(null);

  useEffect(() => {
    if (!isIdle) {
      setEmote(null);
      return;
    }

    // Random delay before first emote (5-20s per character)
    const seed = characterId.charCodeAt(0) + characterId.length;
    const baseDelay = 5000 + (seed % 15) * 1000;

    const show = () => {
      const picked = IDLE_EMOTES[Math.floor(Math.random() * IDLE_EMOTES.length)];
      setEmote(picked);
      // Hide after 2-3s
      setTimeout(() => setEmote(null), 2000 + Math.random() * 1000);
    };

    const timer = setInterval(show, baseDelay + Math.random() * 10000);
    // Show first one after initial delay
    const initial = setTimeout(show, baseDelay);

    return () => {
      clearInterval(timer);
      clearTimeout(initial);
    };
  }, [characterId, isIdle]);

  return emote;
}
