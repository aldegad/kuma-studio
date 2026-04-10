import type { MouseEventHandler, ReactNode } from "react";

interface PanelPosition {
  x: number;
  y: number;
}

interface FloatingPanelProps {
  panelId?: string;
  title: string;
  children: ReactNode;
  className?: string;
  position: PanelPosition;
  zIndex: number;
  isDragging?: boolean;
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  onClickCapture?: MouseEventHandler<HTMLDivElement>;
}

export function FloatingPanel({
  panelId,
  title,
  children,
  className = "",
  position,
  zIndex,
  isDragging = false,
  onMouseDown,
  onClickCapture,
}: FloatingPanelProps) {
  return (
    <div
      role="group"
      aria-label={title}
      data-panel-id={panelId}
      onMouseDown={onMouseDown}
      onClickCapture={onClickCapture}
      className={`pointer-events-auto absolute left-0 top-0 max-w-[calc(100vw-2rem)] ${className}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        zIndex,
        opacity: isDragging ? 0.84 : 1,
        transition: isDragging
          ? "none"
          : "transform 180ms ease, opacity 180ms ease, box-shadow 180ms ease",
        boxShadow: isDragging
          ? "0 24px 48px rgba(15, 23, 42, 0.22)"
          : undefined,
      }}
    >
      <div className="game-panel-frame flex flex-col overflow-hidden rounded-xl max-h-[calc(100vh-120px)]">
        {/* Game window title bar */}
        <div className="game-panel-titlebar shrink-0 flex items-center gap-1.5 px-3 py-1.5 cursor-grab active:cursor-grabbing">
          <span className="w-1.5 h-1.5 rounded-sm bg-amber-400/50 shrink-0" />
          <span className="game-panel-title text-[9px] font-black uppercase tracking-[0.15em] truncate">{title}</span>
          <span className="ml-auto flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-current opacity-20" />
            <span className="w-1 h-1 rounded-full bg-current opacity-20" />
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [&>*]:!static [&>*]:!inset-auto [&>*]:!left-auto [&>*]:!right-auto [&>*]:!top-auto [&>*]:!bottom-auto [&>*]:!z-auto [&>*]:!w-full [&>*]:!max-w-full [&>*]:!rounded-none [&>*]:!border-0 [&>*]:!shadow-none">
          {children}
        </div>
      </div>
    </div>
  );
}
