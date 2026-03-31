import { useWebSocket } from "../../hooks/use-websocket";
import { OfficeCanvas } from "./OfficeCanvas";

export function OfficePage() {
  const { status } = useWebSocket();

  return (
    <div className="space-y-4">
      {status !== "connected" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {status === "connecting"
            ? "Connecting to kuma-studio server..."
            : "Disconnected from server. Attempting to reconnect..."}
        </div>
      )}
      <OfficeCanvas />
    </div>
  );
}
