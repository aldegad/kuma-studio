const BASE_URL = `http://${window.location.hostname}:4312`;

export async function fetchJobCards(sessionId?: string): Promise<unknown> {
  const search = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const res = await fetch(`${BASE_URL}/job-card${search}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Failed to fetch job cards: ${res.statusText}`);
  return res.json();
}

export async function fetchSelection(): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/selection`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Failed to fetch selection: ${res.statusText}`);
  return res.json();
}

export async function fetchStats(): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/studio/stats`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.statusText}`);
  return res.json();
}
