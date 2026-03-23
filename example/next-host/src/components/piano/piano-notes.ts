export type PianoKey = {
  midi: number;
  note: string;
  octave: number;
  label: string;
  isBlack: boolean;
  frequency: number;
  keyboard: string | null;
};

export type PianoManual = {
  id: "upper" | "lower";
  label: string;
  caption: string;
  keys: PianoKey[];
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const LOWER_KEYBOARD_MAP = [
  "a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j",
  "k", "o", "l", "p", ";", "'", "z", "x", "c", "v", "b", "n",
] as const;

function createKeys(startMidi: number, length: number) {
  return Array.from({ length }, (_, index) => {
    const midi = startMidi + index;
    const noteName = NOTE_NAMES[midi % 12] ?? "C";
    const octave = Math.floor(midi / 12) - 1;

    return {
      midi,
      note: noteName,
      octave,
      label: `${noteName}${octave}`,
      isBlack: noteName.includes("#"),
      frequency: 440 * Math.pow(2, (midi - 69) / 12),
      keyboard: null,
    } satisfies PianoKey;
  });
}

function applyKeyboardMap(keys: PianoKey[], startMidi: number, keyboardMap: readonly string[]) {
  return keys.map((key) => {
    const keyboardIndex = key.midi - startMidi;
    return {
      ...key,
      keyboard: keyboardMap[keyboardIndex] ?? null,
    };
  });
}

// Upper: C4–B6
export const UPPER_MANUAL_KEYS = createKeys(60, 36);
// Lower: C2–B4 with keyboard shortcuts centered on C3–B4
export const LOWER_MANUAL_KEYS = applyKeyboardMap(createKeys(36, 36), 48, LOWER_KEYBOARD_MAP);

export const PIANO_MANUALS: PianoManual[] = [
  { id: "upper", label: "Upper Manual", caption: "Lead range — C4 to B6", keys: UPPER_MANUAL_KEYS },
  { id: "lower", label: "Lower Manual", caption: "Bass + chords — C2 to B4", keys: LOWER_MANUAL_KEYS },
];

export function findKeyByKeyboard(keyboard: string) {
  return LOWER_MANUAL_KEYS.find((item) => item.keyboard === keyboard.toLowerCase()) ?? null;
}
