"use client";

import { createElement } from "react";
import Image from "next/image";
import { kumaPickerViewports, type KumaPickerComponentItem, type KumaPickerViewport } from "../lib/types";

interface KumaPickerPreviewProps {
  item: KumaPickerComponentItem;
  viewport: KumaPickerViewport;
  propsPatch?: Record<string, unknown>;
}

export default function KumaPickerPreview({ item, viewport, propsPatch }: KumaPickerPreviewProps) {
  const config = kumaPickerViewports[viewport];
  const scaledWidth = Math.round(config.canvasWidth * config.scale);
  const renderContent =
    item.renderKind === "component" ? (
      createElement(item.Component, {
        ...item.props,
        ...(propsPatch ?? {}),
      })
    ) : (
      <div className="relative h-full w-full">
        <Image src={item.assetUrl} alt={item.title} fill unoptimized className="object-contain" sizes={`${config.nodeWidth}px`} />
      </div>
    );

  if (viewport === "original") {
    return (
      <div className="flex h-full w-full items-center justify-center p-5">
        <div className="flex h-full w-full items-center justify-center [&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:object-contain">
          {renderContent}
        </div>
      </div>
    );
  }

  return (
    <div
      className="kuma-picker-scrollbar-soft flex h-full w-full items-start justify-center overflow-auto rounded-[1.8rem] bg-white shadow-[0_18px_44px_rgba(15,23,42,0.08)]"
      style={{ height: config.nodeHeight }}
    >
      <div
        className="pointer-events-none mx-auto shrink-0"
        style={{
          width: scaledWidth,
          minHeight: Math.round(config.canvasHeight * config.scale),
        }}
      >
        <div
          style={{
            width: config.canvasWidth,
            transform: `scale(${config.scale})`,
            transformOrigin: "top left",
          }}
        >
          {renderContent}
        </div>
      </div>
    </div>
  );
}
