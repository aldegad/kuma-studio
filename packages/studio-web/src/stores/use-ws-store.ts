import { create } from "zustand";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface WsState {
  status: ConnectionStatus;
  ws: WebSocket | null;
  reconnectAttempts: number;

  connect: (url?: string) => void;
  disconnect: () => void;
  send: (data: unknown) => void;
  setStatus: (status: ConnectionStatus) => void;
}

const DEFAULT_WS_URL = `ws://${window.location.hostname}:4312/studio/ws`;
const MAX_RECONNECT_ATTEMPTS = 10;

export const useWsStore = create<WsState>((set, get) => ({
  status: "disconnected",
  ws: null,
  reconnectAttempts: 0,

  connect: (url = DEFAULT_WS_URL) => {
    const existing = get().ws;
    if (existing && existing.readyState <= WebSocket.OPEN) return;

    set({ status: "connecting" });
    const ws = new WebSocket(url);

    ws.onopen = () => {
      set({ status: "connected", ws, reconnectAttempts: 0 });
    };

    ws.onclose = () => {
      set({ status: "disconnected", ws: null });
      const attempts = get().reconnectAttempts;
      if (attempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * 2 ** attempts, 30000);
        set({ reconnectAttempts: attempts + 1 });
        setTimeout(() => get().connect(url), delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    set({ ws });
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.close();
      set({ ws: null, status: "disconnected", reconnectAttempts: MAX_RECONNECT_ATTEMPTS });
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
