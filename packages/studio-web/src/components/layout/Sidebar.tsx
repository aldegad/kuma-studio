import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: "grid" },
  { to: "/office", label: "Office", icon: "building" },
] as const;

function NavIcon({ icon }: { icon: string }) {
  switch (icon) {
    case "grid":
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      );
    case "building":
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      );
    default:
      return null;
  }
}

export function Sidebar() {
  return (
    <aside className="flex w-60 flex-col border-r border-stone-200 bg-white">
      <div className="flex h-16 items-center gap-3 border-b border-stone-200 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-800 text-white text-lg font-bold">
          K
        </div>
        <div>
          <h1 className="text-sm font-bold text-stone-900">Kuma Studio</h1>
          <p className="text-xs text-stone-500">v0.1.0</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
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
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-xs text-stone-500">Server connected</span>
        </div>
      </div>
    </aside>
  );
}
