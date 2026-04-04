import { useEffect, useState } from "react";
import { pushToast } from "../shared/Toast";

interface ClaudePlanCacheItem {
  id: string;
  filename: string;
  title: string;
  modified: string;
  preview: string;
}

interface ClaudePlansCacheResponse {
  plans: ClaudePlanCacheItem[];
}

const KUMA_PORT = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
const BASE_URL = `http://${window.location.hostname}:${KUMA_PORT}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isClaudePlanCacheItem(value: unknown): value is ClaudePlanCacheItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.filename === "string" &&
    typeof value.title === "string" &&
    typeof value.modified === "string" &&
    typeof value.preview === "string"
  );
}

function isClaudePlansCacheResponse(value: unknown): value is ClaudePlansCacheResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.plans) &&
    value.plans.every(isClaudePlanCacheItem)
  );
}

function formatModifiedDate(iso: string) {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return "";
  }

  return value.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchClaudePlansCache(): Promise<ClaudePlanCacheItem[]> {
  const res = await fetch(`${BASE_URL}/studio/claude-plans`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Claude plans cache: ${res.statusText}`);
  }

  const payload: unknown = await res.json();
  if (!isClaudePlansCacheResponse(payload)) {
    throw new Error("Failed to fetch Claude plans cache: invalid response payload");
  }

  return payload.plans;
}

async function deleteClaudePlan(filename: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/studio/claude-plans/${encodeURIComponent(filename)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });

  if (res.ok) {
    return;
  }

  let message = `Failed to delete Claude plan: ${res.statusText}`;

  try {
    const payload: unknown = await res.json();
    if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
      message = payload.error;
    }
  } catch {
    // Keep the default error message when the response body is not JSON.
  }

  throw new Error(message);
}

interface ClaudePlansCachePanelProps {
  isNight?: boolean;
}

export function ClaudePlansCachePanel({ isNight = false }: ClaudePlansCachePanelProps) {
  const [plans, setPlans] = useState<ClaudePlanCacheItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async (showLoading: boolean) => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const nextPlans = await fetchClaudePlansCache();
        if (!mounted) {
          return;
        }

        setPlans(nextPlans);
        setError(null);
      } catch (nextError) {
        if (!mounted) {
          return;
        }

        const message = nextError instanceof Error
          ? nextError.message
          : "Claude Plans 캐시를 불러오지 못했습니다.";
        setError(message);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load(true);
    const timer = setInterval(() => {
      void load(false);
    }, 30_000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const hasPlans = (plans?.length ?? 0) > 0;

  async function handleDelete(filename: string) {
    if (!window.confirm(`"${filename}" 파일을 삭제할까요?`)) {
      return;
    }

    setDeletingFilename(filename);

    try {
      await deleteClaudePlan(filename);
      const nextPlans = await fetchClaudePlansCache();
      setPlans(nextPlans);
      setError(null);
      pushToast("Claude Plans 캐시를 삭제했습니다.", "success");
    } catch (nextError) {
      const message = nextError instanceof Error
        ? nextError.message
        : "Claude Plans 캐시를 삭제하지 못했습니다.";
      setError(message);
      pushToast(message, "error");
    } finally {
      setDeletingFilename(null);
    }
  }

  return (
    <section
      aria-labelledby="claude-plans-cache-panel-heading"
      className={`rounded-2xl border p-3 shadow-lg backdrop-blur-md ${
        isNight
          ? "border-indigo-800/40 bg-indigo-950/70"
          : "border-white/50 bg-white/75"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3
          id="claude-plans-cache-panel-heading"
          className={`text-[10px] font-bold uppercase tracking-wider ${
            isNight ? "text-indigo-400" : "text-stone-500"
          }`}
        >
          Claude Plans Cache
        </h3>
        <span
          className={`text-[10px] font-mono ${
            isNight ? "text-indigo-300/70" : "text-stone-400"
          }`}
        >
          {plans?.length ?? 0} files
        </span>
      </div>

      {error && (
        <p
          className={`mb-2 text-[10px] ${
            isNight ? "text-rose-300/80" : "text-rose-500"
          }`}
          role="status"
          aria-live="polite"
        >
          {plans ? "최신 캐시를 불러오지 못해 마지막 목록을 표시합니다." : error}
        </p>
      )}

      {loading && !plans ? (
        <p
          className={`text-[10px] ${
            isNight ? "text-indigo-300/60" : "text-stone-400"
          }`}
          role="status"
          aria-live="polite"
        >
          Claude Plans 캐시 불러오는 중
        </p>
      ) : !hasPlans ? (
        <p
          className={`text-[10px] ${
            isNight ? "text-indigo-300/60" : "text-stone-400"
          }`}
        >
          캐시된 Claude Plans 없음
        </p>
      ) : (
        <div className="space-y-2">
          {plans?.map((plan) => {
            const isDeleting = deletingFilename === plan.filename;

            return (
              <article
                key={plan.id}
                className={`rounded-xl border p-2 ${
                  isNight
                    ? "border-indigo-800/50 bg-indigo-900/30"
                    : "border-stone-200/70 bg-stone-50/80"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-[10px] font-mono ${
                        isNight ? "text-indigo-300" : "text-stone-500"
                      }`}
                    >
                      {plan.filename}
                    </p>
                    <p
                      className={`truncate text-xs font-semibold ${
                        isNight ? "text-white" : "text-stone-800"
                      }`}
                    >
                      {plan.title}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(plan.filename)}
                    disabled={isDeleting}
                    className={`shrink-0 rounded-md px-2 py-1 text-[10px] transition-colors ${
                      isDeleting
                        ? isNight
                          ? "cursor-wait bg-indigo-900/70 text-indigo-400"
                          : "cursor-wait bg-stone-100 text-stone-400"
                        : isNight
                          ? "text-rose-200 hover:bg-rose-950/60 hover:text-rose-100"
                          : "text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                    }`}
                    aria-label={`${plan.filename} 삭제`}
                  >
                    {isDeleting ? "삭제 중" : "🗑️"}
                  </button>
                </div>

                <p
                  className={`mt-1 text-[10px] ${
                    isNight ? "text-indigo-400" : "text-stone-400"
                  }`}
                >
                  수정됨 {formatModifiedDate(plan.modified)}
                </p>

                <p
                  className={`mt-1 whitespace-pre-wrap break-words text-[10px] leading-relaxed ${
                    isNight ? "text-indigo-100/90" : "text-stone-600"
                  }`}
                >
                  {plan.preview}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
