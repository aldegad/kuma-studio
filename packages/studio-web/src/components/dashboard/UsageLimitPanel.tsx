import { useEffect, useMemo, useState } from "react";
import { useWsStore } from "../../stores/use-ws-store";

interface Bucket {
  utilization: number;
  resetsAt: string | null;
}

interface ExtraUsage {
  isEnabled: boolean;
  monthlyLimit: number | null;
  usedCredits: number | null;
  utilization: number | null;
  currency: string | null;
}

interface UsageData {
  fiveHour: Bucket | null;
  sevenDay: Bucket | null;
  sevenDayOpus: Bucket | null;
  sevenDaySonnet: Bucket | null;
  sevenDayOmelette: Bucket | null;
  extraUsage: ExtraUsage | null;
}

interface Snapshot {
  status: "idle" | "ok" | "error";
  fetchedAt: string | null;
  error: string | null;
  data: UsageData | null;
}

interface ClaudeUsageEvent {
  type: "kuma-studio:event";
  event: {
    kind: "claude-usage";
    snapshot: Snapshot;
  };
}

const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function formatResetsAt(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const weekday = KOREAN_WEEKDAYS[date.getDay()];
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minStr = String(minutes).padStart(2, "0");
  return `(${weekday}) ${ampm} ${hour12}:${minStr} 에 재설정`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "한 번도 갱신되지 않음";
  const date = new Date(iso);
  const diffSeconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}초 전`;
  if (diffSeconds < 3600) return `${Math.round(diffSeconds / 60)}분 전`;
  if (diffSeconds < 86400) return `${Math.round(diffSeconds / 3600)}시간 전`;
  return `${Math.round(diffSeconds / 86400)}일 전`;
}

function formatCurrency(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  const symbol = currency === "USD" ? "US$" : `${currency ?? ""} `;
  return `${symbol}${dollars.toFixed(2)}`;
}

function clamp(value: number, min = 0, max = 100): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

interface ProgressRowProps {
  label: string;
  sublabel?: string | null;
  utilization: number | null;
}

function ProgressRow({ label, sublabel, utilization }: ProgressRowProps) {
  const display = utilization == null ? "—" : `${Math.round(utilization)}% 사용됨`;
  const width = utilization == null ? 0 : clamp(utilization);
  const filled = utilization != null && utilization > 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold" style={{ color: "var(--t-secondary)" }}>{label}</div>
          {sublabel ? (
            <div className="truncate text-[9px]" style={{ color: "var(--t-faint)" }}>{sublabel}</div>
          ) : null}
        </div>
        <div className="shrink-0 text-[10px] tabular-nums" style={{ color: "var(--t-muted)" }}>{display}</div>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full"
        style={{ background: "var(--track-bg)" }}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={utilization == null ? 0 : Math.round(utilization)}
      >
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-500"
          style={{ width: filled ? `${Math.max(width, 2)}%` : "0%" }}
        />
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] font-bold uppercase tracking-wider pt-2"
      style={{ color: "var(--t-muted)" }}
    >
      {children}
    </div>
  );
}

async function fetchSnapshot(): Promise<Snapshot | null> {
  try {
    const response = await fetch("/studio/usage");
    if (!response.ok) return null;
    return (await response.json()) as Snapshot;
  } catch {
    return null;
  }
}

async function refreshSnapshot(): Promise<Snapshot | null> {
  try {
    const response = await fetch("/studio/usage/refresh", { method: "POST" });
    if (!response.ok) return null;
    return (await response.json()) as Snapshot;
  } catch {
    return null;
  }
}

export function UsageLimitPanel() {
  const ws = useWsStore((state) => state.ws);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void fetchSnapshot().then((next) => {
      if (next) setSnapshot(next);
    });
  }, []);

  useEffect(() => {
    if (!ws) return;
    const handleMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as ClaudeUsageEvent;
        if (payload.type !== "kuma-studio:event" || payload.event.kind !== "claude-usage") {
          return;
        }
        setSnapshot(payload.event.snapshot);
      } catch {
        // ignore malformed websocket payloads
      }
    };
    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const data = snapshot?.data ?? null;
  const lastUpdated = useMemo(() => formatRelative(snapshot?.fetchedAt ?? null), [snapshot?.fetchedAt, now]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const next = await refreshSnapshot();
      if (next) setSnapshot(next);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section
      className="rounded-2xl border shadow-lg backdrop-blur-md overflow-hidden"
      style={{ borderColor: "var(--panel-border)", background: "var(--panel-bg)" }}
    >
      <div className="space-y-2 px-3 py-2.5">
        {snapshot?.status === "error" ? (
          <p
            className="text-[10px]"
            style={{ color: "var(--toast-error-text, #b91c1c)" }}
            role="status"
            aria-live="polite"
          >
            한도 조회 실패 — {snapshot.error?.slice(0, 200) ?? "알 수 없는 오류"}
          </p>
        ) : null}

        <SectionHeader>현재 세션</SectionHeader>
        <ProgressRow
          label="5시간 윈도우"
          sublabel={data?.fiveHour?.resetsAt ? formatResetsAt(data.fiveHour.resetsAt) : null}
          utilization={data?.fiveHour?.utilization ?? null}
        />

        <SectionHeader>주간 한도</SectionHeader>
        <ProgressRow
          label="모든 모델"
          sublabel={data?.sevenDay?.resetsAt ? formatResetsAt(data.sevenDay.resetsAt) : null}
          utilization={data?.sevenDay?.utilization ?? null}
        />
        {data?.sevenDayOpus ? (
          <ProgressRow
            label="Opus 만"
            sublabel={data.sevenDayOpus.resetsAt ? formatResetsAt(data.sevenDayOpus.resetsAt) : null}
            utilization={data.sevenDayOpus.utilization}
          />
        ) : null}
        {data?.sevenDaySonnet ? (
          <ProgressRow
            label="Sonnet 만"
            sublabel={data.sevenDaySonnet.resetsAt ? formatResetsAt(data.sevenDaySonnet.resetsAt) : null}
            utilization={data.sevenDaySonnet.utilization}
          />
        ) : null}
        {data?.sevenDayOmelette ? (
          <ProgressRow
            label="Claude Design"
            sublabel={data.sevenDayOmelette.resetsAt ? formatResetsAt(data.sevenDayOmelette.resetsAt) : null}
            utilization={data.sevenDayOmelette.utilization}
          />
        ) : null}

        {data?.extraUsage?.isEnabled ? (
          <>
            <SectionHeader>추가 사용량</SectionHeader>
            <ProgressRow
              label={`${formatCurrency(data.extraUsage.usedCredits, data.extraUsage.currency)} 사용`}
              sublabel={`월간 지출 한도 ${formatCurrency(data.extraUsage.monthlyLimit, data.extraUsage.currency)}`}
              utilization={data.extraUsage.utilization}
            />
          </>
        ) : null}

        <div
          className="flex items-center justify-between border-t pt-1.5 text-[9px]"
          style={{ borderColor: "var(--border-subtle)", color: "var(--t-faint)" }}
        >
          <span>마지막 업데이트: {lastUpdated}</span>
          <button
            type="button"
            data-panel-no-drag="true"
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded px-1.5 py-0.5 transition-colors disabled:opacity-50"
            style={{ color: "var(--t-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            {refreshing ? "갱신 중…" : "새로고침"}
          </button>
        </div>
      </div>
    </section>
  );
}
