"use client";

import { ChevronDown, FolderSearch, Plus, Search } from "lucide-react";
import type { KumaPickerComponentItem } from "../lib/types";

interface KumaPickerSidebarProps {
  query: string;
  onQueryChange: (value: string) => void;
  items: KumaPickerComponentItem[];
  totalStudies: number;
  onAddItem: (itemId: string) => void;
}

function formatCategoryLabel(value: string) {
  return value
    .split("/")
    .map((segment) =>
      segment
        .split(/[-_\s]/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(" "),
    )
    .join(" / ");
}

function formatSourceKindLabel(value: KumaPickerComponentItem["sourceKind"]) {
  switch (value) {
    case "project":
      return "Project";
    case "page-import":
      return "Page Import";
    default:
      return "Draft";
  }
}

export default function KumaPickerSidebar({
  query,
  onQueryChange,
  items,
  totalStudies,
  onAddItem,
}: KumaPickerSidebarProps) {
  const categoryMap = new Map<string, KumaPickerComponentItem[]>();

  for (const item of items) {
    const group = categoryMap.get(item.category) ?? [];
    group.push(item);
    categoryMap.set(item.category, group);
  }

  const categories = Array.from(categoryMap.entries()).sort(([left], [right]) => left.localeCompare(right));

  return (
    <aside className="flex min-h-[280px] w-full min-w-0 flex-col overflow-hidden rounded-[2rem] border border-[#e7e7e7] bg-[#fcfcfc] sm:min-h-[360px] lg:h-full lg:min-h-0">
      <div className="border-b border-[#ececec] px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
            <FolderSearch className="h-5 w-5 text-[#171717]" />
          </div>
          <div className="rounded-full border border-[#e6e6e6] bg-white px-3 py-1.5 text-xs text-[#6b6b6b]">
            {totalStudies} on board
          </div>
        </div>

        <h2 className="mt-5 text-[1.45rem] font-semibold tracking-[-0.03em] text-[#171717]">Library</h2>
      </div>

      <div className="border-b border-[#ececec] px-4 py-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b8b8b]" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search drafts, project components, imports"
            className="w-full rounded-2xl border border-[#e8e8e8] bg-[#f8f8f8] py-3 pl-10 pr-4 text-sm text-[#171717] outline-none transition placeholder:text-[#9b9b9b] focus:border-[#d4d4d4] focus:bg-white"
          />
        </div>
      </div>

      <div className="kuma-picker-scrollbar flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          {categories.map(([category, categoryItems]) => (
            <details key={category} open className="group overflow-hidden rounded-[1.35rem] border border-[#ececec] bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <p className="text-sm font-semibold text-[#171717]">{formatCategoryLabel(category)}</p>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#f4f4f4] px-2.5 py-1 text-[11px] text-[#666]">{categoryItems.length}</span>
                  <ChevronDown className="h-4 w-4 text-[#8a8a8a] transition group-open:rotate-180" />
                </div>
              </summary>

              <div className="space-y-2 border-t border-[#f0f0f0] p-3">
                {categoryItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/kuma-picker-item", item.id);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => onAddItem(item.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-[1rem] border border-[#ededed] bg-[#fafafa] px-3 py-3 text-left shadow-[0_8px_20px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:bg-white"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[#171717]">{item.title}</span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] text-[#7a7a7a]">
                        <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 font-medium text-[#475569]">
                          {formatSourceKindLabel(item.sourceKind)}
                        </span>
                        <span className="truncate">
                          {item.sourceRoute ?? item.sourceFilePath ?? item.componentPath}
                        </span>
                      </span>
                    </span>
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e3e3e3] bg-white text-[#171717]">
                      <Plus className="h-4 w-4" />
                    </span>
                  </button>
                ))}
              </div>
            </details>
          ))}

          {items.length === 0 ? (
            <div className="rounded-[1.4rem] border border-dashed border-[#e0e0e0] bg-white px-4 py-10 text-center text-sm text-[#8b8b8b]">
              No items found.
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
