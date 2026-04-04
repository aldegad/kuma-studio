import { KUMA_TEAM } from "../../types/agent";
import { useDashboardStore } from "../../stores/use-dashboard-store";

interface DailyReportWidgetProps {
  compact?: boolean;
  isNight?: boolean;
}

export function DailyReportWidget({ compact = false, isNight = false }: DailyReportWidgetProps) {
  const dailyReport = useDashboardStore((state) => state.dailyReport);
  const tokenConsumption = dailyReport?.tokenConsumption ?? 0;
  const mvpAgentId = dailyReport?.mvpAgent?.id ?? null;
  const reportDate = dailyReport?.date
    ?? new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
  const mvpReport = dailyReport?.mvpAgent ?? null;
  const mvpAgent = mvpAgentId
    ? KUMA_TEAM.find((agent) => agent.id === mvpAgentId) ?? null
    : null;
  const mvpLabel = mvpAgent?.nameKo ?? mvpReport?.id ?? null;
  const mvpEmoji = mvpAgent?.emoji ?? "\uD83C\uDFC5";

  if (compact) {
    return (
      <div className={`rounded-2xl border p-3 shadow-lg backdrop-blur-md ${
        isNight ? "border-indigo-800/40 bg-indigo-950/70" : "border-white/50 bg-white/75"
      }`}>
        <p className={`mb-2 text-[10px] font-bold uppercase tracking-wider ${isNight ? "text-indigo-400" : "text-stone-500"}`}>
          일일 리포트
        </p>
        <div className="space-y-1.5">
          {tokenConsumption > 0 && (
            <div className="flex items-center justify-between">
              <span className={`text-[10px] ${isNight ? "text-indigo-300" : "text-stone-500"}`}>토큰</span>
              <span className={`text-xs font-mono ${isNight ? "text-white" : "text-stone-700"}`}>
                {tokenConsumption.toLocaleString()}
              </span>
            </div>
          )}

          {mvpReport && (
            <div className={`mt-1 border-t pt-1.5 ${isNight ? "border-indigo-800" : "border-stone-100"}`}>
              <span className={`text-[9px] ${isNight ? "text-indigo-400" : "text-stone-400"}`}>MVP</span>
              <div className="mt-0.5 flex items-center gap-1">
                <span className="text-sm" aria-hidden="true">{mvpEmoji}</span>
                <span className={`text-[10px] font-semibold ${isNight ? "text-stone-200" : "text-stone-700"}`}>
                  {mvpLabel}
                </span>
                <span className={`ml-auto text-[8px] ${isNight ? "text-indigo-400" : "text-stone-400"}`}>
                  {mvpReport.completedTasks}건
                </span>
              </div>
            </div>
          )}

          {tokenConsumption === 0 && !mvpReport && (
            <p className={`text-[10px] ${isNight ? "text-indigo-400/70" : "text-stone-400"}`}>
              오늘 기록된 활동이 없습니다.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-stone-900">일일 리포트</h3>
      </div>
      <div className="p-5">
        <div className="space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{reportDate}</p>
          </div>

          <div>
            <Metric label="토큰 소모량" value={tokenConsumption.toLocaleString()} tone="text-stone-700" />
          </div>

          <div className="rounded-lg bg-stone-100 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-600">오늘의 MVP</p>
            {dailyReport?.mvpAgent ? (
              <>
                <p className="mt-2 text-lg font-semibold text-stone-800">
                  {mvpAgent?.nameKo ?? dailyReport.mvpAgent.id}
                </p>
                <p className="text-sm text-stone-600">
                  {dailyReport.mvpAgent.completedTasks.toLocaleString()}개 작업 완료, {dailyReport.mvpAgent.totalTokens.toLocaleString()} 토큰 사용
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-stone-500">아직 오늘의 MVP가 결정되지 않았습니다.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string;
  tone: string;
}

function Metric({ label, value, tone }: MetricProps) {
  return (
    <div className="rounded-lg bg-stone-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}
