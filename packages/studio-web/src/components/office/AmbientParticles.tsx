import { useMemo } from "react";

interface Particle {
  id: number;
  x: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
}

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    size: 2 + Math.random() * 4,
    duration: 8 + Math.random() * 12,
    delay: Math.random() * 10,
    opacity: 0.1 + Math.random() * 0.2,
  }));
}

export function AmbientParticles({ isNight }: { isNight: boolean }) {
  const particles = useMemo(() => generateParticles(isNight ? 20 : 12), [isNight]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            width: p.size,
            height: p.size,
            backgroundColor: isNight ? "rgba(199, 210, 254, 0.3)" : "rgba(253, 230, 138, 0.4)",
            opacity: p.opacity,
            animation: `ambient-float ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
