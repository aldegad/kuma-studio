import { useState } from "react";
import { useActivityStore, type ActivityEvent } from "../../stores/use-activity-store";

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "방금";
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  return `${Math.floor(diff / 3600)}시간 전`;
}

const TYPE_ICONS: Record<ActivityEvent["type"], string> = {
  "state-change": "🔄",
  "task-start": "▶️",
  "task-complete": "✅",
  error: "❌",
};

export function ActivityFeed() {
  const events = useActivityStore((s) => s.events);
  const [collapsed, setCollapsed] = useState(false);

  if (events.length === 0) return null;

  return (
    <div className="absolute bottom-4 right-4 z-30 w-64">
      <div className="rounded-2xl backdrop-blur-md shadow-lg overflow-hidden" style={{ background: "var(--panel-bg)", borderWidth: 1, borderColor: "var(--panel-border)" }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors"
          style={{ color: "var(--t-muted)" }}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider">
            활동 로그
          </span>
          <span className="text-[10px]" style={{ color: "var(--t-faint)" }}>
            {collapsed ? "▼" : "▲"} {events.length}
          </span>
        </button>

        {!collapsed && (
          <div className="max-h-48 overflow-y-auto px-3 py-2 space-y-1.5" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {events.slice(0, 20).map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-2 animate-fade-in"
              >
                <span className="text-[10px] mt-0.5 flex-shrink-0">
                  {TYPE_ICONS[event.type]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] leading-tight" style={{ color: "var(--t-secondary)" }}>
                    <span className="font-semibold" style={{ color: "var(--t-primary)" }}>
                      {event.emoji} {event.agentName}
                    </span>{" "}
                    {event.message}
                  </p>
                  <p className="text-[8px] mt-0.5" style={{ color: "var(--t-faint)" }}>
                    {timeAgo(event.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
