import { useEffect, useState } from "react";
import { fetchOfficeLayout } from "../../lib/api";
import { renderOfficeCapture } from "../../lib/office-capture";
import { useWebSocket } from "../../hooks/use-websocket";
import { useDashboardStore } from "../../stores/use-dashboard-store";
import { useOfficeStore } from "../../stores/use-office-store";
import { OfficeCanvas } from "./OfficeCanvas";

export function OfficePage() {
  const { status } = useWebSocket();
  const scene = useOfficeStore((state) => state.scene);
  const applyLayout = useOfficeStore((state) => state.applyLayout);
  const jobs = useDashboardStore((state) => state.jobs);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const layout = await fetchOfficeLayout();
        if (!cancelled) {
          applyLayout(layout);
        }
      } catch {
        if (!cancelled) {
          setCaptureMessage("Using the local office layout until the server syncs.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyLayout]);

  const handleCapture = async () => {
    setIsCapturing(true);
    setCaptureMessage(null);

    try {
      const blob = await renderOfficeCapture(scene, jobs);
      const filename = buildCaptureFilename();
      downloadBlob(blob, filename);

      let message = "PNG downloaded.";
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "image/png": blob,
            }),
          ]);
          message = "PNG downloaded and copied to clipboard.";
        } catch {
          message = "PNG downloaded. Clipboard access was unavailable.";
        }
      }

      setCaptureMessage(message);
    } catch {
      setCaptureMessage("Failed to capture the office view.");
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="space-y-4">
      {status !== "connected" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {status === "connecting"
            ? "Connecting to kuma-studio server..."
            : "Disconnected from server. Attempting to reconnect..."}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-stone-900">Layout Editor</p>
          <p className="text-sm text-stone-500">
            Drag teammates and furniture to rearrange the office. Drops save automatically.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {captureMessage && <p className="text-xs text-stone-500">{captureMessage}</p>}
          <button
            type="button"
            onClick={() => void handleCapture()}
            disabled={isCapturing}
            className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-900 disabled:cursor-not-allowed disabled:bg-amber-300"
          >
            {isCapturing ? "Capturing..." : "Capture PNG"}
          </button>
        </div>
      </div>

      <OfficeCanvas />
    </div>
  );
}

function buildCaptureFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  return `kuma-office-${timestamp}.png`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
