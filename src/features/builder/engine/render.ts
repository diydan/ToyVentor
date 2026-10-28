// Isometric builder renderer. Plain canvas, no React, no frame loop: the
// host component redraws when placements change. Projection is classic
// 2:1 iso — x runs down-right (board length), y down-left (board width),
// z straight up. Invert with invertBoard() for pointer input.
import { footprintOf, type Board, type Placement } from "../../../../shared/build";
import type { Part } from "../../../../shared/part";

export interface View {
  width: number;
  height: number;
  scale: number; // px per mm along board axes
  ox: number;
  oy: number;
}

const COS = Math.cos(Math.PI / 6); // ~0.866
const SIN = 0.5;
const HEADROOM_MM = 46;

export function computeView(width: number, height: number, board: Board): View {
  const spanX = (board.lengthMm + board.widthMm) * COS;
  const spanY = (board.lengthMm + board.widthMm) * SIN + HEADROOM_MM;
  const scale = Math.min(width / spanX, height / spanY) * 0.96;
  return {
    width,
    height,
    scale,
    // Iso x spans -widthMm..+lengthMm around the origin, so centre that
    // asymmetric range rather than the origin itself.
    ox: width / 2 - ((board.lengthMm - board.widthMm) * COS * scale) / 2,
    oy: (height - spanY * scale) / 2 + HEADROOM_MM * scale,
  };
}

export function project(view: View, xMm: number, yMm: number, zMm = 0) {
  return {
    x: view.ox + (xMm - yMm) * COS * view.scale,
    y: view.oy + (xMm + yMm) * SIN * view.scale - zMm * view.scale,
  };
}

/** Screen point back to board millimetres on the plane at height zMm. */
export function invertBoard(view: View, sx: number, sy: number, zMm = 0) {
  const dx = (sx - view.ox) / (COS * view.scale);
  const dy = (sy - view.oy + zMm * view.scale) / (SIN * view.scale);
  return { xMm: (dx + dy) / 2, yMm: (dy - dx) / 2 };
}

const PART_COLORS: Record<string, string> = {
  "snap-spoiler-01": "#e85d1f",
  "snap-brick-2x2-small": "#2563eb",
  "snap-brick-2x2-large": "#1e40af",
  "forge-mount-small": "#57534e",
  "snap-wing-01": "#0f766e",
  "snap-glow-capsule-01": "#d97706",
  "pro-beam-su05": "#4d7c0f",
  "skin-racer-red": "#b91c1c",
};

const PART_HEIGHTS_MM: Record<string, number> = {
  "snap-spoiler-01": 16,
  "snap-brick-2x2-small": 18,
  "snap-brick-2x2-large": 30,
  "forge-mount-small": 6,
  "snap-wing-01": 28,
  "snap-glow-capsule-01": 18,
  "pro-beam-su05": 8,
  "skin-racer-red": 3,
};

export function heightOf(part: Part): number {
  return PART_HEIGHTS_MM[part.id] ?? 14;
}

export function colorOf(part: Part): string {
  return PART_COLORS[part.id] ?? "#78716c";
}

function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `rgb(${r},${g},${b})`;
}

function poly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], fill: string, stroke?: string) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function cuboid(
  ctx: CanvasRenderingContext2D,
  view: View,
  x: number, y: number, w: number, d: number, h: number,
  color: string,
  selected: boolean,
) {
  const top = [
    project(view, x, y, h),
    project(view, x + w, y, h),
    project(view, x + w, y + d, h),
    project(view, x, y + d, h),
  ];
  const left = [top[3]!, top[2]!, project(view, x + w, y + d, 0), project(view, x, y + d, 0)];
  const right = [top[1]!, top[2]!, project(view, x + w, y + d, 0), project(view, x + w, y, 0)];
  poly(ctx, left, shade(color, 0.68));
  poly(ctx, right, shade(color, 0.84));
  poly(ctx, top, shade(color, 1.08), selected ? "#1c1a17" : shade(color, 0.7));
  if (selected) {
    ctx.beginPath();
    top.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = "#1c1a17";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

export interface DrawOptions {
  board: Board;
  toyLabel: string;
  placements: Placement[];
  partsById: Map<string, Part>;
  selectedId?: string;
  ghost?: (Placement & { valid: boolean }) | null;
  gridPitchMm?: number;
}

export function drawBuild(ctx: CanvasRenderingContext2D, view: View, opts: DrawOptions) {
  const { board, placements, partsById, selectedId, ghost } = opts;
  ctx.clearRect(0, 0, view.width, view.height);

  // Stand-in toy body: slab at true board proportions.
  cuboid(ctx, view, 0, 0, board.lengthMm, board.widthMm, 7, "#d6d0c2", false);

  // Grid on the slab top.
  const pitch = opts.gridPitchMm ?? 16;
  ctx.strokeStyle = "rgba(28,26,23,0.16)";
  ctx.lineWidth = 1;
  for (let x = pitch; x < board.lengthMm; x += pitch) {
    const a = project(view, x, 0, 7);
    const b = project(view, x, board.widthMm, 7);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (let y = pitch; y < board.widthMm; y += pitch) {
    const a = project(view, 0, y, 7);
    const b = project(view, board.lengthMm, y, 7);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // Painter's order: far (small x+y) first. Blocks sit on the slab top.
  const drawOne = (p: Placement, alpha: number, isGhost: boolean) => {
    const part = partsById.get(p.partId);
    if (!part) return;
    const [w, d] = footprintOf(part, p.rotation);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, -7 * view.scale);
    cuboid(
      ctx, view, p.xMm, p.yMm, w, d, heightOf(part),
      isGhost && (p as { valid?: boolean }).valid === false ? "#b3261e" : colorOf(part),
      p.instanceId === selectedId && !isGhost,
    );
    ctx.restore();
  };

  const sorted = [...placements].sort((a, b) => a.xMm + a.yMm - (b.xMm + b.yMm));
  for (const p of sorted) {
    if (ghost && p.instanceId === ghost.instanceId) continue; // ghost replaces it
    drawOne(p, 1, false);
  }
  if (ghost) drawOne(ghost, 0.75, true);

  ctx.fillStyle = "#5c574f";
  ctx.font = "12px 'Avenir Next', 'Trebuchet MS', sans-serif";
  ctx.fillText(
    `${opts.toyLabel} · ${board.lengthMm}×${board.widthMm} mm top · stand-in body, true proportions`,
    10, view.height - 10,
  );
}
