"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type GameState,
  type InputState,
  CANVAS_W,
  CANVAS_H,
  createInitialState,
  createInputState,
  tick,
  getMetrics,
} from "./shooting-engine";

function createMetricTestId(label: string) {
  return `shooting-metric-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

// ─── Canvas renderer (pure 2D — no images needed) ───

function syncResolution(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const dw = Math.max(1, Math.round(canvas.clientWidth));
  const dh = Math.max(1, Math.round((dw * CANVAS_H) / CANVAS_W));
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.max(1, Math.round(dw * dpr));
  const ph = Math.max(1, Math.round(dh * dpr));

  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }

  ctx.setTransform(pw / CANVAS_W, 0, 0, ph / CANVAS_H, 0, 0);
}

function drawGame(ctx: CanvasRenderingContext2D, state: GameState) {
  // ─── Background: scrolling star-field ───
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, "#0a0e27");
  grad.addColorStop(0.5, "#111b3a");
  grad.addColorStop(1, "#0a0e27");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Stars (deterministic from frame)
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  for (let i = 0; i < 60; i++) {
    const seed = i * 7919;
    const sx = (seed * 13) % CANVAS_W;
    const sy = ((seed * 17 + state.frame * (0.3 + (i % 3) * 0.2)) % (CANVAS_H + 20)) - 10;
    const size = 0.5 + (i % 3) * 0.5;
    ctx.fillRect(sx, sy, size, size);
  }

  // ─── Power-ups ───
  for (const pu of state.powerUps) {
    ctx.save();
    ctx.translate(pu.x, pu.y);
    ctx.beginPath();
    ctx.arc(0, 0, pu.radius, 0, Math.PI * 2);
    ctx.fillStyle =
      pu.kind === "spread" ? "rgba(255,213,79,0.9)"
      : pu.kind === "speed" ? "rgba(129,212,250,0.9)"
      : "rgba(129,199,132,0.9)";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pu.kind === "spread" ? "S" : pu.kind === "speed" ? "F" : "D", 0, 1);
    ctx.restore();
  }

  // ─── Enemies ───
  for (const e of state.enemies) {
    ctx.save();
    ctx.translate(e.x, e.y);

    if (e.kind === "boss") {
      // Boss: large hexagon shape
      ctx.fillStyle = "#7b1fa2";
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const r = 36;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ce93d8";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Boss eye
      ctx.fillStyle = "#ff1744";
      ctx.beginPath();
      ctx.arc(0, -4, 8, 0, Math.PI * 2);
      ctx.fill();

      // HP bar
      const hpRatio = e.hp / e.maxHp;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(-30, -48, 60, 6);
      ctx.fillStyle = hpRatio > 0.5 ? "#66bb6a" : hpRatio > 0.25 ? "#ffa726" : "#ef5350";
      ctx.fillRect(-30, -48, 60 * hpRatio, 6);
    } else if (e.kind === "spreader") {
      // Spreader: diamond
      ctx.fillStyle = "#e040fb";
      ctx.beginPath();
      ctx.moveTo(0, -e.height / 2);
      ctx.lineTo(e.width / 2, 0);
      ctx.lineTo(0, e.height / 2);
      ctx.lineTo(-e.width / 2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f8bbd0";
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.kind === "bomber") {
      // Bomber: triangle
      ctx.fillStyle = "#ff7043";
      ctx.beginPath();
      ctx.moveTo(0, -e.height / 2);
      ctx.lineTo(e.width / 2, e.height / 2);
      ctx.lineTo(-e.width / 2, e.height / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffccbc";
      ctx.beginPath();
      ctx.arc(0, 4, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Grunt: rectangle with fins
      ctx.fillStyle = "#ef5350";
      ctx.fillRect(-e.width / 2, -e.height / 2, e.width, e.height);
      ctx.fillStyle = "#c62828";
      ctx.fillRect(-e.width / 2 - 4, -4, 4, 12);
      ctx.fillRect(e.width / 2, -4, 4, 12);
    }

    ctx.restore();
  }

  // ─── Bullets ───
  for (const b of state.bullets) {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();

    if (!b.fromPlayer) {
      // Enemy bullets glow
      ctx.fillStyle = `${b.color}44`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ─── Particles ───
  for (const pt of state.particles) {
    const alpha = pt.life / pt.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.radius * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ─── Player ───
  const p = state.player;
  if (p.invincibleFrames > 0 && state.frame % 4 < 2) {
    // blink during invincibility
  } else {
    ctx.save();
    ctx.translate(p.x, p.y);

    // Shield glow
    if (p.shieldActive) {
      ctx.strokeStyle = "rgba(129,199,132,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 28, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Ship body (arrow shape)
    ctx.fillStyle = "#42a5f5";
    ctx.beginPath();
    ctx.moveTo(0, -p.height / 2);
    ctx.lineTo(p.width / 2, p.height / 2);
    ctx.lineTo(p.width / 4, p.height / 3);
    ctx.lineTo(-p.width / 4, p.height / 3);
    ctx.lineTo(-p.width / 2, p.height / 2);
    ctx.closePath();
    ctx.fill();

    // Cockpit
    ctx.fillStyle = "#bbdefb";
    ctx.beginPath();
    ctx.arc(0, -2, 6, 0, Math.PI * 2);
    ctx.fill();

    // Engine glow
    ctx.fillStyle = `rgba(255,${100 + Math.sin(state.frame * 0.3) * 50},50,0.8)`;
    ctx.beginPath();
    ctx.arc(-6, p.height / 3, 3 + Math.sin(state.frame * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(6, p.height / 3, 3 + Math.cos(state.frame * 0.5), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ─── HUD ───
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, 0, CANVAS_W, 36);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`SCORE ${state.score}`, 12, 18);

  ctx.textAlign = "center";
  ctx.fillText(`WAVE ${state.wave}`, CANVAS_W / 2, 18);

  ctx.textAlign = "right";
  // Lives as hearts
  let livesStr = "";
  for (let i = 0; i < state.player.lives; i++) livesStr += "\u2665 ";
  ctx.fillStyle = "#ef5350";
  ctx.fillText(livesStr, CANVAS_W - 12, 18);

  // ─── Game Over overlay ───
  if (state.gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 36px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("GAME OVER", CANVAS_W / 2, CANVAS_H / 2 - 30);

    ctx.font = "bold 16px monospace";
    ctx.fillText(`Score: ${state.score}`, CANVAS_W / 2, CANVAS_H / 2 + 10);
    ctx.fillText(`Wave: ${state.wave}`, CANVAS_W / 2, CANVAS_H / 2 + 34);

    ctx.fillStyle = "#ffd54f";
    ctx.font = "bold 14px monospace";
    ctx.fillText("Tap to restart", CANVAS_W / 2, CANVAS_H / 2 + 70);
  } else if (!state.started) {
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = "#fffaf0";
    ctx.font = "bold 30px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TAP TO START", CANVAS_W / 2, CANVAS_H / 2 - 46);

    ctx.fillStyle = "#ffd54f";
    ctx.font = "bold 14px monospace";
    ctx.fillText("First tap arms the stage", CANVAS_W / 2, CANVAS_H / 2 - 6);
    ctx.fillText("then drag or press arrows / Z", CANVAS_W / 2, CANVAS_H / 2 + 18);

    ctx.fillStyle = "#bbdefb";
    ctx.font = "bold 13px monospace";
    ctx.fillText("Slower bullets, lighter waves", CANVAS_W / 2, CANVAS_H / 2 + 60);
  }
}

// ─── React Component ───

export function ShootingGameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(createInitialState());
  const inputRef = useRef<InputState>(createInputState());
  const [metrics, setMetrics] = useState(() => getMetrics(stateRef.current));

  const restart = useCallback((started = false) => {
    stateRef.current = createInitialState(started);
    inputRef.current = createInputState();
    setMetrics(getMetrics(stateRef.current));
  }, []);

  const startGame = useCallback(() => {
    const state = stateRef.current;
    if (!state.started) {
      state.started = true;
      state.lastFrameTime = performance.now();
    }
  }, []);

  const startFreshRun = useCallback(() => {
    restart(true);
    stateRef.current.lastFrameTime = performance.now();
  }, [restart]);

  const resetToReady = useCallback(() => {
    restart(false);
  }, [restart]);

  // ─── Pointer events (touch + mouse) ───
  const getCanvasPos = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const pos = getCanvasPos(e.clientX, e.clientY);
    if (!pos) return;

    if (stateRef.current.gameOver) {
      restart(true);
    } else {
      startGame();
    }

    inputRef.current.pointer = pos;
    inputRef.current.pointerDown = true;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events may not have a captureable native pointer.
    }
  }, [getCanvasPos, restart, startGame]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!inputRef.current.pointerDown) return;
    const pos = getCanvasPos(e.clientX, e.clientY);
    if (pos) inputRef.current.pointer = pos;
  }, [getCanvasPos]);

  const handlePointerUp = useCallback(() => {
    inputRef.current.pointerDown = false;
    inputRef.current.pointer = null;
  }, []);

  // ─── Keyboard ───
  useEffect(() => {
    const keyMap: Record<string, keyof InputState["keys"]> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      w: "up", s: "down", a: "left", d: "right",
      " ": "fire", z: "fire",
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const k = keyMap[e.key];
      if (k) {
        e.preventDefault();
        if (stateRef.current.gameOver) {
          restart(true);
        } else {
          startGame();
        }
        inputRef.current.keys[k] = true;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = keyMap[e.key];
      if (k) inputRef.current.keys[k] = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [restart, startGame]);

  // ─── Game loop ───
  useEffect(() => {
    let raf = 0;
    let metricCounter = 0;

    const loop = () => {
      const state = stateRef.current;
      tick(state, inputRef.current);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        syncResolution(canvas, ctx);
        drawGame(ctx, state);
      }

      // Update React metrics every 15 frames
      metricCounter++;
      if (metricCounter >= 15) {
        metricCounter = 0;
        setMetrics(getMetrics(state));
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      {/* Game canvas */}
      <div className="shrink-0 overflow-hidden rounded-[1.6rem] border border-[#a47039]/15 bg-[#0a0e27] shadow-[0_24px_72px_rgba(10,14,39,0.5)]">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="block h-auto w-full max-w-[420px] cursor-crosshair rounded-[1.6rem]"
          style={{ touchAction: "none" }}
          aria-label="Kuma Shooting Game canvas"
          data-testid="shooting-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>

      {/* Metrics panel */}
      <div className="flex min-w-[240px] flex-col gap-3" data-testid="shooting-metrics">
        <h3 className="text-lg font-black tracking-tight text-[#41230a]">
          Real-Time Metrics
        </h3>

        <div
          className="rounded-[1.25rem] border border-[#8d6137]/14 bg-[#fff7e8] p-3"
          data-testid="shooting-benchmark-controls"
        >
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8b643d]">
            Benchmark Controls
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="kuma-tool justify-center"
              data-testid="shooting-start-button"
              onClick={startFreshRun}
            >
              Start Run
            </button>
            <button
              type="button"
              className="kuma-tool justify-center"
              data-testid="shooting-reset-button"
              onClick={resetToReady}
            >
              Reset Stage
            </button>
          </div>
        </div>

        <MetricCard label="FPS" value={metrics.fps} unit="fps" tone="gold" />
        <MetricCard label="Score" value={metrics.score} tone="cream" />
        <MetricCard label="Wave" value={metrics.wave} tone="mint" />
        <MetricCard label="Lives" value={metrics.lives} tone="rose" />
        <MetricCard label="Active Enemies" value={metrics.enemies} tone="cream" />
        <MetricCard label="Active Bullets" value={metrics.bullets} tone="gold" />
        <MetricCard label="Particles" value={metrics.particles} tone="cream" />
        <MetricCard label="Shots Fired" value={metrics.shotsFired} tone="mint" />
        <MetricCard label="Enemies Destroyed" value={metrics.enemiesDestroyed} tone="gold" />
        <MetricCard label="Total Inputs" value={metrics.totalInputEvents} tone="rose" />
        <MetricCard label="Spread Level" value={metrics.spreadLevel} tone="mint" />
        <MetricCard label="Shield" value={metrics.shieldActive ? "ON" : "OFF"} tone={metrics.shieldActive ? "mint" : "cream"} />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: number | string;
  unit?: string;
  tone: "gold" | "cream" | "mint" | "rose";
}) {
  return (
    <div
      className={`kuma-metric kuma-metric-${tone} flex items-center justify-between gap-4`}
      data-testid={createMetricTestId(label)}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-lg font-black tabular-nums">
        {value}
        {unit ? <span className="ml-1 text-xs font-medium opacity-60">{unit}</span> : null}
      </span>
    </div>
  );
}
