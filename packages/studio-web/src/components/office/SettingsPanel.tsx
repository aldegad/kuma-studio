import { useState } from "react";

interface SettingsPanelProps {
  isNight: boolean;
  animationsEnabled: boolean;
  onToggleAnimations: () => void;
  particlesEnabled: boolean;
  onToggleParticles: () => void;
  className?: string;
}

export function SettingsPanel({
  isNight,
  animationsEnabled,
  onToggleAnimations,
  particlesEnabled,
  onToggleParticles,
  className = "",
}: SettingsPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`relative z-30 ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm shadow-md transition-colors ${
          isNight ? "bg-indigo-900/80 text-indigo-300 hover:bg-indigo-800" : "bg-white/80 text-stone-500 hover:bg-white"
        } backdrop-blur-md border ${isNight ? "border-indigo-700/40" : "border-white/50"}`}
        title="설정"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {open && (
        <div className={`absolute top-10 right-0 w-52 rounded-2xl backdrop-blur-md border shadow-xl p-3 animate-fade-in ${
          isNight ? "bg-indigo-950/80 border-indigo-800/50" : "bg-white/90 border-white/50"
        }`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${isNight ? "text-indigo-400" : "text-stone-500"}`}>
            오피스 설정
          </p>

          <div className="space-y-2.5">
            <ToggleRow
              label="애니메이션"
              enabled={animationsEnabled}
              onToggle={onToggleAnimations}
              isNight={isNight}
            />
            <ToggleRow
              label="파티클 효과"
              enabled={particlesEnabled}
              onToggle={onToggleParticles}
              isNight={isNight}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, enabled, onToggle, isNight }: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  isNight: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-[11px] ${isNight ? "text-indigo-200" : "text-stone-600"}`}>{label}</span>
      <button
        onClick={onToggle}
        className={`w-9 h-5 rounded-full transition-colors relative ${
          enabled ? "bg-amber-500" : isNight ? "bg-indigo-700" : "bg-stone-300"
        }`}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          enabled ? "left-[18px]" : "left-0.5"
        }`} />
      </button>
    </div>
  );
}
