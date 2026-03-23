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
  "a",
  "w",
  "s",
  "e",
  "d",
  "f",
  "t",
  "g",
  "y",
  "h",
  "u",
  "j",
  "k",
  "o",
  "l",
  "p",
  ";",
  "'",
  "z",
  "x",
  "c",
  "v",
  "b",
  "n",
] as const;

function createKeys(startMidi: number, length: number, keyboardMap?: readonly string[]) {
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
      keyboard: keyboardMap?.[index] ?? null,
    } satisfies PianoKey;
  });
}

export const LOWER_MANUAL_KEYS = createKeys(48, 24, LOWER_KEYBOARD_MAP);
export const UPPER_MANUAL_KEYS = createKeys(72, 24);
export const PIANO_MANUALS: PianoManual[] = [
  { id: "upper", label: "Upper Manual", caption: "Floating melody layer", keys: UPPER_MANUAL_KEYS },
  { id: "lower", label: "Lower Manual", caption: "Chord bed with keyboard shortcuts", keys: LOWER_MANUAL_KEYS },
];
export const ALL_PIANO_KEYS = [...UPPER_MANUAL_KEYS, ...LOWER_MANUAL_KEYS];

export function findKeyByKeyboard(keyboard: string) {
  return LOWER_MANUAL_KEYS.find((item) => item.keyboard === keyboard.toLowerCase()) ?? null;
}
