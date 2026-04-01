import { NavLink } from "react-router-dom";
import { useWsStore } from "../../stores/use-ws-store";

const navItems = [
  { to: "/", label: "스튜디오", icon: "studio" },
] as const;

function NavIcon({ icon }: { icon: string }) {
  switch (icon) {
    case "studio":
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    default:
      return null;
  }
}

export function Sidebar() {
  const wsStatus = useWsStore((s) => s.status);

  const statusColor =
    wsStatus === "connected"
      ? "bg-green-500"
      : wsStatus === "connecting"
        ? "bg-amber-400 animate-pulse"
        : "bg-stone-300";

  const statusLabel =
    wsStatus === "connected"
      ? "서버 연결됨"
      : wsStatus === "connecting"
        ? "연결 중..."
        : "연결 끊김";

  return (
    <aside className="flex w-60 flex-col border-r border-stone-200 bg-white">
      <div className="flex h-16 items-center gap-3 border-b border-stone-200 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-800 text-white text-lg font-bold">
          K
        </div>
        <div>
          <h1 className="text-sm font-bold text-stone-900">쿠마 스튜디오</h1>
          <p className="text-xs text-stone-500">v0.1.0</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-amber-50 text-amber-900"
                  : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
              }`
            }
          >
            <NavIcon icon={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-stone-200 p-4">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="text-xs text-stone-500">{statusLabel}</span>
        </div>
      </div>
    </aside>
  );
}
