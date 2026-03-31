import { useLocation } from "react-router-dom";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/office": "Virtual Office",
};

export function Header() {
  const location = useLocation();
  const title = pageTitles[location.pathname] ?? "Kuma Studio";

  return (
    <header className="flex h-16 items-center justify-between border-b border-stone-200 bg-white px-6">
      <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
      <div className="flex items-center gap-4">
        <span className="text-sm text-stone-500">
          Meet your AI team. Watch them work.
        </span>
      </div>
    </header>
  );
}
