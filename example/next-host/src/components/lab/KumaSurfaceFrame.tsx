"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";

export function KumaSurfaceFrame({
  appName,
  eyebrow,
  headline,
  description,
  pills,
  visual,
  sidekickTitle,
  sidekickBody,
  sidekickItems,
  children,
}: {
  appName: string;
  eyebrow: string;
  headline: ReactNode;
  description: string;
  pills: string[];
  visual: ReactNode;
  sidekickTitle: string;
  sidekickBody: string;
  sidekickItems: string[];
  children: ReactNode;
}) {
  return (
    <section className="kuma-shell min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-6">
        <header className="kuma-surface-topbar">
          <Link href="/" className="kuma-surface-backlink" data-testid="back-to-apps">
            <ArrowLeft className="h-4 w-4" />
            Back to Apps
          </Link>

          <div className="kuma-surface-status">
            <span className="h-2.5 w-2.5 rounded-full bg-[#34c759]" />
            <span>Live Agent Picker Surface</span>
          </div>
        </header>

        <section className="kuma-hero overflow-hidden rounded-[2.3rem] p-6 shadow-[0_28px_90px_rgba(88,53,18,0.18)] sm:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_360px]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#855826]/20 bg-white/78 px-4 py-2 text-[11px] font-black uppercase tracking-[0.3em] text-[#7a4a19]">
                <Sparkles className="h-3.5 w-3.5" />
                {eyebrow}
              </div>
              <h1 className="mt-5 max-w-[11ch] text-5xl font-black leading-[0.88] tracking-[-0.08em] text-[#41230a] sm:text-6xl lg:text-7xl">
                {headline}
              </h1>
              <p className="mt-5 max-w-[62ch] text-base leading-8 text-[#70451d] sm:text-lg">
                {description}
              </p>

              <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold text-[#6f451d]">
                {pills.map((pill) => (
                  <div key={pill} className="kuma-pill">
                    {pill}
                  </div>
                ))}
              </div>
            </div>

            <aside className="kuma-story-card">
              <div className="kuma-story-visual">{visual}</div>
              <div className="kuma-story-copy">
                <p className="text-[11px] uppercase tracking-[0.28em] text-[#f9cf86]">{appName}</p>
                <h2 className="mt-3 text-2xl font-black tracking-[-0.06em] text-[#fff8ea]">
                  {sidekickTitle}
                </h2>
                <p className="mt-3 text-sm leading-7 text-[#f3e2bd]">{sidekickBody}</p>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-[#fff3d6]">
                  {sidekickItems.map((item) => (
                    <li key={item} className="rounded-[1.1rem] bg-white/8 px-4 py-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </section>

        {children}
      </div>
    </section>
  );
}
