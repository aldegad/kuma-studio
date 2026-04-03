import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SortablePanelProps {
  id: string;
  title: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function SortablePanel({
  id,
  title,
  children,
  disabled = false,
  className = "",
}: SortablePanelProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
    boxShadow: isDragging
      ? "0 20px 40px rgba(15, 23, 42, 0.22)"
      : undefined,
    zIndex: isDragging ? 60 : undefined,
  };

  const handleAttributes = disabled ? {} : attributes;
  const handleListeners = disabled ? undefined : listeners;

  return (
    <div ref={setNodeRef} style={style} className={`relative pt-2 ${className}`}>
      <div className="pointer-events-none absolute right-3 top-0 z-20 flex justify-end">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...handleAttributes}
          {...handleListeners}
          disabled={disabled}
          aria-label={
            disabled ? `${title} 패널 드래그 비활성화` : `${title} 패널 순서 변경`
          }
          className={`pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-300/80 bg-stone-100/95 text-stone-600 shadow backdrop-blur transition ${
            disabled
              ? "cursor-default opacity-45"
              : "touch-none cursor-grab hover:bg-stone-200 hover:border-stone-400 hover:text-stone-800 hover:shadow-md active:cursor-grabbing active:scale-95"
          }`}
          title={disabled ? "모바일에서는 패널 재정렬이 비활성화됩니다." : "드래그해서 패널 순서를 바꾸세요."}
        >
          <span aria-hidden="true" className="text-sm leading-none">
            ⠿
          </span>
        </button>
      </div>

      <div className="[&>*]:!static [&>*]:!inset-auto [&>*]:!left-auto [&>*]:!right-auto [&>*]:!top-auto [&>*]:!bottom-auto [&>*]:!z-auto">
        {children}
      </div>
    </div>
  );
}
