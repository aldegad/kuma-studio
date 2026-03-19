"use client";

import Image from "next/image";

import { KUMA_SHOOTING_ICON_SRC } from "../../lib/kuma-assets";
import { KumaSurfaceFrame } from "../lab/KumaSurfaceFrame";
import { ShootingGameCanvas } from "./ShootingGameCanvas";

export function KumaShootingRange() {
  return (
    <KumaSurfaceFrame
      appName="Kuma Shooting Range"
      eyebrow="Real-time interaction surface"
      headline={<>Kuma Shooting Range</>}
      description="A 1945-style bullet-hell game built on HTML5 Canvas. Tests real-time pointer/touch input, 60 fps rendering, and continuous interaction — validating agent picker responsiveness on fast-moving visual targets."
      pills={[
        "Canvas 2D",
        "60 fps loop",
        "Touch + Mouse",
        "Bullet-hell patterns",
        "Real-time metrics",
      ]}
      visual={
        <div className="kuma-story-visual-stack">
          <Image
            src={KUMA_SHOOTING_ICON_SRC}
            alt="Kuma Shooting Range icon"
            width={180}
            height={180}
            className="kuma-story-icon"
            priority
          />
        </div>
      }
      sidekickTitle="Why a Shooting Game?"
      sidekickBody="Existing test surfaces verify accuracy on static grids, chat transcripts, and workflow tabs. This surface stress-tests what they don't: real-time reactivity."
      sidekickItems={[
        "Canvas renders bypass DOM — agent must read pixels or coordinate math",
        "60 fps input loop validates sub-frame pointer tracking",
        "Bullet-hell patterns create time-critical dodge & fire sequences",
        "Metrics panel exposes FPS, bullet count, and input event rate for automated assertions",
      ]}
    >
      <section
        className="kuma-board-card mt-6 overflow-hidden rounded-[2rem] p-5 sm:p-6 lg:p-8"
        data-testid="shooting-game-section"
      >
        <ShootingGameCanvas />
      </section>
    </KumaSurfaceFrame>
  );
}
