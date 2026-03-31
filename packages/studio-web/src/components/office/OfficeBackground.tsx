interface OfficeBackgroundProps {
  background: string;
}

export function OfficeBackground({ background: _background }: OfficeBackgroundProps) {
  return (
    <div className="absolute inset-0">
      {/* Woodland office floor */}
      <div className="absolute inset-0 bg-gradient-to-b from-amber-100/40 via-amber-50/60 to-orange-100/30" />

      {/* Wood floor pattern */}
      <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-amber-200/50 to-transparent" />

      {/* Wall */}
      <div className="absolute left-0 right-0 top-0 h-16 bg-gradient-to-b from-amber-200/30 to-transparent" />

      {/* Window hint */}
      <div className="absolute right-8 top-4 h-24 w-20 rounded-t-lg border-2 border-amber-300/30 bg-sky-100/30" />
      <div className="absolute right-[52px] top-4 h-24 w-px bg-amber-300/30" />
      <div className="absolute right-8 top-16 h-px w-20 bg-amber-300/30" />
    </div>
  );
}
