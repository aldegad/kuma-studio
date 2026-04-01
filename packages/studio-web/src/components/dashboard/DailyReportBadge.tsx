import { useDashboardStore } from "../../stores/use-dashboard-store";
import { KUMA_TEAM } from "../../types/agent";

export function DailyReportBadge({ isNight }: { isNight: boolean }) {
  const report = useDashboardStore((s) => s.dailyReport);
  if (!report) return null;

  const mvp = report.mvpAgent;
  const mvpMember = mvp ? KUMA_TEAM.find((m) => m.id === mvp.id) : null;

  return (
    <div className={`rounded-2xl backdrop-blur-md border shadow-lg p-3 ${
      isNight ? "bg-indigo-950/70 border-indigo-800/40" : "bg-white/75 border-white/50"
    }`}>
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${isNight ? "text-indigo-400" : "text-stone-500"}`}>
        일일 리포트
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={`text-[10px] ${isNight ? "text-indigo-300" : "text-stone-500"}`}>작업</span>
          <span className={`text-xs font-bold ${isNight ? "text-white" : "text-stone-800"}`}>
            {report.completedTasks}/{report.totalTasks}
          </span>
        </div>

        {/* Completion bar */}
        <div className={`h-1.5 rounded-full overflow-hidden ${isNight ? "bg-indigo-900" : "bg-stone-100"}`}>
          <div
            className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-500"
            style={{ width: `${Math.min(report.completionRate, 100)}%` }}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className={`text-[10px] ${isNight ? "text-indigo-300" : "text-stone-500"}`}>완료율</span>
          <span className={`text-xs font-bold ${
            report.completionRate >= 80 ? "text-green-500" : report.completionRate >= 50 ? "text-amber-500" : "text-red-500"
          }`}>
            {report.completionRate}%
          </span>
        </div>

        {report.tokenConsumption > 0 && (
          <div className="flex items-center justify-between">
            <span className={`text-[10px] ${isNight ? "text-indigo-300" : "text-stone-500"}`}>토큰</span>
            <span className={`text-xs font-mono ${isNight ? "text-white" : "text-stone-700"}`}>
              {report.tokenConsumption.toLocaleString()}
            </span>
          </div>
        )}

        {mvpMember && (
          <div className={`mt-1 pt-1.5 border-t ${isNight ? "border-indigo-800" : "border-stone-100"}`}>
            <span className={`text-[9px] ${isNight ? "text-indigo-400" : "text-stone-400"}`}>MVP</span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-sm">{mvpMember.emoji}</span>
              <span className={`text-[10px] font-semibold ${isNight ? "text-amber-200" : "text-amber-700"}`}>
                {mvpMember.nameKo}
              </span>
              <span className={`text-[8px] ml-auto ${isNight ? "text-indigo-400" : "text-stone-400"}`}>
                {mvp!.completedTasks}건
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
