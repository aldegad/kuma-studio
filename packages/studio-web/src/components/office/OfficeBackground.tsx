interface OfficeBackgroundProps {
  background: string;
}

export function OfficeBackground({ background: _background }: OfficeBackgroundProps) {
  return (
    <div className="absolute inset-0">
      {/* Base floor gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-amber-100/50 via-amber-50/60 to-orange-100/40" />

      {/* Wood floor planks — repeating horizontal lines */}
      <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none">
        {Array.from({ length: 20 }, (_, i) => (
          <line
            key={`plank-${i}`}
            x1="0" y1={200 + i * 30}
            x2="2000" y2={200 + i * 30}
            stroke="#b8860b" strokeWidth="0.5"
          />
        ))}
        {/* Vertical plank gaps */}
        {Array.from({ length: 10 }, (_, i) => (
          <line
            key={`vplank-${i}`}
            x1={100 + i * 200 + (i % 2) * 100}
            y1={200 + (i % 3) * 30}
            x2={100 + i * 200 + (i % 2) * 100}
            y2={200 + (i % 3) * 30 + 30}
            stroke="#b8860b" strokeWidth="0.5"
          />
        ))}
      </svg>

      {/* Wall area */}
      <div className="absolute left-0 right-0 top-0 h-[160px] bg-gradient-to-b from-amber-200/40 via-amber-100/20 to-transparent" />

      {/* Wall baseboard */}
      <div className="absolute left-0 right-0 top-[155px] h-[5px] bg-amber-300/30 rounded-sm" />

      {/* Window — left */}
      <div className="absolute left-20 top-10 h-28 w-24 rounded-t-lg border-2 border-amber-400/25 bg-gradient-to-b from-sky-200/40 to-sky-100/20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-amber-400/20" />
        <div className="absolute left-0 right-0 top-1/2 h-px bg-amber-400/20" />
        {/* Curtain hints */}
        <div className="absolute left-0 top-0 w-3 h-full bg-gradient-to-r from-amber-100/30 to-transparent" />
        <div className="absolute right-0 top-0 w-3 h-full bg-gradient-to-l from-amber-100/30 to-transparent" />
      </div>

      {/* Window — right */}
      <div className="absolute right-20 top-10 h-28 w-24 rounded-t-lg border-2 border-amber-400/25 bg-gradient-to-b from-sky-200/40 to-sky-100/20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-amber-400/20" />
        <div className="absolute left-0 right-0 top-1/2 h-px bg-amber-400/20" />
        <div className="absolute left-0 top-0 w-3 h-full bg-gradient-to-r from-amber-100/30 to-transparent" />
        <div className="absolute right-0 top-0 w-3 h-full bg-gradient-to-l from-amber-100/30 to-transparent" />
      </div>

      {/* Bookshelf on wall */}
      <svg className="absolute pointer-events-none" style={{ left: 340, top: 8 }} width="80" height="80" viewBox="0 0 80 80">
        {/* Shelf frame */}
        <rect x="2" y="2" width="76" height="76" rx="2" fill="none" stroke="#b8860b" strokeWidth="1.5" opacity="0.3" />
        <line x1="2" y1="28" x2="78" y2="28" stroke="#b8860b" strokeWidth="1" opacity="0.3" />
        <line x1="2" y1="54" x2="78" y2="54" stroke="#b8860b" strokeWidth="1" opacity="0.3" />
        {/* Books */}
        <rect x="6" y="6" width="6" height="20" rx="1" fill="#ef4444" opacity="0.3" />
        <rect x="14" y="8" width="5" height="18" rx="1" fill="#3b82f6" opacity="0.3" />
        <rect x="21" y="6" width="7" height="20" rx="1" fill="#22c55e" opacity="0.3" />
        <rect x="30" y="10" width="5" height="16" rx="1" fill="#f59e0b" opacity="0.3" />
        <rect x="37" y="6" width="6" height="20" rx="1" fill="#8b5cf6" opacity="0.3" />
        <rect x="6" y="32" width="8" height="20" rx="1" fill="#ec4899" opacity="0.25" />
        <rect x="16" y="34" width="5" height="18" rx="1" fill="#14b8a6" opacity="0.25" />
        <rect x="23" y="32" width="6" height="20" rx="1" fill="#f97316" opacity="0.25" />
      </svg>

      {/* Clock on wall */}
      <svg className="absolute pointer-events-none" style={{ left: 500, top: 15 }} width="30" height="30" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r="13" fill="white" stroke="#b8860b" strokeWidth="1" opacity="0.4" />
        <circle cx="15" cy="15" r="1" fill="#78716c" opacity="0.4" />
        <line x1="15" y1="15" x2="15" y2="6" stroke="#78716c" strokeWidth="1" opacity="0.3" />
        <line x1="15" y1="15" x2="22" y2="15" stroke="#78716c" strokeWidth="0.8" opacity="0.3" />
      </svg>

      {/* Rug/carpet in center */}
      <ellipse
        cx="450" cy="350"
        rx="120" ry="60"
        fill="none"
        stroke="#d97706"
        strokeWidth="2"
        strokeDasharray="8 4"
        opacity="0.1"
        className="absolute"
        style={{ position: "absolute" }}
      />
    </div>
  );
}
