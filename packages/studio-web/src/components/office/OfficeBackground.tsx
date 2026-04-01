interface OfficeBackgroundProps {
  background: string;
  isNight?: boolean;
}

export function OfficeBackground({ background: _background, isNight = false }: OfficeBackgroundProps) {
  return (
    <div className="absolute inset-0">
      <img
        src="/assets/furniture/office-bg.png"
        alt="office background"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        draggable={false}
        style={{
          imageRendering: "pixelated",
          filter: isNight ? "brightness(0.4) saturate(0.6) hue-rotate(200deg)" : "none",
        }}
      />
      {isNight ? (
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/40 via-indigo-900/20 to-indigo-950/30 pointer-events-none" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-amber-900/5 pointer-events-none" />
      )}
    </div>
  );
}
