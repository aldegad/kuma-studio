export default function WelcomeCard() {
  return (
    <article className="flex h-full min-h-[320px] w-full flex-col justify-between rounded-[32px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.95),rgba(226,241,238,0.98))] p-8 text-slate-950 shadow-[0_28px_70px_rgba(24,35,32,0.12)]">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-slate-500">
        <span>Kuma Picker</span>
        <span>Example Draft</span>
      </div>

      <div className="space-y-4">
        <div className="inline-flex rounded-full border border-emerald-900/10 bg-emerald-700/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-900">
          Shared engine
        </div>
        <div className="space-y-3">
          <h1 className="max-w-[14ch] text-4xl font-semibold tracking-[-0.04em] text-slate-950">
            Review drafts, capture selections, and hand work to agents.
          </h1>
          <p className="max-w-[42ch] text-sm leading-6 text-slate-600">
            This example card is bundled with the standalone repository so a fresh clone already has something to place on the board.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[22px] border border-slate-900/6 bg-white/75 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Daemon</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">Live scene sync</p>
        </div>
        <div className="rounded-[22px] border border-slate-900/6 bg-white/75 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Selection</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">DOM capture bridge</p>
        </div>
        <div className="rounded-[22px] border border-slate-900/6 bg-white/75 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Notes</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">Shared agent status</p>
        </div>
      </div>
    </article>
  );
}
