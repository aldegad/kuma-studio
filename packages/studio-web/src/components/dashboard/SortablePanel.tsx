import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { PanelIcon } from "./PanelIcon";

interface PanelPosition {
  x: number;
  y: number;
}

export type PanelMotionState = "idle" | "measuring" | "minimizing" | "restoring";

export interface PanelMotionVector {
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
  onMinimize?: () => void;
  motionState?: PanelMotionState;
  motionVector?: PanelMotionVector;
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
  onMinimize,
  motionState = "idle",
  motionVector,
}: FloatingPanelProps) {
  const isMeasuring = motionState === "measuring";
  const isMinimizing = motionState === "minimizing";
  const isRestoring = motionState === "restoring";
  const motionX = motionVector?.x ?? 0;
  const motionY = motionVector?.y ?? 0;
  const dockTransform = `translate3d(${motionX}px, ${motionY}px, 0) scale(0.1)`;
  const frameStyle = {
    "--kuma-panel-motion-x": `${motionX}px`,
    "--kuma-panel-motion-y": `${motionY}px`,
    animation: isRestoring
      ? "kuma-panel-restore 300ms cubic-bezier(0.16, 1, 0.3, 1)"
      : undefined,
    filter: isMinimizing ? "blur(1.5px)" : "blur(0)",
    opacity: isMeasuring || isMinimizing ? 0 : 1,
    transform: isMinimizing ? dockTransform : "translate3d(0, 0, 0) scale(1)",
    transformOrigin: "center center",
    transition: isDragging || isMeasuring
      ? "none"
      : "opacity 300ms cubic-bezier(0.16, 1, 0.3, 1), transform 300ms cubic-bezier(0.28, 0.72, 0, 1), filter 300ms ease",
  } as CSSProperties;

  const handleMinimize: MouseEventHandler<HTMLButtonElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onMinimize?.();
  };

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
        pointerEvents: isMeasuring || isMinimizing ? "none" : undefined,
        transition: isDragging
          ? "none"
          : "transform 180ms ease, opacity 180ms ease, box-shadow 180ms ease",
        boxShadow: isDragging
          ? "0 24px 48px rgba(15, 23, 42, 0.22)"
          : undefined,
      }}
    >
      <div
        className="game-panel-frame flex flex-col overflow-hidden rounded-xl max-h-[calc(100vh-120px)]"
        style={frameStyle}
      >
        {/* Game window title bar */}
        <div className="game-panel-titlebar shrink-0 flex items-center gap-1.5 px-3 py-1.5 cursor-grab active:cursor-grabbing">
          <PanelIcon panelId={panelId} className="h-3.5 w-3.5 shrink-0 text-amber-300/75" />
          <span className="game-panel-title text-[9px] font-black uppercase tracking-[0.15em] truncate">{title}</span>
          <button
            type="button"
            data-panel-no-drag="true"
            onClick={handleMinimize}
            className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-amber-100/45 transition-colors hover:bg-white/10 hover:text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200/50"
            title="최소화"
            aria-label={`${title} 패널 최소화`}
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
              <path d="M4 8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [&>*]:!static [&>*]:!inset-auto [&>*]:!left-auto [&>*]:!right-auto [&>*]:!top-auto [&>*]:!bottom-auto [&>*]:!z-auto [&>*]:!w-full [&>*]:!max-w-full [&>*]:!rounded-none [&>*]:!border-0 [&>*]:!shadow-none">
          {children}
        </div>
      </div>
    </div>
  );
}
