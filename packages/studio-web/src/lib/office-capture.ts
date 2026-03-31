import { COLORS, STATE_COLORS, TEAM_COLORS } from "./constants";
import { ANIMAL_FALLBACKS, FURNITURE_SIZES, OFFICE_CANVAS_SIZE } from "./office-scene";
import type { JobCard } from "../types/job-card";
import type { OfficeCharacter, OfficeFurniture, OfficeScene } from "../types/office";

export async function renderOfficeCapture(scene: OfficeScene, jobs: JobCard[]): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = OFFICE_CANVAS_SIZE.width * 2;
  canvas.height = OFFICE_CANVAS_SIZE.height * 2;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas rendering is not available.");
  }

  ctx.scale(2, 2);
  drawBackground(ctx);

  for (const furniture of scene.furniture) {
    drawFurniture(ctx, furniture);
  }

  for (const character of scene.characters) {
    drawCharacter(ctx, character);
  }

  drawWhiteboard(ctx, scene.furniture.find((item) => item.type === "whiteboard"), jobs.slice(0, 3));

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Failed to create PNG output."));
    }, "image/png");
  });
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, 0, OFFICE_CANVAS_SIZE.height);
  gradient.addColorStop(0, "#fef3c7");
  gradient.addColorStop(0.55, "#fffbeb");
  gradient.addColorStop(1, "#fed7aa");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, OFFICE_CANVAS_SIZE.width, OFFICE_CANVAS_SIZE.height);

  const floorGradient = ctx.createLinearGradient(0, OFFICE_CANVAS_SIZE.height, 0, OFFICE_CANVAS_SIZE.height * 0.66);
  floorGradient.addColorStop(0, "rgba(217, 119, 6, 0.22)");
  floorGradient.addColorStop(1, "rgba(217, 119, 6, 0)");
  ctx.fillStyle = floorGradient;
  ctx.fillRect(0, OFFICE_CANVAS_SIZE.height * 0.66, OFFICE_CANVAS_SIZE.width, OFFICE_CANVAS_SIZE.height * 0.34);

  const wallGradient = ctx.createLinearGradient(0, 0, 0, 72);
  wallGradient.addColorStop(0, "rgba(217, 119, 6, 0.16)");
  wallGradient.addColorStop(1, "rgba(217, 119, 6, 0)");
  ctx.fillStyle = wallGradient;
  ctx.fillRect(0, 0, OFFICE_CANVAS_SIZE.width, 72);

  drawRoundedRect(ctx, 780, 24, 88, 108, 12, "rgba(186, 230, 253, 0.45)", "rgba(217, 119, 6, 0.18)");
  ctx.strokeStyle = "rgba(217, 119, 6, 0.18)";
  ctx.beginPath();
  ctx.moveTo(824, 24);
  ctx.lineTo(824, 132);
  ctx.moveTo(780, 78);
  ctx.lineTo(868, 78);
  ctx.stroke();
}

function drawFurniture(ctx: CanvasRenderingContext2D, furniture: OfficeFurniture) {
  const size = FURNITURE_SIZES[furniture.type] ?? { w: 40, h: 40 };
  const left = furniture.position.x - size.w / 2;
  const top = furniture.position.y - size.h / 2;
  drawRoundedRect(ctx, left, top, size.w, size.h, 10, "rgba(253, 230, 138, 0.42)", "rgba(217, 119, 6, 0.25)");

  ctx.fillStyle = "rgba(180, 83, 9, 0.8)";
  ctx.font = "11px Pretendard Variable, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(furniture.type, furniture.position.x, furniture.position.y);
}

function drawCharacter(ctx: CanvasRenderingContext2D, character: OfficeCharacter) {
  const teamColor = TEAM_COLORS[character.team] ?? COLORS.kumaBrown;
  const circleX = character.position.x;
  const circleY = character.position.y;

  ctx.fillStyle = `${teamColor}22`;
  ctx.beginPath();
  ctx.arc(circleX, circleY, 28, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = teamColor;
  ctx.font = "bold 18px IBM Plex Sans, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ANIMAL_FALLBACKS[character.animal] ?? character.name.slice(0, 1), circleX, circleY);

  const labelWidth = Math.max(64, ctx.measureText(character.name).width + 20);
  const labelLeft = circleX - labelWidth / 2;
  const labelTop = circleY + 34;
  drawRoundedRect(ctx, labelLeft, labelTop, labelWidth, 28, 14, "rgba(255,255,255,0.94)", "rgba(120, 113, 108, 0.12)");

  ctx.fillStyle = "#292524";
  ctx.font = "bold 11px Pretendard Variable, sans-serif";
  ctx.fillText(character.name, circleX, labelTop + 10);
  ctx.fillStyle = "#78716c";
  ctx.font = "9px IBM Plex Sans, sans-serif";
  ctx.fillText(character.role, circleX, labelTop + 20);

  ctx.fillStyle = STATE_COLORS[character.state] ?? STATE_COLORS.idle;
  ctx.beginPath();
  ctx.arc(circleX, labelTop + 36, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawWhiteboard(
  ctx: CanvasRenderingContext2D,
  whiteboardFurniture: OfficeFurniture | undefined,
  jobs: JobCard[],
) {
  const x = whiteboardFurniture?.position.x ?? 400;
  const y = Math.max((whiteboardFurniture?.position.y ?? 90) - 26, 16);
  const width = 200;
  const minHeight = 120;

  drawRoundedRect(ctx, x - width / 2, y, width, minHeight, 12, "rgba(255,255,255,0.92)", "rgba(120, 113, 108, 0.22)");

  ctx.fillStyle = "#78716c";
  ctx.font = "bold 11px IBM Plex Sans, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("JOB BOARD", x, y + 18);

  if (jobs.length === 0) {
    ctx.fillStyle = "#a8a29e";
    ctx.font = "11px Pretendard Variable, sans-serif";
    ctx.fillText("No active jobs", x, y + 64);
    return;
  }

  jobs.forEach((job, index) => {
    const itemTop = y + 30 + index * 26;
    drawRoundedRect(ctx, x - 86, itemTop, 172, 20, 8, "rgba(255, 247, 237, 0.9)", "rgba(253, 186, 116, 0.4)");
    ctx.fillStyle = "#44403c";
    ctx.font = "10px Pretendard Variable, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(truncate(job.message, 24), x - 78, itemTop + 13);
    ctx.fillStyle = statusBadgeColor(job.status);
    ctx.textAlign = "right";
    ctx.fillText(job.status.toUpperCase(), x + 76, itemTop + 13);
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke: string,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function statusBadgeColor(status: JobCard["status"]): string {
  switch (status) {
    case "completed":
      return "#059669";
    case "in_progress":
      return "#2563eb";
    case "error":
      return "#dc2626";
    default:
      return "#a16207";
  }
}
