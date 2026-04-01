interface OfficeBackgroundProps {
  background: string;
}

export function OfficeBackground({ background: _background }: OfficeBackgroundProps) {
  return (
    <div className="absolute inset-0">
      <img
        src="/assets/furniture/office-bg.png"
        alt="office background"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        draggable={false}
        style={{ imageRendering: "pixelated" }}
      />
      {/* Subtle overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-amber-900/5 pointer-events-none" />
    </div>
  );
}
