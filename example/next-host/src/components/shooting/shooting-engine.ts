// ─── 1945-style bullet-hell shooting engine ───
// Pure game logic — no DOM / React dependency

export type Vec2 = { x: number; y: number };

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  fromPlayer: boolean;
}

export interface Enemy {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  width: number;
  height: number;
  kind: EnemyKind;
  fireCooldown: number;
  age: number;
  /** pattern-specific phase counter */
  phase: number;
}

export type EnemyKind = "grunt" | "spreader" | "bomber" | "boss";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  radius: number;
}

export interface PowerUp {
  x: number;
  y: number;
  vy: number;
  kind: "spread" | "speed" | "shield";
  radius: number;
}

export interface Player {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  fireCooldown: number;
  fireRate: number;
  lives: number;
  invincibleFrames: number;
  spreadLevel: number;
  shieldActive: boolean;
  shieldTimer: number;
}

export interface GameState {
  player: Player;
  bullets: Bullet[];
  enemies: Enemy[];
  particles: Particle[];
  powerUps: PowerUp[];
  score: number;
  frame: number;
  wave: number;
  waveTimer: number;
  gameOver: boolean;
  paused: boolean;
  /** frames since game start (for metrics) */
  totalFrames: number;
  /** number of player shots fired */
  shotsFired: number;
  /** number of enemies destroyed */
  enemiesDestroyed: number;
  /** input events processed this frame */
  inputEventsThisFrame: number;
  /** cumulative input events */
  totalInputEvents: number;
  /** timestamp of last frame for delta */
  lastFrameTime: number;
  /** rolling fps samples (last 60) */
  fpsSamples: number[];
}

// ─── Constants ───

export const CANVAS_W = 420;
export const CANVAS_H = 700;

const PLAYER_W = 36;
const PLAYER_H = 40;
const PLAYER_SPEED = 6;
const PLAYER_FIRE_RATE = 6; // frames between shots
const INVINCIBLE_DURATION = 90; // frames after hit

const ENEMY_SPAWN_INTERVAL_BASE = 80; // frames
const WAVE_DURATION = 600; // frames per wave

// ─── Factory ───

export function createInitialState(): GameState {
  return {
    player: {
      x: CANVAS_W / 2,
      y: CANVAS_H - 80,
      width: PLAYER_W,
      height: PLAYER_H,
      speed: PLAYER_SPEED,
      fireCooldown: 0,
      fireRate: PLAYER_FIRE_RATE,
      lives: 3,
      invincibleFrames: 0,
      spreadLevel: 1,
      shieldActive: false,
      shieldTimer: 0,
    },
    bullets: [],
    enemies: [],
    particles: [],
    powerUps: [],
    score: 0,
    frame: 0,
    wave: 1,
    waveTimer: 0,
    gameOver: false,
    paused: false,
    totalFrames: 0,
    shotsFired: 0,
    enemiesDestroyed: 0,
    inputEventsThisFrame: 0,
    totalInputEvents: 0,
    lastFrameTime: performance.now(),
    fpsSamples: [],
  };
}

// ─── Input ───

export interface InputState {
  /** touch / pointer target position (null = no input) */
  pointer: Vec2 | null;
  /** is pointer currently down */
  pointerDown: boolean;
  /** keyboard directional */
  keys: { up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean };
}

export function createInputState(): InputState {
  return {
    pointer: null,
    pointerDown: false,
    keys: { up: false, down: false, left: false, right: false, fire: false },
  };
}

// ─── Tick ───

export function tick(state: GameState, input: InputState): GameState {
  if (state.gameOver || state.paused) return state;

  const now = performance.now();
  const delta = now - state.lastFrameTime;
  const fps = delta > 0 ? 1000 / delta : 60;
  const fpsSamples = [...state.fpsSamples.slice(-59), fps];

  state.lastFrameTime = now;
  state.fpsSamples = fpsSamples;
  state.frame++;
  state.totalFrames++;
  state.waveTimer++;
  state.inputEventsThisFrame = 0;

  // Wave progression
  if (state.waveTimer >= WAVE_DURATION) {
    state.wave++;
    state.waveTimer = 0;
  }

  // ─── Move player ───
  const p = state.player;

  if (input.pointer && input.pointerDown) {
    // Touch/mouse: move toward pointer with offset so finger doesn't cover ship
    const targetX = input.pointer.x;
    const targetY = input.pointer.y - 60; // offset above finger
    const dx = targetX - p.x;
    const dy = targetY - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 2) {
      const moveSpeed = Math.min(p.speed * 1.4, dist);
      p.x += (dx / dist) * moveSpeed;
      p.y += (dy / dist) * moveSpeed;
    }
    state.inputEventsThisFrame++;
  }

  // Keyboard movement
  if (input.keys.left) p.x -= p.speed;
  if (input.keys.right) p.x += p.speed;
  if (input.keys.up) p.y -= p.speed;
  if (input.keys.down) p.y += p.speed;

  // Clamp
  p.x = Math.max(p.width / 2, Math.min(CANVAS_W - p.width / 2, p.x));
  p.y = Math.max(p.height / 2, Math.min(CANVAS_H - p.height / 2, p.y));

  // Invincibility countdown
  if (p.invincibleFrames > 0) p.invincibleFrames--;
  if (p.shieldTimer > 0) {
    p.shieldTimer--;
    if (p.shieldTimer <= 0) p.shieldActive = false;
  }

  // ─── Player fire ───
  if (p.fireCooldown > 0) p.fireCooldown--;
  const shouldFire = input.pointerDown || input.keys.fire;
  if (shouldFire && p.fireCooldown <= 0) {
    firePlayerBullets(state);
    p.fireCooldown = p.fireRate;
    state.shotsFired++;
  }

  // ─── Spawn enemies ───
  const spawnInterval = Math.max(20, ENEMY_SPAWN_INTERVAL_BASE - state.wave * 5);
  if (state.frame % spawnInterval === 0) {
    spawnEnemy(state);
  }

  // Boss every 5 waves
  if (state.wave % 5 === 0 && state.waveTimer === 1) {
    spawnBoss(state);
  }

  // ─── Update bullets ───
  for (const b of state.bullets) {
    b.x += b.vx;
    b.y += b.vy;
  }
  state.bullets = state.bullets.filter(
    (b) => b.x > -20 && b.x < CANVAS_W + 20 && b.y > -20 && b.y < CANVAS_H + 20,
  );

  // ─── Update enemies ───
  for (const e of state.enemies) {
    e.age++;
    updateEnemy(e, state);
  }
  state.enemies = state.enemies.filter((e) => e.y < CANVAS_H + 60 && e.hp > 0);

  // ─── Update particles ───
  for (const pt of state.particles) {
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.vx *= 0.96;
    pt.vy *= 0.96;
    pt.life--;
  }
  state.particles = state.particles.filter((pt) => pt.life > 0);

  // ─── Update power-ups ───
  for (const pu of state.powerUps) {
    pu.y += pu.vy;
  }
  state.powerUps = state.powerUps.filter((pu) => pu.y < CANVAS_H + 20);

  // ─── Collision: player bullets → enemies ───
  const playerBullets = state.bullets.filter((b) => b.fromPlayer);
  for (const b of playerBullets) {
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      if (rectCircleCollision(e.x - e.width / 2, e.y - e.height / 2, e.width, e.height, b.x, b.y, b.radius)) {
        e.hp--;
        b.y = -999; // mark for removal
        if (e.hp <= 0) {
          state.score += e.kind === "boss" ? 500 : e.kind === "spreader" ? 30 : 10;
          state.enemiesDestroyed++;
          spawnExplosion(state, e.x, e.y, e.kind === "boss" ? 20 : 8);
          // chance to drop power-up
          if (Math.random() < (e.kind === "boss" ? 1 : 0.08)) {
            spawnPowerUp(state, e.x, e.y);
          }
        }
        break;
      }
    }
  }

  // ─── Collision: enemy bullets → player ───
  if (p.invincibleFrames <= 0) {
    const enemyBullets = state.bullets.filter((b) => !b.fromPlayer);
    for (const b of enemyBullets) {
      if (rectCircleCollision(p.x - p.width / 2, p.y - p.height / 2, p.width, p.height, b.x, b.y, b.radius)) {
        b.y = -999;
        if (p.shieldActive) {
          p.shieldActive = false;
          p.shieldTimer = 0;
        } else {
          p.lives--;
          p.invincibleFrames = INVINCIBLE_DURATION;
          p.spreadLevel = Math.max(1, p.spreadLevel - 1);
          spawnExplosion(state, p.x, p.y, 12);
          if (p.lives <= 0) {
            state.gameOver = true;
          }
        }
        break;
      }
    }
  }

  // ─── Collision: enemies → player (contact) ───
  if (p.invincibleFrames <= 0) {
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      if (rectsOverlap(
        p.x - p.width / 2, p.y - p.height / 2, p.width, p.height,
        e.x - e.width / 2, e.y - e.height / 2, e.width, e.height,
      )) {
        if (p.shieldActive) {
          p.shieldActive = false;
          p.shieldTimer = 0;
        } else {
          p.lives--;
          p.invincibleFrames = INVINCIBLE_DURATION;
          spawnExplosion(state, p.x, p.y, 12);
          if (p.lives <= 0) state.gameOver = true;
        }
        break;
      }
    }
  }

  // ─── Collision: power-ups → player ───
  for (const pu of state.powerUps) {
    if (rectCircleCollision(p.x - p.width / 2, p.y - p.height / 2, p.width, p.height, pu.x, pu.y, pu.radius)) {
      applyPowerUp(state, pu);
      pu.y = CANVAS_H + 100; // remove
    }
  }

  // Clean up dead bullets
  state.bullets = state.bullets.filter((b) => b.y > -50);

  state.totalInputEvents += state.inputEventsThisFrame;

  return state;
}

// ─── Player shooting patterns ───

function firePlayerBullets(state: GameState) {
  const p = state.player;
  const speed = -10;
  const spread = p.spreadLevel;

  // Center bullet always
  state.bullets.push({ x: p.x, y: p.y - p.height / 2, vx: 0, vy: speed, radius: 4, color: "#ffd54f", fromPlayer: true });

  if (spread >= 2) {
    state.bullets.push({ x: p.x - 8, y: p.y - p.height / 2 + 4, vx: -1.5, vy: speed, radius: 3, color: "#ffb74d", fromPlayer: true });
    state.bullets.push({ x: p.x + 8, y: p.y - p.height / 2 + 4, vx: 1.5, vy: speed, radius: 3, color: "#ffb74d", fromPlayer: true });
  }

  if (spread >= 3) {
    state.bullets.push({ x: p.x - 14, y: p.y - p.height / 2 + 8, vx: -3, vy: speed * 0.9, radius: 3, color: "#ff8a65", fromPlayer: true });
    state.bullets.push({ x: p.x + 14, y: p.y - p.height / 2 + 8, vx: 3, vy: speed * 0.9, radius: 3, color: "#ff8a65", fromPlayer: true });
  }
}

// ─── Enemy spawning ───

let nextEnemyId = 1;

function spawnEnemy(state: GameState) {
  const kinds: EnemyKind[] = state.wave < 3 ? ["grunt"] : state.wave < 6 ? ["grunt", "grunt", "spreader"] : ["grunt", "spreader", "bomber"];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];

  const configs: Record<EnemyKind, { w: number; h: number; hp: number }> = {
    grunt: { w: 28, h: 28, hp: 1 },
    spreader: { w: 32, h: 32, hp: 3 },
    bomber: { w: 36, h: 36, hp: 2 },
    boss: { w: 72, h: 60, hp: 40 },
  };

  const cfg = configs[kind];
  state.enemies.push({
    id: nextEnemyId++,
    x: 30 + Math.random() * (CANVAS_W - 60),
    y: -40,
    hp: cfg.hp + Math.floor(state.wave / 4),
    maxHp: cfg.hp + Math.floor(state.wave / 4),
    width: cfg.w,
    height: cfg.h,
    kind,
    fireCooldown: 30 + Math.floor(Math.random() * 60),
    age: 0,
    phase: 0,
  });
}

function spawnBoss(state: GameState) {
  const hp = 30 + state.wave * 5;
  state.enemies.push({
    id: nextEnemyId++,
    x: CANVAS_W / 2,
    y: -80,
    hp,
    maxHp: hp,
    width: 72,
    height: 60,
    kind: "boss",
    fireCooldown: 20,
    age: 0,
    phase: 0,
  });
}

// ─── Enemy AI ───

function updateEnemy(e: Enemy, state: GameState) {
  switch (e.kind) {
    case "grunt":
      e.y += 1.5 + state.wave * 0.1;
      e.x += Math.sin(e.age * 0.04) * 1.5;
      e.fireCooldown--;
      if (e.fireCooldown <= 0) {
        enemyFireSingle(state, e);
        e.fireCooldown = 80 - state.wave * 2;
      }
      break;

    case "spreader":
      e.y += 1.0 + state.wave * 0.05;
      e.x += Math.sin(e.age * 0.03) * 2;
      e.fireCooldown--;
      if (e.fireCooldown <= 0) {
        enemyFireSpread(state, e, 5);
        e.fireCooldown = 100 - state.wave * 3;
      }
      break;

    case "bomber":
      e.y += 2.0;
      e.fireCooldown--;
      if (e.fireCooldown <= 0) {
        enemyFireAimed(state, e);
        e.fireCooldown = 50;
      }
      break;

    case "boss":
      // Move to center then oscillate
      if (e.y < 80) {
        e.y += 0.8;
      } else {
        e.x += Math.sin(e.age * 0.015) * 2.5;
        e.phase++;
        // Multiple attack patterns
        if (e.phase % 30 === 0) enemyFireSpread(state, e, 8 + Math.floor(state.wave / 3));
        if (e.phase % 45 === 0) enemyFireAimed(state, e);
        if (e.phase % 60 === 0) enemyFireSpiral(state, e);
      }
      break;
  }
}

function enemyFireSingle(state: GameState, e: Enemy) {
  state.bullets.push({
    x: e.x, y: e.y + e.height / 2,
    vx: 0, vy: 4 + state.wave * 0.2,
    radius: 4, color: "#ef5350", fromPlayer: false,
  });
}

function enemyFireSpread(state: GameState, e: Enemy, count: number) {
  const angleStep = Math.PI / (count - 1);
  const startAngle = Math.PI / 2 - (angleStep * (count - 1)) / 2;
  const speed = 3 + state.wave * 0.15;
  for (let i = 0; i < count; i++) {
    const angle = startAngle + i * angleStep;
    state.bullets.push({
      x: e.x, y: e.y + e.height / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 3, color: "#e040fb", fromPlayer: false,
    });
  }
}

function enemyFireAimed(state: GameState, e: Enemy) {
  const p = state.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = 5 + state.wave * 0.15;
  state.bullets.push({
    x: e.x, y: e.y + e.height / 2,
    vx: (dx / dist) * speed,
    vy: (dy / dist) * speed,
    radius: 5, color: "#ff7043", fromPlayer: false,
  });
}

function enemyFireSpiral(state: GameState, e: Enemy) {
  const count = 12;
  const speed = 2.5;
  const offset = e.phase * 0.1;
  for (let i = 0; i < count; i++) {
    const angle = offset + (i / count) * Math.PI * 2;
    state.bullets.push({
      x: e.x, y: e.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 3, color: "#ab47bc", fromPlayer: false,
    });
  }
}

// ─── Effects ───

function spawnExplosion(state: GameState, x: number, y: number, count: number) {
  const colors = ["#ffd54f", "#ff8a65", "#ef5350", "#ffffff"];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 4;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 15 + Math.floor(Math.random() * 20),
      maxLife: 35,
      color: colors[Math.floor(Math.random() * colors.length)],
      radius: 2 + Math.random() * 4,
    });
  }
}

function spawnPowerUp(state: GameState, x: number, y: number) {
  const kinds: PowerUp["kind"][] = ["spread", "speed", "shield"];
  state.powerUps.push({
    x, y,
    vy: 1.5,
    kind: kinds[Math.floor(Math.random() * kinds.length)],
    radius: 12,
  });
}

function applyPowerUp(state: GameState, pu: PowerUp) {
  const p = state.player;
  switch (pu.kind) {
    case "spread":
      p.spreadLevel = Math.min(3, p.spreadLevel + 1);
      break;
    case "speed":
      p.fireRate = Math.max(2, p.fireRate - 1);
      break;
    case "shield":
      p.shieldActive = true;
      p.shieldTimer = 300;
      break;
  }
  state.score += 50;
}

// ─── Collision helpers ───

function rectCircleCollision(
  rx: number, ry: number, rw: number, rh: number,
  cx: number, cy: number, cr: number,
): boolean {
  const nearX = Math.max(rx, Math.min(cx, rx + rw));
  const nearY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearX;
  const dy = cy - nearY;
  return dx * dx + dy * dy < cr * cr;
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ─── Metrics ───

export function getMetrics(state: GameState) {
  const avgFps =
    state.fpsSamples.length > 0
      ? state.fpsSamples.reduce((a, b) => a + b, 0) / state.fpsSamples.length
      : 0;

  return {
    fps: Math.round(avgFps),
    score: state.score,
    wave: state.wave,
    lives: state.player.lives,
    enemies: state.enemies.length,
    bullets: state.bullets.length,
    particles: state.particles.length,
    shotsFired: state.shotsFired,
    enemiesDestroyed: state.enemiesDestroyed,
    totalInputEvents: state.totalInputEvents,
    spreadLevel: state.player.spreadLevel,
    shieldActive: state.player.shieldActive,
  };
}
