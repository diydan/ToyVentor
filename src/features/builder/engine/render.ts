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
  // Canonical 12.5 mm / 25 mm TU PartSpec catalog parts
  "racer-spoiler": "#ff7a45",
  "brick-s-2x2": "#52b7ff",
  "dome-s-2x2": "#38c98e",
  "big-blue-brick": "#2a7fcc",
  "spin-capsule": "#4ecdc4",
  "adapter-snap-pro": "#7f9bff",
  "forge-mount-ring-s": "#7f9bff",
  "cloud-wings": "#5af0b0",
  "glow-capsule": "#ffd24d",
  "beam-str-tu05": "#a78bff",
  "pin-friction": "#8f75ff",
  "gear-spur-z10": "#c084fc",
  "gear-spur-z20": "#9333ea",
  "skin-racer-red": "#ff5c72",
  // Legacy IDs kept for backwards-compatible unit fixtures
  "snap-spoiler-01": "#ff7a45",
  "snap-brick-2x2-small": "#52b7ff",
  "snap-brick-2x2-large": "#2a7fcc",
  "forge-mount-small": "#7f9bff",
  "snap-wing-01": "#5af0b0",
  "snap-glow-capsule-01": "#ffd24d",
  "pro-beam-tu05": "#a78bff",
};

const STAT_FALLBACK_HEX: Record<Part["stat"]["name"], string> = {
  speed: "#ff7a45",
  spin: "#52b7ff",
  torque: "#a78bff",
  glow: "#ffd24d",
};

const PART_HEIGHTS_MM: Record<string, number> = {
  "skin-racer-red": 3,
  "snap-spoiler-01": 16,
  "snap-brick-2x2-small": 18,
  "snap-brick-2x2-large": 30,
  "forge-mount-small": 6,
  "snap-wing-01": 28,
  "snap-glow-capsule-01": 18,
  "pro-beam-tu05": 8,
};

export function heightOf(part: Part): number {
  if (PART_HEIGHTS_MM[part.id] !== undefined) return PART_HEIGHTS_MM[part.id]!;
  if (part.bboxMm) return Math.max(4, Math.min(38, Math.round(part.bboxMm[2])));
  return part.printable ? 14 : 3;
}

export function colorOf(part: Part): string {
  if (PART_COLORS[part.id]) return PART_COLORS[part.id]!;
  if (part.line === "pro" && part.stat.name !== "glow") return "#a78bff";
  return STAT_FALLBACK_HEX[part.stat.name] ?? "#52b7ff";
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
  poly(ctx, top, shade(color, 1.08), selected ? "#ffd24d" : shade(color, 0.55));
  if (selected) {
    ctx.beginPath();
    top.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = "#ffd24d";
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
  cuboid(ctx, view, 0, 0, board.lengthMm, board.widthMm, 7, "#243685", false);

  // Grid on the slab top.
  const pitch = opts.gridPitchMm ?? 16;
  ctx.strokeStyle = "rgba(155, 212, 255, 0.28)";
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
      isGhost && (p as { valid?: boolean }).valid === false ? "#ff6a5c" : colorOf(part),
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

  ctx.fillStyle = "#bfcaf5";
  ctx.font = "600 12px 'Figtree', system-ui, sans-serif";
  ctx.fillText(
    `${opts.toyLabel} · ${board.lengthMm}×${board.widthMm} mm top · true proportions`,
    12, view.height - 10,
  );
}
