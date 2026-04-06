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
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shadow-md transition-colors backdrop-blur-md border"
        style={{ background: "var(--panel-bg)", borderColor: "var(--panel-border)", color: "var(--t-muted)" }}
        title="설정"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-10 right-0 w-52 rounded-2xl backdrop-blur-md border shadow-xl p-3 animate-fade-in"
          style={{ background: "var(--panel-bg-strong)", borderColor: "var(--panel-border)" }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--t-muted)" }}>
            오피스 설정
          </p>

          <div className="space-y-2.5">
            <ToggleRow
              label="애니메이션"
              enabled={animationsEnabled}
              onToggle={onToggleAnimations}
            />
            <ToggleRow
              label="파티클 효과"
              enabled={particlesEnabled}
              onToggle={onToggleParticles}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, enabled, onToggle }: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: "var(--t-secondary)" }}>{label}</span>
      <button
        onClick={onToggle}
        className="w-9 h-5 rounded-full transition-colors relative"
        style={{ background: enabled ? "var(--color-kuma-orange)" : "var(--card-border)" }}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          enabled ? "left-[18px]" : "left-0.5"
        }`} />
      </button>
    </div>
  );
}
