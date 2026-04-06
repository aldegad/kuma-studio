/**
 * OfficeBackground — CSS-only seamless tile system.
 *
 * Replaces the single stretched PNG with repeating CSS gradient tiles
 * so pixel density matches the isometric furniture sprites.
 *
 * Design: warm wood-plank floor + subtle wall panel + game-like grid.
 * Tile size: 64px — about 3 tiles per desk width (200px), natural game ratio.
 */

interface OfficeBackgroundProps {
  background?: string;
  isNight?: boolean;
}

// Tile size in px — calibrated to furniture sprite scale
const TILE = 64;
const PLANK_H = TILE; // one plank = one tile height

// Wall occupies top ~120px of the canvas
const WALL_HEIGHT = 120;

export function OfficeBackground({ isNight = false }: OfficeBackgroundProps) {
  // --- Color palettes ---
  const day = {
    floorBase: "#c8a47a",
    plankA: "#c9a67c",
    plankB: "#bd9770",
    grain: "rgba(101, 67, 33, 0.04)",
    groove: "rgba(101, 67, 33, 0.12)",
    grooveThin: "rgba(101, 67, 33, 0.06)",
    wallBase: "#e8dcc8",
    wallPanel: "rgba(101, 67, 33, 0.05)",
    wallGroove: "rgba(101, 67, 33, 0.10)",
    baseboard: "#9c7c5c",
    baseboardHighlight: "rgba(255, 248, 230, 0.4)",
    gridDot: "rgba(101, 67, 33, 0.06)",
    shadowTop: "rgba(80, 50, 20, 0.12)",
    vignette: "rgba(80, 50, 20, 0.08)",
  };

  const night = {
    floorBase: "#3d3552",
    plankA: "#3e3653",
    plankB: "#352f48",
    grain: "rgba(20, 15, 40, 0.06)",
    groove: "rgba(10, 5, 30, 0.18)",
    grooveThin: "rgba(10, 5, 30, 0.10)",
    wallBase: "#2a2540",
    wallPanel: "rgba(10, 5, 30, 0.08)",
    wallGroove: "rgba(10, 5, 30, 0.15)",
    baseboard: "#4a3f60",
    baseboardHighlight: "rgba(200, 180, 255, 0.08)",
    gridDot: "rgba(140, 120, 200, 0.05)",
    shadowTop: "rgba(10, 5, 30, 0.20)",
    vignette: "rgba(10, 5, 30, 0.15)",
  };

  const c = isNight ? night : day;

  // --- Floor: wood plank tile pattern via repeating gradients ---
  const floorStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: WALL_HEIGHT,
    right: 0,
    bottom: 0,
    backgroundColor: c.floorBase,
    backgroundImage: [
      // Plank groove lines (horizontal, every PLANK_H px)
      `repeating-linear-gradient(180deg, transparent 0px, transparent ${PLANK_H - 2}px, ${c.groove} ${PLANK_H - 2}px, ${c.groove} ${PLANK_H - 1}px, ${c.grooveThin} ${PLANK_H - 1}px, ${c.grooveThin} ${PLANK_H}px)`,
      // Alternating plank color bands
      `repeating-linear-gradient(180deg, ${c.plankA} 0px, ${c.plankA} ${PLANK_H}px, ${c.plankB} ${PLANK_H}px, ${c.plankB} ${PLANK_H * 2}px)`,
      // Subtle horizontal grain
      `repeating-linear-gradient(90deg, transparent 0px, transparent 5px, ${c.grain} 5px, ${c.grain} 6px)`,
      // Plank stagger — vertical seam every ~200px, offset every other row
      `repeating-linear-gradient(180deg, transparent 0px, transparent ${PLANK_H}px, transparent ${PLANK_H}px, transparent ${PLANK_H * 2}px)`,
    ].join(", "),
    backgroundSize: [
      `${PLANK_H}px ${PLANK_H}px`,
      `${PLANK_H}px ${PLANK_H * 2}px`,
      `6px 6px`,
      `200px ${PLANK_H * 2}px`,
    ].join(", "),
  };

  // --- Plank stagger seams (vertical lines offset per row) ---
  // Using an SVG pattern for the stagger effect — much cleaner than CSS
  const staggerSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='${PLANK_H * 2}'>` +
    `<line x1='128' y1='0' x2='128' y2='${PLANK_H}' stroke='${c.groove}' stroke-width='1'/>` +
    `<line x1='0' y1='${PLANK_H}' x2='0' y2='${PLANK_H * 2}' stroke='${c.groove}' stroke-width='1'/>` +
    `<line x1='256' y1='${PLANK_H}' x2='256' y2='${PLANK_H * 2}' stroke='${c.groove}' stroke-width='1'/>` +
    `</svg>`;
  const staggerDataUri = `url("data:image/svg+xml,${encodeURIComponent(staggerSvg)}")`;

  // --- Wall ---
  const wallStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    height: WALL_HEIGHT,
    backgroundColor: c.wallBase,
    backgroundImage: [
      // Horizontal panel grooves
      `repeating-linear-gradient(180deg, transparent 0px, transparent 38px, ${c.wallGroove} 38px, ${c.wallGroove} 40px)`,
      // Vertical panel lines (wainscoting)
      `repeating-linear-gradient(90deg, transparent 0px, transparent 158px, ${c.wallPanel} 158px, ${c.wallPanel} 160px)`,
    ].join(", "),
  };

  // --- Game grid dots (very subtle) ---
  const gridSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE}' height='${TILE}'>` +
    `<circle cx='${TILE / 2}' cy='${TILE / 2}' r='0.8' fill='${c.gridDot}'/>` +
    `</svg>`;
  const gridDataUri = `url("data:image/svg+xml,${encodeURIComponent(gridSvg)}")`;

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Wall */}
      <div style={wallStyle} />

      {/* Baseboard */}
      <div
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          top: WALL_HEIGHT - 4,
          height: 8,
          background: `linear-gradient(180deg, ${c.baseboardHighlight} 0%, ${c.baseboard} 30%, ${c.baseboard} 70%, rgba(0,0,0,0.1) 100%)`,
        }}
      />

      {/* Wall shadow cast onto floor */}
      <div
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          top: WALL_HEIGHT,
          height: 40,
          background: `linear-gradient(180deg, ${c.shadowTop} 0%, transparent 100%)`,
        }}
      />

      {/* Floor planks */}
      <div style={floorStyle} />

      {/* Plank stagger seams overlay */}
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{
          top: WALL_HEIGHT,
          backgroundImage: staggerDataUri,
          backgroundSize: `256px ${PLANK_H * 2}px`,
          backgroundRepeat: "repeat",
        }}
      />

      {/* Game grid dot overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: gridDataUri,
          backgroundSize: `${TILE}px ${TILE}px`,
          backgroundRepeat: "repeat",
        }}
      />

      {/* Edge vignette for depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 80% 70% at 50% 45%, transparent 50%, ${c.vignette} 100%)`,
        }}
      />

      {/* Night: warm lamp spots — enhanced for game atmosphere */}
      {isNight && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Top-left desk lamp — warm golden cone */}
          <div className="absolute" style={{ left: 250, top: 350, width: 600, height: 600, background: "radial-gradient(ellipse 55% 65%, rgba(255, 190, 80, 0.12) 0%, rgba(255, 160, 60, 0.04) 40%, transparent 70%)", borderRadius: "50%" }} />
          {/* Center overhead light — bright warm pool */}
          <div className="absolute" style={{ left: 700, top: 500, width: 700, height: 700, background: "radial-gradient(circle, rgba(255, 200, 120, 0.10) 0%, rgba(255, 180, 80, 0.04) 35%, transparent 60%)", borderRadius: "50%" }} />
          {/* Right area lamp */}
          <div className="absolute" style={{ left: 1350, top: 400, width: 550, height: 550, background: "radial-gradient(ellipse 60% 50%, rgba(255, 195, 90, 0.10) 0%, rgba(255, 165, 70, 0.03) 45%, transparent 70%)", borderRadius: "50%" }} />
          {/* Subtle blue moonlight from top */}
          <div className="absolute" style={{ left: 0, top: 0, width: "100%", height: 300, background: "linear-gradient(180deg, rgba(100, 120, 220, 0.05) 0%, transparent 100%)" }} />
          {/* Warm accent glow — bottom center */}
          <div className="absolute" style={{ left: 500, top: 900, width: 800, height: 400, background: "radial-gradient(ellipse 50% 40%, rgba(255, 180, 100, 0.06) 0%, transparent 70%)", borderRadius: "50%" }} />
        </div>
      )}
    </div>
  );
}
