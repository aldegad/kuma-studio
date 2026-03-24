"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PianoAudio } from "./piano-audio";
import { findKeyByKeyboard, type PianoKey, type PianoManual, PIANO_MANUALS } from "./piano-notes";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function countWhiteKeysBefore(keys: PianoKey[], midi: number) {
  return keys.filter((key) => !key.isBlack && key.midi < midi).length;
}

function getBlackKeyLeft(keys: PianoKey[], midi: number, ww: number, bw: number) {
  return countWhiteKeysBefore(keys, midi) * ww - bw / 2;
}

const WHITE_KEY_HEIGHT = 140;
const BLACK_KEY_HEIGHT = 88;

function SustainPedal({
  active,
  onDown,
  onUp,
}: {
  active: boolean;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col items-center gap-3 pt-2" data-testid="piano-pedal-strip">
      <p className="text-[9px] font-black uppercase tracking-[0.32em] text-[#d8c39d]">Damper Pedal</p>
      <div className="relative flex h-[92px] w-full items-end justify-center rounded-[1.8rem] border border-white/6 bg-[linear-gradient(180deg,#0f1015_0%,#1c1410_100%)] px-10 pb-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_26px_44px_rgba(0,0,0,0.28)]">
        <div className="absolute left-1/2 top-3 h-[22px] w-[160px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,#4a3929,#231812)] opacity-70" />
        <button
          type="button"
          data-testid="piano-sustain-pedal"
          aria-label="Sustain pedal"
          aria-pressed={active}
          className={cx(
            "relative h-[54px] w-[168px] origin-top rounded-[1.5rem] border border-[#a77b43] bg-[linear-gradient(180deg,#f6d38b_0%,#bb8542_42%,#6f431d_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_18px_24px_rgba(0,0,0,0.3)] transition",
            active ? "translate-y-[8px] scale-y-[0.92] shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_8px_14px_rgba(0,0,0,0.32)]" : "hover:translate-y-[2px]",
          )}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          onPointerCancel={onUp}
        >
          <div className="absolute inset-x-5 top-2 h-[10px] rounded-full bg-white/35 blur-[1px]" />
          <div className="absolute inset-x-7 bottom-3 h-[14px] rounded-full bg-[rgba(43,21,7,0.24)]" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Knob                                                               */
/* ------------------------------------------------------------------ */

function Knob({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(0);
  const angle = -135 + value * 270;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      startY.current = e.clientY;
      startVal.current = value;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [value],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      onChange(Math.max(0, Math.min(1, startVal.current + (startY.current - e.clientY) / 120)));
    },
    [onChange],
  );
  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="relative h-[44px] w-[44px] cursor-ns-resize rounded-full border border-[rgba(255,255,255,0.08)] bg-[radial-gradient(circle_at_38%_38%,#3a3f4d,#0c0d12_70%)] shadow-[0_4px_16px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(value * 100)}
        tabIndex={0}
      >
        <div
          className="absolute left-1/2 top-[5px] h-[12px] w-[2px] origin-[center_17px] rounded-full bg-[#f2c776]"
          style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
        />
        <div className="absolute left-1/2 top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2a2d38]" />
      </div>
      <span className="text-[9px] font-semibold tracking-[0.06em] text-[#8f867d]">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Piano keyboard section                                             */
/* ------------------------------------------------------------------ */

function PianoKeyboard({
  manual,
  activeKeyIds,
  onKeyDown,
  onKeyUp,
}: {
  manual: PianoManual;
  activeKeyIds: string[];
  onKeyDown: (key: PianoKey) => void;
  onKeyUp: (key: PianoKey) => void;
}) {
  const whiteKeys = manual.keys.filter((k) => !k.isBlack);
  const blackKeys = manual.keys.filter((k) => k.isBlack);
  const ww = 50;
  const bw = 28;

  return (
    <div data-piano-manual={manual.id}>
      <div className="flex items-center justify-between px-1 pb-2">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#dfd1ba]">{manual.label}</p>
          <p className="text-[10px] text-[#8f867d]">{manual.caption}</p>
        </div>
        <div className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-[#c7bcab]">
          {whiteKeys[0]?.label} – {whiteKeys.at(-1)?.label}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[1.2rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,#17181f_0%,#191b24_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div
          className="relative rounded-[1rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,#20222b_0%,#171920_100%)] px-2 pt-4"
          style={{ width: `${whiteKeys.length * ww + 16}px`, height: "180px" }}
        >
          {/* White keys */}
          <div className="absolute inset-x-0 bottom-0 flex">
            {whiteKeys.map((key) => (
              <button
                key={key.id}
                type="button"
                data-testid={`piano-key-${key.label}`}
                data-piano-key-id={key.id}
                data-piano-note-label={key.label}
                data-piano-manual={manual.id}
                data-piano-active={activeKeyIds.includes(key.id) ? "true" : "false"}
                aria-label={`${manual.label} ${key.label}`}
                className={cx(
                  "group relative flex flex-col justify-between overflow-hidden rounded-b-[0.9rem] rounded-t-[0.5rem] border border-[#c9ccd5] bg-[linear-gradient(180deg,#f3f4fb_0%,#e6e8f0_38%,#cfd3de_100%)] px-1.5 pb-2 pt-2 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_18px_rgba(0,0,0,0.14)] transition",
                  activeKeyIds.includes(key.id) && "translate-y-[3px] bg-[linear-gradient(180deg,#ffffff_0%,#eef1fa_36%,#d6dae6_100%)]",
                )}
                style={{ width: `${ww}px`, height: `${WHITE_KEY_HEIGHT}px` }}
                onPointerDown={() => onKeyDown(key)}
                onPointerUp={() => onKeyUp(key)}
                onPointerLeave={() => onKeyUp(key)}
              >
                <span className="text-[9px] font-black tracking-[0.02em] text-[#4d5260]">{key.label}</span>
                {key.keyboard ? (
                  <span className="self-start rounded-full border border-[rgba(55,61,76,0.08)] bg-[rgba(73,80,97,0.06)] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-[#707687]">
                    {key.keyboard}
                  </span>
                ) : (
                  <span className="h-4" />
                )}
              </button>
            ))}
          </div>

          {/* Black keys */}
          {blackKeys.map((key) => (
            <button
              key={key.id}
              type="button"
              data-testid={`piano-key-${key.label}`}
              data-piano-key-id={key.id}
              data-piano-note-label={key.label}
              data-piano-manual={manual.id}
              data-piano-active={activeKeyIds.includes(key.id) ? "true" : "false"}
              aria-label={`${manual.label} ${key.label}`}
              className={cx(
                "absolute top-[38px] z-10 rounded-b-[0.7rem] rounded-t-[0.5rem] border border-[#05060a] bg-[linear-gradient(180deg,#3a3f4d_0%,#161920_32%,#07080d_100%)] px-1.5 pb-2 pt-2 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_20px_rgba(0,0,0,0.34)] transition",
                activeKeyIds.includes(key.id) && "translate-y-[3px] bg-[linear-gradient(180deg,#4a5162_0%,#1c2029_34%,#090a10_100%)]",
              )}
              style={{
                width: `${bw}px`,
                height: `${BLACK_KEY_HEIGHT}px`,
                left: `${getBlackKeyLeft(manual.keys, key.midi, ww, bw)}px`,
              }}
              onPointerDown={() => onKeyDown(key)}
              onPointerUp={() => onKeyUp(key)}
              onPointerLeave={() => onKeyUp(key)}
            >
              <span className="text-[8px] font-black tracking-[0.04em] text-[#eef2ff]">{key.label}</span>
              {key.keyboard ? (
                <span className="mt-auto block text-[7px] font-bold uppercase tracking-[0.12em] text-[#aeb5c6]">
                  {key.keyboard}
                </span>
              ) : null}
            </button>
          ))}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 rounded-b-[0.8rem] bg-[linear-gradient(180deg,rgba(18,20,28,0),rgba(9,10,16,0.22))]" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function KumaPianoStudio() {
  const audioRef = useRef<PianoAudio | null>(null);
  const pressedRef = useRef(new Set<string>());
  const [activeKeyIds, setActiveKeyIds] = useState<string[]>([]);
  const [sustainActive, setSustainActive] = useState(false);

  const [modRate, setModRate] = useState(0);
  const [modDepth, setModDepth] = useState(0);
  const [tremRate, setTremRate] = useState(0);
  const [tremDepth, setTremDepth] = useState(0);

  if (!audioRef.current && typeof window !== "undefined") {
    audioRef.current = new PianoAudio();
  }

  useEffect(() => { audioRef.current?.setModulation(modRate * 10, modDepth); }, [modRate, modDepth]);
  useEffect(() => { audioRef.current?.setTremolo(tremRate * 10, tremDepth); }, [tremRate, tremDepth]);

  function markActive(keyId: string, on: boolean) {
    setActiveKeyIds((cur) =>
      on ? (cur.includes(keyId) ? cur : [...cur, keyId].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) : cur.filter((v) => v !== keyId),
    );
  }

  async function play(key: PianoKey) {
    await audioRef.current?.playNote(key.id, key.frequency);
    markActive(key.id, true);
  }

  function stop(key: PianoKey) {
    audioRef.current?.stopNote(key.id);
    markActive(key.id, false);
  }

  function setSustain(active: boolean) {
    setSustainActive(active);
    audioRef.current?.setSustain(active);
  }

  function stopAll() {
    pressedRef.current.clear();
    setSustain(false);
    audioRef.current?.stopAll();
    setActiveKeyIds([]);
  }

  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.key === "Escape") { stopAll(); return; }
      if (e.code === "Space") {
        e.preventDefault();
        if (!sustainActive) {
          setSustain(true);
        }
        return;
      }
      const key = findKeyByKeyboard(e.key);
      if (!key || e.repeat || pressedRef.current.has(key.id)) return;
      e.preventDefault();
      pressedRef.current.add(key.id);
      void play(key);
    }
    function up(e: KeyboardEvent) {
      const key = findKeyByKeyboard(e.key);
      if (e.code === "Space") {
        e.preventDefault();
        if (sustainActive) {
          setSustain(false);
        }
        return;
      }
      if (!key) return;
      e.preventDefault();
      pressedRef.current.delete(key.id);
      stop(key);
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      audioRef.current?.stopAll();
    };
  }, [sustainActive]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(255,235,200,0.85),transparent_28%),linear-gradient(180deg,#1f120d_0%,#2f1a10_24%,#6a4326_56%,#e8d2aa_100%)] px-4 py-5 text-[#fff4df]">
      <div className="flex w-full max-w-[1120px] flex-col gap-4">
        {/* Header */}
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

        {/* Instrument card */}
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,247,233,0.08),rgba(255,233,203,0.03))] shadow-[0_36px_120px_rgba(0,0,0,0.32)] backdrop-blur-[8px]">
          <div className="rounded-[2rem] border border-[#d1aa76]/16 bg-[linear-gradient(180deg,#3c2518,#140d09_18%,#2d1b12_40%,#8b6038_78%,#f2e0bf_100%)] p-3 sm:p-4">
            <div
              className="rounded-[1.5rem] border border-[rgba(243,226,190,0.08)] bg-[linear-gradient(180deg,#31231d_0%,#1c1615_48%,#0e0c0e_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_40px_rgba(0,0,0,0.28)]"
              data-testid="piano-instrument"
            >
              {/* Knobs */}
              <div className="mb-4 flex items-start justify-center gap-6 sm:gap-8">
                <div className="flex flex-col items-center gap-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#dfd1ba]">Modulation</p>
                  <div className="flex gap-4">
                    <Knob label="Rate" value={modRate} onChange={setModRate} />
                    <Knob label="Depth" value={modDepth} onChange={setModDepth} />
                  </div>
                </div>
                <div className="mt-5 h-[50px] w-px bg-white/8" />
                <div className="flex flex-col items-center gap-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#dfd1ba]">Tremolo</p>
                  <div className="flex gap-4">
                    <Knob label="Rate" value={tremRate} onChange={setTremRate} />
                    <Knob label="Depth" value={tremDepth} onChange={setTremDepth} />
                  </div>
                </div>
              </div>

              {/* Two manuals */}
              <div className="space-y-3" data-testid="piano-manual-stack">
                {PIANO_MANUALS.map((manual) => (
                  <PianoKeyboard
                    key={manual.id}
                    manual={manual}
                    activeKeyIds={activeKeyIds}
                    onKeyDown={(key) => void play(key)}
                    onKeyUp={(key) => stop(key)}
                  />
                ))}
              </div>

              <SustainPedal active={sustainActive} onDown={() => setSustain(true)} onUp={() => setSustain(false)} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
