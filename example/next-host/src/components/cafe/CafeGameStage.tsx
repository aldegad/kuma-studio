"use client";

import { useEffect, useRef } from "react";

import { KUMA_CAFE_BEAR_BARISTA_SRC } from "../../lib/kuma-assets";
import type { CafeGuest, CafeOrder, CafeStageAction, CrewStation } from "./cafe-model";

const STATION_POINTS: Record<CrewStation, { x: number; y: number }> = {
  "Espresso Bar": { x: 180, y: 280 },
  "Bakery Shelf": { x: 410, y: 250 },
  "Service Counter": { x: 655, y: 305 },
};

const GUEST_POINTS = {
  rabbit: { x: 708, y: 188 },
  cat: { x: 828, y: 248 },
  raccoon: { x: 924, y: 316 },
};

const CANVAS_WIDTH = 1040;
const CANVAS_HEIGHT = 460;

function syncCanvasResolution(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const displayWidth = Math.max(1, Math.round(canvas.clientWidth));
  const displayHeight = Math.max(1, Math.round((displayWidth * CANVAS_HEIGHT) / CANVAS_WIDTH));
  const devicePixelRatio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(displayWidth * devicePixelRatio));
  const pixelHeight = Math.max(1, Math.round(displayHeight * devicePixelRatio));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  context.setTransform(pixelWidth / CANVAS_WIDTH, 0, 0, pixelHeight / CANVAS_HEIGHT, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolveImage, rejectImage) => {
    const image = new Image();
    image.onload = () => resolveImage(image);
    image.onerror = () => rejectImage(new Error(`Failed to load ${src}`));
    image.src = src;
  });
}

function getStatusTone(status: CafeOrder["status"]) {
  switch (status) {
    case "working":
      return "#f5b04c";
    case "ready":
      return "#2bc48a";
    case "served":
      return "#8ea0ae";
    default:
      return "#708395";
  }
}

export function CafeGameStage({
  guests,
  orders,
  selectedStation,
  currentAction,
}: {
  guests: CafeGuest[];
  orders: CafeOrder[];
  selectedStation: CrewStation;
  currentAction: CafeStageAction;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bearPositionRef = useRef({ ...STATION_POINTS["Service Counter"] });
  const imagesRef = useRef<Record<string, HTMLImageElement | null>>({});

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const assets = await Promise.allSettled([
        loadImage(KUMA_CAFE_BEAR_BARISTA_SRC),
        ...guests.map((guest) => loadImage(guest.spriteSrc)),
      ]);

      if (cancelled) {
        return;
      }

      imagesRef.current.bear = assets[0].status === "fulfilled" ? assets[0].value : null;
      guests.forEach((guest, index) => {
        const result = assets[index + 1];
        imagesRef.current[guest.id] = result.status === "fulfilled" ? result.value : null;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [guests]);

  useEffect(() => {
    let animationFrame = 0;

    const render = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) {
        animationFrame = window.requestAnimationFrame(render);
        return;
      }

      syncCanvasResolution(canvas, context);
      context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const background = context.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      background.addColorStop(0, "#fff6e7");
      background.addColorStop(0.58, "#ffe7be");
      background.addColorStop(1, "#dca56a");
      context.fillStyle = background;
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      context.fillStyle = "#fff1d5";
      context.beginPath();
      context.roundRect(28, 24, CANVAS_WIDTH - 56, 132, 34);
      context.fill();

      context.fillStyle = "#f5d39a";
      context.beginPath();
      context.roundRect(42, 176, CANVAS_WIDTH - 84, 228, 42);
      context.fill();

      context.fillStyle = "#a96c34";
      context.beginPath();
      context.roundRect(62, 328, CANVAS_WIDTH - 124, 70, 28);
      context.fill();

      for (const [station, point] of Object.entries(STATION_POINTS) as Array<[CrewStation, { x: number; y: number }]>) {
        context.fillStyle = station === selectedStation ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.38)";
        context.beginPath();
        context.roundRect(point.x - 80, point.y - 36, 160, 78, 24);
        context.fill();

        context.fillStyle = "#68401d";
        context.font = "700 15px Pretendard, sans-serif";
        context.textAlign = "center";
        context.fillText(station, point.x, point.y - 4);
      }

      context.fillStyle = "#7d4f22";
      context.font = "900 18px Pretendard, sans-serif";
      context.textAlign = "left";
      context.fillText("Kuma Cafe Shift Floor", 70, 76);
      context.font = "500 13px Pretendard, sans-serif";
      context.fillStyle = "#8b6c4d";
      context.fillText("Semantic DOM controls drive the cafe. Canvas makes the floor feel alive.", 70, 101);

      const actionTarget =
        currentAction.kind === "serve" && currentAction.guestId
          ? GUEST_POINTS[currentAction.guestId]
          : STATION_POINTS[currentAction.station];
      const bearPosition = bearPositionRef.current;
      bearPosition.x += (actionTarget.x - bearPosition.x) * 0.08;
      bearPosition.y += (actionTarget.y - bearPosition.y) * 0.08;

      guests.forEach((guest) => {
        const guestPoint = GUEST_POINTS[guest.id];
        const image = imagesRef.current[guest.id];
        const guestOrders = orders.filter((order) => order.guestId === guest.id && order.status !== "served");

        context.fillStyle = "rgba(255,255,255,0.5)";
        context.beginPath();
        context.ellipse(guestPoint.x, guestPoint.y + 96, 44, 13, 0, 0, Math.PI * 2);
        context.fill();

        if (image) {
          context.drawImage(image, guestPoint.x - 58, guestPoint.y - 34, 116, 116);
        } else {
          context.fillStyle = "#f7ddbb";
          context.beginPath();
          context.arc(guestPoint.x, guestPoint.y + 20, 44, 0, Math.PI * 2);
          context.fill();
        }

        const bubbleY = guestPoint.y - 88;
        context.fillStyle = "rgba(255,255,255,0.92)";
        context.beginPath();
        context.roundRect(guestPoint.x - 70, bubbleY, 140, 54, 18);
        context.fill();
        context.beginPath();
        context.moveTo(guestPoint.x - 10, bubbleY + 54);
        context.lineTo(guestPoint.x + 10, bubbleY + 54);
        context.lineTo(guestPoint.x, bubbleY + 68);
        context.closePath();
        context.fill();
        context.fillStyle = "#563216";
        context.font = "700 11px Pretendard, sans-serif";
        context.textAlign = "center";
        context.fillText(guest.name, guestPoint.x, bubbleY + 18);
        context.font = "600 10px Pretendard, sans-serif";
        context.fillStyle = "#7a5737";
        context.fillText(guestOrders[0]?.itemName ?? "Order completed", guestPoint.x, bubbleY + 35);
      });

      const bearImage = imagesRef.current.bear;
      context.fillStyle = "rgba(0,0,0,0.12)";
      context.beginPath();
      context.ellipse(bearPosition.x, bearPosition.y + 120, 42, 12, 0, 0, Math.PI * 2);
      context.fill();
      if (bearImage) {
        context.drawImage(bearImage, bearPosition.x - 76, bearPosition.y - 34, 152, 152);
      } else {
        context.fillStyle = "#c9853f";
        context.beginPath();
        context.arc(bearPosition.x, bearPosition.y + 18, 50, 0, Math.PI * 2);
        context.fill();
      }

      context.fillStyle = "rgba(34, 49, 63, 0.08)";
      context.beginPath();
      context.roundRect(56, 414, CANVAS_WIDTH - 112, 26, 16);
      context.fill();
      context.fillStyle = "#4a2a10";
      context.font = "700 12px Pretendard, sans-serif";
      context.textAlign = "left";
      context.fillText(currentAction.label, 76, 432);

      orders.slice(0, 3).forEach((order, index) => {
        const chipX = 74 + index * 218;
        const chipY = 116;
        context.fillStyle = "rgba(255,255,255,0.92)";
        context.beginPath();
        context.roundRect(chipX, chipY, 196, 28, 16);
        context.fill();
        context.fillStyle = getStatusTone(order.status);
        context.beginPath();
        context.arc(chipX + 16, chipY + 14, 5, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#614023";
        context.font = "700 11px Pretendard, sans-serif";
        context.fillText(order.itemName, chipX + 30, chipY + 18);
      });

      animationFrame = window.requestAnimationFrame(render);
    };

    animationFrame = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [currentAction, guests, orders, selectedStation]);

  return (
    <div className="overflow-hidden rounded-[2rem] border border-[#a47039]/15 bg-[#fff9ef] p-3 shadow-[0_24px_72px_rgba(89,58,19,0.12)]">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="block h-auto w-full rounded-[1.6rem]"
        aria-label="Kuma Cafe game stage"
      />
    </div>
  );
}
