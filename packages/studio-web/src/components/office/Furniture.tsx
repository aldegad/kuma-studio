import type { OfficeFurniture } from "../../types/office";

interface FurnitureProps {
  furniture: OfficeFurniture;
}

const furnitureEmoji: Record<string, string> = {
  desk: "desk",
  chair: "chair",
  whiteboard: "clipboard",
  plant: "potted_plant",
  coffee: "coffee",
};

const furnitureSize: Record<string, { w: number; h: number }> = {
  desk: { w: 64, h: 40 },
  chair: { w: 32, h: 32 },
  whiteboard: { w: 80, h: 60 },
  plant: { w: 28, h: 36 },
  coffee: { w: 20, h: 20 },
};

export function Furniture({ furniture }: FurnitureProps) {
  const size = furnitureSize[furniture.type] ?? { w: 40, h: 40 };
  // furnitureEmoji reserved for future sprite lookup
  void furnitureEmoji;

  if (furniture.imageUrl) {
    return (
      <div
        className="absolute"
        style={{
          left: furniture.position.x,
          top: furniture.position.y,
          width: size.w,
          height: size.h,
          transform: "translate(-50%, -50%)",
        }}
      >
        <img src={furniture.imageUrl} alt={furniture.type} className="h-full w-full object-contain" />
      </div>
    );
  }

  // Placeholder furniture rendering
  return (
    <div
      className="absolute rounded border border-amber-300/40 bg-amber-200/30"
      style={{
        left: furniture.position.x,
        top: furniture.position.y,
        width: size.w,
        height: size.h,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div className="flex h-full items-center justify-center text-xs text-amber-600/60">
        {furniture.type}
      </div>
    </div>
  );
}
