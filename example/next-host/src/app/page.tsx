import Link from "next/link";
import {
  ArrowRight,
  LayoutTemplate,
  MessageSquareText,
  MousePointerClick,
  Sparkles,
} from "lucide-react";

const pickingSurfaces = [
  {
    icon: MousePointerClick,
    title: "Pick the hero copy",
    body: "Text selection is the fastest way to hand exact context to an agent.",
  },
  {
    icon: MessageSquareText,
    title: "Leave a shared note",
    body: "Keep the implementation trail attached to the same picked session.",
  },
  {
    icon: LayoutTemplate,
    title: "Move into design lab",
    body: "Use the board only when you want side-by-side comparison and arrangement.",
  },
] as const;

const quickFlow = [
  "1. Toggle the floating picker.",
  "2. Select any element on this page.",
  "3. Read the saved context from the local daemon.",
] as const;

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(15,118,110,0.14),transparent_26%),linear-gradient(180deg,#f7faf7_0%,#eaf0eb_100%)] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5">
        <section className="rounded-[2rem] border border-black/5 bg-white/82 px-6 py-7 shadow-[0_24px_72px_rgba(15,35,32,0.08)] backdrop-blur sm:px-8 sm:py-9">
          <div className="max-w-[760px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-900/10 bg-emerald-900/[0.05] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-900">
              <Sparkles className="h-3.5 w-3.5" />
              Agent Picker Demo
            </div>

            <h1 className="mt-6 max-w-[12ch] text-5xl font-semibold tracking-[-0.07em] text-slate-950 sm:text-6xl">
              Pick the UI.
              <br />
              Share the exact context.
            </h1>

            <p className="mt-5 max-w-[56ch] text-base leading-8 text-slate-600 sm:text-lg">
              This example is for the picker first. Select real UI on the page, let the daemon save
              the context into <code className="rounded bg-emerald-900/[0.06] px-1.5 py-0.5 text-[13px] text-emerald-950">.agent-picker</code>,
              and open the design lab only when you want board-style comparison.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/design-lab"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#163126] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#1b3a2d]"
              >
                Open Design Lab
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-sm text-slate-500">
                Toggle the floating picker or press <span className="font-semibold text-slate-950">Cmd/Ctrl+Shift+X</span>
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-[2rem] border border-black/5 bg-[#f7faf7] p-6 shadow-[0_20px_64px_rgba(15,35,32,0.06)] sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.26em] text-slate-500">Demo Surface</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950">
                  A calm page built for picking
                </h2>
              </div>
              <div className="rounded-full border border-emerald-900/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-900">
                Live with daemon
              </div>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {pickingSurfaces.map(({ icon: Icon, title, body }) => (
                <article
                  key={title}
                  className="rounded-[1.5rem] border border-black/5 bg-white/88 p-5 shadow-[0_14px_36px_rgba(15,35,32,0.05)]"
                >
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-900/[0.06] text-emerald-900">
                    <Icon className="h-4 w-4" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="rounded-[2rem] border border-[#173126]/10 bg-[#173126] p-6 text-white shadow-[0_24px_72px_rgba(15,35,32,0.18)] sm:p-7">
            <p className="text-[11px] uppercase tracking-[0.26em] text-emerald-100/70">Quick Flow</p>
            <div className="mt-5 space-y-3">
              {quickFlow.map((step) => (
                <div
                  key={step}
                  className="rounded-[1.25rem] border border-white/10 bg-white/6 px-4 py-4 text-sm leading-6 text-emerald-50"
                >
                  {step}
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
