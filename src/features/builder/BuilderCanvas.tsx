import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  canPlace,
  footprintOf,
  pitchOf,
  snapMm,
  type Board,
  type Placement,
} from "../../../shared/build";
import type { Part } from "../../../shared/part";
import {
  computeView,
  drawBuild,
  heightOf,
  invertBoard,
  type View,
} from "./engine/render";

interface DragState {
  instanceId: string;
  grabDxMm: number;
  grabDyMm: number;
  ghost: Placement & { valid: boolean };
}

export function BuilderCanvas({
  board,
  toyLabel,
  placements,
  partsById,
  selectedId,
  gridPitchMm,
  onSelect,
  onMove,
}: {
  board: Board;
  toyLabel: string;
  placements: Placement[];
  partsById: Map<string, Part>;
  selectedId?: string;
  gridPitchMm?: number;
  onSelect: (instanceId: string | undefined) => void;
  onMove: (placement: Placement) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const [size, setSize] = useState({ width: 360, height: 300 });
  const [drag, setDrag] = useState<DragState | null>(null);

  // Track CSS size of the canvas box.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const w = canvas.clientWidth || 360;
      setSize({ width: w, height: Math.round(w * 0.82) });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Redraw on any state change — no frame loop (see docs/decisions/0001).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = computeView(size.width, size.height, board);
    viewRef.current = view;
    drawBuild(ctx, view, {
      board,
      toyLabel,
      placements,
      partsById,
      selectedId,
      gridPitchMm,
      ghost: drag?.ghost ?? null,
    });
  }, [size, board, toyLabel, placements, partsById, selectedId, gridPitchMm, drag]);

  const boardPoint = (e: ReactPointerEvent, zMm: number) => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas || !view) return null;
    const rect = canvas.getBoundingClientRect();
    return invertBoard(view, e.clientX - rect.left, e.clientY - rect.top, zMm);
  };

  const hitPlacement = (e: ReactPointerEvent): Placement | undefined => {
    // Front-most first (reverse painter order), tested on each top face.
    const sorted = [...placements].sort((a, b) => b.xMm + b.yMm - (a.xMm + a.yMm));
    for (const p of sorted) {
      const part = partsById.get(p.partId);
      if (!part) continue;
      const pt = boardPoint(e, heightOf(part) + 7);
      if (!pt) continue;
      const [w, d] = footprintOf(part, p.rotation);
      if (pt.xMm >= p.xMm && pt.xMm <= p.xMm + w && pt.yMm >= p.yMm && pt.yMm <= p.yMm + d)
        return p;
    }
    return undefined;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const hit = hitPlacement(e);
    if (!hit) {
      onSelect(undefined);
      return;
    }
    onSelect(hit.instanceId);
    const part = partsById.get(hit.partId);
    if (!part) return;
    const pt = boardPoint(e, heightOf(part) + 7);
    if (!pt) return;
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already-released pointers: dragging still works
      // without capture while the pointer stays over the canvas.
    }
    setDrag({
      instanceId: hit.instanceId,
      grabDxMm: pt.xMm - hit.xMm,
      grabDyMm: pt.yMm - hit.yMm,
      ghost: { ...hit, valid: true },
    });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const current = placements.find((p) => p.instanceId === drag.instanceId);
    const part = current ? partsById.get(current.partId) : undefined;
    if (!current || !part) return;
    const pt = boardPoint(e, heightOf(part) + 7);
    if (!pt) return;
    const [px, py] = pitchOf(part, current.rotation);
    const [w, d] = footprintOf(part, current.rotation);
    const xMm = Math.min(Math.max(0, snapMm(pt.xMm - drag.grabDxMm, px)), board.lengthMm - w);
    const yMm = Math.min(Math.max(0, snapMm(pt.yMm - drag.grabDyMm, py)), board.widthMm - d);
    const valid = canPlace(part, xMm, yMm, current.rotation, placements, partsById, board, current.instanceId).ok;
    setDrag({ ...drag, ghost: { ...current, xMm, yMm, valid } });
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.ghost.valid) {
      const { valid: _drop, ...placement } = drag.ghost;
      onMove(placement);
    }
    setDrag(null);
  };

  return (
    <canvas
      ref={canvasRef}
      className="builder-canvas"
      style={{ width: "100%", height: size.height, touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      aria-label="Build area. Drag parts to move them on the grid."
    />
  );
}
