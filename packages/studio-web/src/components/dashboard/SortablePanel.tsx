import type { MouseEventHandler, ReactNode } from "react";

interface PanelPosition {
  x: number;
  y: number;
}

interface FloatingPanelProps {
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
      onMouseDown={onMouseDown}
      onClickCapture={onClickCapture}
      className={`pointer-events-auto absolute left-0 top-0 w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] cursor-grab pt-2 active:cursor-grabbing ${className}`}
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
      <div className="[&>*]:!static [&>*]:!inset-auto [&>*]:!left-auto [&>*]:!right-auto [&>*]:!top-auto [&>*]:!bottom-auto [&>*]:!z-auto">
        {children}
      </div>
    </div>
  );
}
