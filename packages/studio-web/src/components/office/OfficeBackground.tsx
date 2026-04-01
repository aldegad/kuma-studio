interface OfficeBackgroundProps {
  background: string;
  isNight?: boolean;
}

export function OfficeBackground({ background: _background, isNight = false }: OfficeBackgroundProps) {
  return (
    <div className="absolute inset-0">
      <img
        src={isNight ? "/assets/furniture/office-bg-night.png" : "/assets/furniture/office-bg.png"}
        alt="office background"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        draggable={false}
        style={{ imageRendering: "pixelated" }}
      />
      <div className={`absolute inset-0 pointer-events-none ${
        isNight ? "bg-gradient-to-b from-indigo-950/20 via-transparent to-indigo-950/10" : "bg-gradient-to-b from-transparent via-transparent to-amber-900/5"
      }`} />
    </div>
  );
}
