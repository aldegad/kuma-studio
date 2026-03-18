import { Settings2, X } from "lucide-react";

import type { SeasonalDrink } from "./cafe-model";

export function CafeSeasonalDialog({
  draft,
  onChange,
  onClose,
  onSave,
}: {
  draft: SeasonalDrink;
  onChange: (field: keyof SeasonalDrink, value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#261505]/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[560px] rounded-[2rem] border border-[#9c703f]/20 bg-[#fff6e6] p-6 shadow-[0_30px_100px_rgba(42,24,7,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#8e5d2b]">Seasonal Editor</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.06em] text-[#41230a]">Create a featured drink</h2>
          </div>
          <button type="button" className="kuma-tool" data-testid="close-seasonal-dialog" onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </button>
        </div>

        <div role="dialog" aria-modal="true" aria-label="Create a featured drink" className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-black tracking-[-0.03em] text-[#4d2e11]">Drink Name</span>
            <input
              className="kuma-field mt-3"
              placeholder="Cloud Honey Latte"
              required
              value={draft.name}
              onChange={(event) => onChange("name", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-black tracking-[-0.03em] text-[#4d2e11]">Promo URL</span>
            <input
              className="kuma-field mt-3"
              placeholder="https://example.com/menu/cloud-honey-latte"
              required
              value={draft.url}
              onChange={(event) => onChange("url", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-black tracking-[-0.03em] text-[#4d2e11]">Control Message</span>
            <textarea
              className="kuma-field mt-3 min-h-[120px] resize-none py-4"
              placeholder="Tell the floor team what changed."
              value={draft.controlMessage}
              onChange={(event) => onChange("controlMessage", event.target.value)}
            />
          </label>

          <div className="flex justify-end gap-3">
            <button type="button" className="kuma-tool" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="kuma-tool" data-testid="save-seasonal-drink" onClick={onSave}>
              <Settings2 className="h-4 w-4" />
              Save Drink
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
