import { useEffect, useState } from "react";

export interface ToastMessage {
  id: string;
  text: string;
  type: "info" | "success" | "error";
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Global toast store (simple pub/sub without extra deps)
// ---------------------------------------------------------------------------

type Listener = (toasts: ToastMessage[]) => void;

let toasts: ToastMessage[] = [];
const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) fn([...toasts]);
}

export function pushToast(text: string, type: ToastMessage["type"] = "info") {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  toasts = [...toasts.slice(-4), { id, text, type, timestamp: Date.now() }];
  notify();
}

// ---------------------------------------------------------------------------
// Toast container component — renders in top-left under the top bar
// ---------------------------------------------------------------------------

const TYPE_STYLES: Record<ToastMessage["type"], { bg: string; border: string; text: string }> = {
  info:    { bg: "var(--toast-info-bg)",    border: "var(--toast-info-border)",    text: "var(--toast-info-text)" },
  success: { bg: "var(--toast-success-bg)", border: "var(--toast-success-border)", text: "var(--toast-success-text)" },
  error:   { bg: "var(--toast-error-bg)",   border: "var(--toast-error-border)",   text: "var(--toast-error-text)" },
};

export function ToastContainer() {
  const [items, setItems] = useState<ToastMessage[]>([]);

  useEffect(() => {
    listeners.add(setItems);
    return () => { listeners.delete(setItems); };
  }, []);

  // Auto-dismiss after 4 seconds
  useEffect(() => {
    if (items.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      toasts = toasts.filter((t) => now - t.timestamp < 4000);
      notify();
    }, 1000);
    return () => clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <div className="absolute top-14 left-4 z-40 flex flex-col gap-1.5 pointer-events-none">
      {items.map((toast) => {
        const s = TYPE_STYLES[toast.type];
        return (
          <div
            key={toast.id}
            className="rounded-lg border px-3 py-1.5 shadow-sm backdrop-blur-sm text-[10px] font-medium animate-fade-in"
            style={{ background: s.bg, borderColor: s.border, color: s.text }}
          >
            {toast.text}
          </div>
        );
      })}
    </div>
  );
}
