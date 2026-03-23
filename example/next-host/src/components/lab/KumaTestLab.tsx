"use client";

import type { ComponentProps } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import {
  KUMA_AGENT_CHAT_ICON_SRC,
  KUMA_CAFE_ICON_SRC,
  KUMA_PIANO_ICON_SRC,
  KUMA_RICHTEXT_ICON_SRC,
  KUMA_SHOOTING_ICON_SRC,
  KUMA_SUDOKU_ICON_SRC,
  KUMA_TEST_CONNECT_ICON_SRC,
} from "../../lib/kuma-assets";

type ImageSrc = ComponentProps<typeof Image>["src"];

const TEST_SURFACES: Array<{
  id: string;
  href: string;
  name: string;
  subtitle: string;
  status: string;
  version: string;
  accentClassName: string;
  iconSrc: ImageSrc;
}> = [
  {
    id: "sudoku",
    href: "/sudoku",
    name: "Kuma Sudoku Club",
    subtitle: "Grid clicks, note mode, hints, random boards",
    status: "Ready for automation",
    version: "v2.0 logic surface",
    accentClassName: "kuma-app-row-sudoku",
    iconSrc: KUMA_SUDOKU_ICON_SRC,
  },
  {
    id: "chat",
    href: "/agent-chat",
    name: "Kuma Dispatch Chat",
    subtitle: "Two-bear relay room, transcript verification, shared bridge checks",
    status: "Ready for dual-agent bridge test",
    version: "v1.1 dispatch surface",
    accentClassName: "kuma-app-row-chat",
    iconSrc: KUMA_AGENT_CHAT_ICON_SRC,
  },
  {
    id: "richtext",
    href: "/contenteditable-lab",
    name: "Kuma Rich Text Forge",
    subtitle: "Contenteditable input, toolbar formatting, plain-text and HTML readback",
    status: "Ready for rich-text automation",
    version: "v1.2 editor surface",
    accentClassName: "kuma-app-row-richtext",
    iconSrc: KUMA_RICHTEXT_ICON_SRC,
  },
  {
    id: "cafe",
    href: "/cafe-control-room",
    name: "Kuma Cafe Control Room",
    subtitle: "Tabs, menus, dialogs, toast waits, and real CSV downloads",
    status: "Ready for workflow automation",
    version: "v1.0 browser workflow surface",
    accentClassName: "kuma-app-row-cafe",
    iconSrc: KUMA_CAFE_ICON_SRC,
  },
  {
    id: "shooting",
    href: "/shooting",
    name: "Kuma Shooting Range",
    subtitle: "Canvas bullet-hell, 60 fps touch input, real-time reactivity benchmark",
    status: "Ready for real-time interaction test",
    version: "v1.0 reactivity surface",
    accentClassName: "kuma-app-row-shooting",
    iconSrc: KUMA_SHOOTING_ICON_SRC,
  },
  {
    id: "piano",
    href: "/piano",
    name: "Kuma Piano Deck",
    subtitle: "Polyphonic piano, chord presets, keyboard mapping, and Web Audio playback",
    status: "Ready for audio interaction tests",
    version: "v1.0 harmony surface",
    accentClassName: "kuma-app-row-piano",
    iconSrc: KUMA_PIANO_ICON_SRC,
  },
];

export function KumaTestLab() {
  return (
    <main className="kuma-launcher min-h-screen">
      <header className="kuma-launcher-topbar">
        <div className="mx-auto flex w-full max-w-[1340px] items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-3 text-[#181818]">
            <div className="overflow-hidden rounded-[11px] shadow-[0_10px_24px_rgba(0,0,0,0.14)]">
              <Image
                src={KUMA_TEST_CONNECT_ICON_SRC}
                alt="Kuma Test Connect icon"
                width={36}
                height={36}
                className="block rounded-[11px]"
                priority
              />
            </div>
            <div className="text-[1.15rem] font-semibold tracking-[-0.03em]">Kuma Test Connect</div>
          </div>

          <nav className="hidden items-center gap-10 text-[15px] font-medium text-[#303030] lg:flex">
            <span>Apps</span>
            <span>Browser Tests</span>
            <span>Status</span>
          </nav>

          <div className="flex items-center gap-2 rounded-full border border-[#e2e2e2] bg-white px-3 py-2 text-sm text-[#555555] shadow-[0_8px_20px_rgba(0,0,0,0.04)]">
            <span className="h-2 w-2 rounded-full bg-[#34c759]" />
            <span className="hidden sm:inline">Local Kuma Picker Workspace</span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1340px] flex-col px-6 pb-20 pt-10">
        <div className="flex flex-col gap-5 border-b border-[#e5e5e5] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[13px] font-semibold tracking-[0.18em] text-[#0a84ff] uppercase">
              App Library
            </p>
            <h1 className="mt-3 text-[3.4rem] font-semibold leading-none tracking-[-0.08em] text-[#111111]">
              Apps
            </h1>
            <p className="mt-4 max-w-[54ch] text-[16px] leading-8 text-[#5c5c5c]">
              Six test apps are ready for Kuma Picker flows. Open the icon you want and run the
              full browser test inside its dedicated screen, from slow forms to rich-text editors,
              canvas combat, and audio interaction.
            </p>
          </div>

          <div className="rounded-full border border-[#d9d9d9] bg-white px-4 py-2 text-[13px] font-medium text-[#4a4a4a] shadow-[0_10px_24px_rgba(0,0,0,0.04)]">
            Home shows the launcher only
          </div>
        </div>

        <section className="mt-10 grid gap-x-12 gap-y-14 xl:grid-cols-2">
          {TEST_SURFACES.map((surface) => (
            <Link
              key={surface.id}
              href={surface.href}
              className={`kuma-app-row ${surface.accentClassName}`}
              data-testid={`surface-card-${surface.id}`}
            >
              <div className="shrink-0">
                <AppIcon src={surface.iconSrc} alt={`${surface.name} icon`} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[2rem] font-semibold leading-tight tracking-[-0.06em] text-[#161616]">
                      {surface.name}
                    </h2>
                    <p className="mt-2 text-[15px] leading-7 text-[#2878c7]">
                      {surface.subtitle}
                    </p>
                  </div>

                  <div className="hidden rounded-full bg-[#f5f5f7] px-3 py-1 text-[12px] font-semibold text-[#777777] md:block">
                    Open
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-[#6b6b6b]">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#34c759]" />
                    {surface.version}
                  </span>
                  <span>{surface.status}</span>
                </div>
              </div>

              <ChevronRight className="kuma-app-row-arrow h-5 w-5 shrink-0 text-[#b4b4b4]" />
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}

function AppIcon({
  src,
  alt,
}: {
  src: ImageSrc;
  alt: string;
}) {
  return (
    <div className="kuma-app-icon">
      <Image src={src} alt={alt} width={138} height={138} className="kuma-app-icon-image" priority />
    </div>
  );
}
