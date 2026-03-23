"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Volume2 } from "lucide-react";

import { KUMA_PIANO_ICON_SRC } from "../../lib/kuma-assets";
import { PianoAudio } from "./piano-audio";
import { findKeyByKeyboard, type PianoKey, type PianoManual, PIANO_MANUALS } from "./piano-notes";

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function countWhiteKeysBefore(keys: PianoKey[], midi: number) {
  return keys.filter((key) => !key.isBlack && key.midi < midi).length;
}

function sortLabels(values: string[]) {
  return [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function KumaPianoStudio() {
  const audioRef = useRef<PianoAudio | null>(null);
  const pressedByKeyboardRef = useRef(new Set<string>());
  const [activeNotes, setActiveNotes] = useState<string[]>([]);
  const [status, setStatus] = useState("Hold notes together to build chords naturally.");

  if (!audioRef.current && typeof window !== "undefined") {
    audioRef.current = new PianoAudio();
  }

  function markActive(label: string, active: boolean) {
    setActiveNotes((current) => {
      if (active) {
        return current.includes(label) ? current : sortLabels([...current, label]);
      }

      return current.filter((value) => value !== label);
    });
  }

  async function playNote(key: PianoKey, source: "pointer" | "keyboard") {
    try {
      await audioRef.current?.playNote(key.label, key.frequency);
      markActive(key.label, true);
      setStatus(source === "keyboard" ? `Lower manual shortcut: ${key.label}` : `Layering: ${key.label}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function stopNote(label: string) {
    audioRef.current?.stopNote(label);
    markActive(label, false);
  }

  function stopAll() {
    pressedByKeyboardRef.current.clear();
    audioRef.current?.stopAll();
    setActiveNotes([]);
    setStatus("Stage cleared. Play a fresh chord whenever you want.");
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = findKeyByKeyboard(event.key);
      if (!key || event.repeat || pressedByKeyboardRef.current.has(key.label)) {
        return;
      }

      event.preventDefault();
      pressedByKeyboardRef.current.add(key.label);
      void playNote(key, "keyboard");
    }

    function handleKeyUp(event: KeyboardEvent) {
      const key = findKeyByKeyboard(event.key);
      if (!key) {
        return;
      }

      event.preventDefault();
      pressedByKeyboardRef.current.delete(key.label);
      stopNote(key.label);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      audioRef.current?.stopAll();
    };
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,235,200,0.85),transparent_28%),linear-gradient(180deg,#1f120d_0%,#2f1a10_24%,#6a4326_56%,#e8d2aa_100%)] px-4 py-5 text-[#fff4df] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            data-testid="back-to-apps"
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-black tracking-[-0.02em] text-[#fff2db] backdrop-blur"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Apps
          </Link>

          <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-bold text-[#ffe8bb] backdrop-blur">
            <span className="h-2.5 w-2.5 rounded-full bg-[#56db7f]" />
            Live Kuma Picker Surface
          </div>
        </header>

        <section className="overflow-hidden rounded-[2.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,247,233,0.08),rgba(255,233,203,0.03))] p-4 shadow-[0_36px_120px_rgba(0,0,0,0.32)] backdrop-blur-[8px] sm:p-5 lg:p-6">
          <div className="rounded-[2rem] border border-[#d1aa76]/16 bg-[linear-gradient(180deg,#3c2518,#140d09_18%,#2d1b12_40%,#8b6038_78%,#f2e0bf_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-[60ch]">
                <p className="text-[11px] font-black uppercase tracking-[0.34em] text-[#ebc785]">Twin-manual piano deck</p>
                <h1 className="mt-3 text-[2.7rem] font-black leading-[0.9] tracking-[-0.08em] text-[#fff5e5] sm:text-[4rem]">
                  A piano first.
                  <br />
                  UI second.
                </h1>
                <p className="mt-4 text-sm leading-7 text-[#f2ddbb] sm:text-[15px]">
                  Two long manuals stay front and center so it reads like an instrument, not a settings page.
                  Build chords by holding notes together. The lower manual still accepts keyboard shortcuts.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="hidden rounded-[1.7rem] border border-white/10 bg-white/7 p-2 shadow-[0_18px_36px_rgba(0,0,0,0.2)] sm:block">
                  <Image
                    src={KUMA_PIANO_ICON_SRC}
                    alt="Kuma Piano Deck icon"
                    width={112}
                    height={112}
                    className="rounded-[1.35rem]"
                    priority
                  />
                </div>

                <button
                  type="button"
                  data-testid="piano-stop-all"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[linear-gradient(180deg,#170e09,#090605)] px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-[#fff0d2] transition hover:-translate-y-0.5"
                  onClick={stopAll}
                >
                  <Volume2 className="h-4 w-4" />
                  Stop All
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="rounded-[1.5rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,247,233,0.08),rgba(255,243,222,0.03))] px-4 py-4">
                <p data-testid="piano-status" className="text-sm font-semibold leading-6 text-[#fff0d5]">
                  {status}
                </p>
              </div>

              <div
                data-testid="piano-active-notes"
                className="flex min-h-[4rem] flex-wrap items-center gap-2 rounded-[1.5rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,247,233,0.08),rgba(255,243,222,0.03))] px-4 py-3"
              >
                <span
                  data-testid="piano-active-count"
                  className="rounded-full bg-[#f2c776] px-3 py-1 text-xs font-black uppercase tracking-[0.24em] text-[#4a2a15]"
                >
                  {activeNotes.length} held
                </span>
                {activeNotes.length ? (
                  activeNotes.map((note) => (
                    <span
                      key={note}
                      className="rounded-full border border-white/8 bg-white/8 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-[#fff1d7]"
                    >
                      {note}
                    </span>
                  ))
                ) : (
                  <span className="text-sm font-medium text-[#d7c4a4]">No notes held yet.</span>
                )}
              </div>
            </div>

            <div className="mt-5 overflow-x-auto pb-2" data-testid="piano-manual-stack">
              <div className="min-w-[1260px] space-y-5">
                {PIANO_MANUALS.map((manual) => (
                  <PianoManualSection
                    key={manual.id}
                    activeNotes={activeNotes}
                    manual={manual}
                    onKeyDown={(key) => {
                      void playNote(key, "pointer");
                    }}
                    onKeyUp={(label) => stopNote(label)}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function PianoManualSection({
  manual,
  activeNotes,
  onKeyDown,
  onKeyUp,
}: {
  manual: PianoManual;
  activeNotes: string[];
  onKeyDown: (key: PianoKey) => void;
  onKeyUp: (label: string) => void;
}) {
  const whiteKeys = manual.keys.filter((key) => !key.isBlack);
  const blackKeys = manual.keys.filter((key) => key.isBlack);
  const whiteKeyWidth = 86;

  return (
    <section
      className="rounded-[1.9rem] border border-[#e6c792]/18 bg-[linear-gradient(180deg,#845430,#43281a_26%,#140d09_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_24px_40px_rgba(0,0,0,0.24)] sm:p-4"
      data-testid={`piano-manual-${manual.id}`}
    >
      <div className="flex items-center justify-between gap-4 px-2 pb-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#f5d392]">{manual.label}</p>
          <p className="mt-1 text-sm text-[#e5cfaa]">{manual.caption}</p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-[#fff1d6]">
          {whiteKeys[0]?.label} to {whiteKeys.at(-1)?.label}
        </div>
      </div>

      <div className="rounded-[1.65rem] border border-[#f0dbc0]/18 bg-[linear-gradient(180deg,#efe2cf,#dbc9ad)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84)]">
        <div className="relative mx-auto h-[286px]" style={{ width: `${whiteKeys.length * whiteKeyWidth}px` }}>
          <div className="absolute inset-x-0 bottom-0 flex">
            {whiteKeys.map((key) => (
              <button
                key={key.label}
                type="button"
                data-testid={`piano-key-${key.label}`}
                className={classNames(
                  "group relative flex h-[230px] w-[86px] flex-col justify-between overflow-hidden rounded-b-[1.5rem] rounded-t-[0.95rem] border border-[#ccb89a] bg-[linear-gradient(180deg,#fffefb_0%,#fff8ef_22%,#e7d4b6_100%)] px-3 pb-4 pt-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_16px_24px_rgba(60,36,18,0.12)] transition",
                  activeNotes.includes(key.label) && "translate-y-[4px] bg-[linear-gradient(180deg,#fff2d0_0%,#ffe3ab_28%,#d6af73_100%)]",
                )}
                onPointerDown={() => onKeyDown(key)}
                onPointerUp={() => onKeyUp(key.label)}
                onPointerLeave={() => onKeyUp(key.label)}
              >
                <span className="text-sm font-black tracking-[-0.03em] text-[#603916]">{key.label}</span>
                <span className="rounded-full bg-[rgba(84,49,21,0.08)] px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#8a643b]">
                  {key.keyboard ?? manual.id}
                </span>
              </button>
            ))}
          </div>

          {blackKeys.map((key) => (
            <button
              key={key.label}
              type="button"
              data-testid={`piano-key-${key.label}`}
              className={classNames(
                "absolute top-0 z-10 h-[154px] w-[52px] -translate-x-1/2 rounded-b-[1.08rem] rounded-t-[0.72rem] border border-[#0f0806] bg-[linear-gradient(180deg,#3f2b21_0%,#17100c_36%,#040303_100%)] px-2 pb-3 pt-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_26px_rgba(0,0,0,0.28)] transition",
                activeNotes.includes(key.label) && "translate-y-[4px] bg-[linear-gradient(180deg,#5c4032_0%,#231711_40%,#070606_100%)]",
              )}
              style={{ left: `${countWhiteKeysBefore(manual.keys, key.midi) * whiteKeyWidth - 8}px` }}
              onPointerDown={() => onKeyDown(key)}
              onPointerUp={() => onKeyUp(key.label)}
              onPointerLeave={() => onKeyUp(key.label)}
            >
              <span className="text-[11px] font-black text-[#fff1d8]">{key.label}</span>
              {key.keyboard ? (
                <span className="mt-auto block text-[10px] font-bold uppercase tracking-[0.12em] text-[#ccb69f]">
                  {key.keyboard}
                </span>
              ) : null}
            </button>
          ))}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 rounded-b-[1.2rem] bg-[linear-gradient(180deg,rgba(110,69,34,0),rgba(94,59,28,0.24))]" />
        </div>
      </div>
    </section>
  );
}
