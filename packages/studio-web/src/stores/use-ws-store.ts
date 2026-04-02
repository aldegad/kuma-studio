import { create } from "zustand";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface WsState {
  status: ConnectionStatus;
  ws: WebSocket | null;
  reconnectAttempts: number;
  lastPong: number;

  connect: (url?: string) => void;
  disconnect: () => void;
  send: (data: unknown) => void;
  setStatus: (status: ConnectionStatus) => void;
}

const KUMA_PORT = Number(import.meta.env.VITE_KUMA_PORT) || 4312;
const DEFAULT_WS_URL = `ws://${window.location.hostname}:${KUMA_PORT}/studio/ws`;
const HEARTBEAT_INTERVAL = 25_000; // 25s ping
const HEARTBEAT_TIMEOUT = 35_000; // 35s without pong → stale
const MAX_BACKOFF = 30_000; // cap at 30s

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

export const useWsStore = create<WsState>((set, get) => ({
  status: "disconnected",
  ws: null,
  reconnectAttempts: 0,
  lastPong: Date.now(),

  connect: (url = DEFAULT_WS_URL) => {
    const existing = get().ws;
    if (existing && existing.readyState <= WebSocket.OPEN) return;
    clearTimers();

    set({ status: "connecting" });
    const ws = new WebSocket(url);

    ws.onopen = () => {
      set({ status: "connected", ws, reconnectAttempts: 0, lastPong: Date.now() });

      // Start heartbeat
      heartbeatTimer = setInterval(() => {
        const { ws: currentWs, lastPong } = get();
        if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return;

        // Check if we've missed a pong
        if (Date.now() - lastPong > HEARTBEAT_TIMEOUT) {
          currentWs.close(); // trigger reconnect
          return;
        }

        // Send ping
        try {
          currentWs.send(JSON.stringify({ type: "ping" }));
        } catch { /* will close naturally */ }
      }, HEARTBEAT_INTERVAL);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "pong") {
          set({ lastPong: Date.now() });
        }
      } catch { /* handled by consumer hooks */ }
    };

    ws.onclose = () => {
      clearTimers();
      set({ status: "disconnected", ws: null });
      const attempts = get().reconnectAttempts;
      // Always reconnect — backoff caps at MAX_BACKOFF
      const delay = Math.min(1000 * 2 ** Math.min(attempts, 5), MAX_BACKOFF);
      set({ reconnectAttempts: attempts + 1 });
      reconnectTimer = setTimeout(() => get().connect(url), delay);
    };

    ws.onerror = () => {
      ws.close();
    };

    set({ ws });
  },

  disconnect: () => {
    clearTimers();
    const { ws } = get();
    if (ws) {
      ws.close();
      set({ ws: null, status: "disconnected", reconnectAttempts: Infinity });
    }
  },

  send: (data: unknown) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  },

  setStatus: (status) => set({ status }),
}));

// Reconnect immediately when tab becomes visible again
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const { status, ws, connect } = useWsStore.getState();
      if (status === "disconnected" || (ws && ws.readyState > WebSocket.OPEN)) {
        useWsStore.setState({ reconnectAttempts: 0 });
        connect();
      }
    }
  });
}
