// Feature 3 v1 core (docs/specs/sam-physical-to-digital-spec.md §6): one side-on room photo -> a room-themed level.
//
// Pure and deterministic. Input is SAM box segments (noun + normalized box); the photo itself never reaches
// this module and nothing image-like is returned. A closed noun -> prop table (seeded from the Create-mode
// words in WP) maps each segment to a catalog prop, photo order becomes lane order (x 2..43), and the kit
// composes spots, stations and mood around the pinned props (K1). Gates: checkLevel, with one re-compose
// on the next seed, then a no-pins fallback. No solver, no obstacles (that is v2 / level/2).
import { PROPS, type LevelPropRef } from "./catalog";
import { checkLevel, composeLevel, type ComposedLevel, type Mood } from "./levelKit";

/** One SAM match: the searched noun plus its box as fractions of the photo (0..1). */
export interface PhotoSegment {
  noun: string;
  box: { x1: number; y1: number; x2: number; y2: number };
}

/** Closed noun -> catalog prop table. Every value must exist in PROPS (tested). */
export const PHOTO_NOUN_TO_PROP: Record<string, string> = {
  book: "books",
  books: "books",
  pillow: "cushions",
  cushion: "cushions",
  cushions: "cushions",
  box: "blocks",
  blocks: "blocks",
  block: "blocks",
  chair: "chair",
  plant: "plant",
  "flower pot": "plant",
  flowerpot: "plant",
  teddy: "teddy",
  "teddy bear": "teddy",
  ball: "ball",
  lamp: "lamp",
  "floor lamp": "lamp",
};

export type HeightBand = "low" | "mid" | "tall";
export const heightBandOf = (s: PhotoSegment): HeightBand => {
  const h = s.box.y2 - s.box.y1;
  return h > 0.45 ? "tall" : h > 0.22 ? "mid" : "low";
};

/** Nearest shape class for a noun with no table entry, from box shape alone. */
function shapeClassProp(s: PhotoSegment): string {
  const w = s.box.x2 - s.box.x1;
  const h = s.box.y2 - s.box.y1;
  const band = heightBandOf(s);
  if (band === "tall" && w < h * 0.8) return "lamp"; // tall and narrow
  if (band === "low" && Math.abs(w - h) <= Math.max(w, h) * 0.45) return "ball"; // round-ish
  if (band === "low") return "cushions"; // wide and low: soft
  return "blocks"; // boxy default
}

const laneX = (centerFrac: number) => Math.round(Math.max(2, Math.min(43, 2 + centerFrac * 41)) * 2) / 2;

export interface PinnedMapping {
  pinned: LevelPropRef[];
  /** Segments matched through PHOTO_NOUN_TO_PROP (shape-class fallbacks do not count). */
  mapped: number;
  /** Nouns dropped (degenerate box, or past the 16-instance cap). */
  dropped: string[];
}

/** Segments -> pinned props: left-to-right photo order preserved, overlaps keep the larger box. */
export function photoSegmentsToPinnedProps(segments: readonly PhotoSegment[]): PinnedMapping {
  const dropped: string[] = [];
  const usable = segments.filter((s) => {
    const ok = s.box.x2 > s.box.x1 && s.box.y2 > s.box.y1;
    if (!ok) dropped.push(s.noun);
    return ok;
  });
  const area = (s: PhotoSegment) => (s.box.x2 - s.box.x1) * (s.box.y2 - s.box.y1);
  const byCenter = [...usable].sort((a, b) => (a.box.x1 + a.box.x2) / 2 - (b.box.x1 + b.box.x2) / 2);
  const kept: PhotoSegment[] = [];
  for (const s of byCenter) {
    const cx = (s.box.x1 + s.box.x2) / 2;
    const dupe = kept.findIndex((k) => Math.abs((k.box.x1 + k.box.x2) / 2 - cx) < 0.03);
    if (dupe >= 0) {
      if (area(s) > area(kept[dupe]!)) { dropped.push(kept[dupe]!.noun); kept[dupe] = s; }
      else dropped.push(s.noun);
      continue;
    }
    if (kept.length >= 16) { dropped.push(s.noun); continue; }
    kept.push(s);
  }
  kept.sort((a, b) => (a.box.x1 + a.box.x2) / 2 - (b.box.x1 + b.box.x2) / 2);
  let mapped = 0;
  const pinned = kept.map((s) => {
    const direct = PHOTO_NOUN_TO_PROP[s.noun.trim().toLowerCase()];
    if (direct && PROPS[direct]) mapped++;
    const type = direct && PROPS[direct] ? direct : shapeClassProp(s);
    return { type, x: laneX((s.box.x1 + s.box.x2) / 2) };
  });
  return { pinned, mapped, dropped };
}

export interface RoomPhotoResult {
  level: ComposedLevel;
  pinned: LevelPropRef[];
  mapped: number;
  dropped: string[];
  /** True when the first compose failed checkLevel and the next seed was used. */
  repaired: boolean;
  /** True when even the repair failed and the level was composed with no pinned props. */
  fallback: boolean;
}

export interface RoomPhotoOptions {
  seed: number;
  segments: readonly PhotoSegment[];
  mood?: Mood;
  owned?: ReadonlySet<string>;
}

const passes = (l: ComposedLevel) => checkLevel(l).every((c) => c.ok);

/** Compose the room level around the photo props; one seed repair, then a no-pins fallback. Always playable. */
export function composeRoomPhotoLevel(opts: RoomPhotoOptions): RoomPhotoResult {
  const { pinned, mapped, dropped } = photoSegmentsToPinnedProps(opts.segments);
  const base = { theme: "room", mood: opts.mood, owned: opts.owned };
  const first = composeLevel({ ...base, seed: opts.seed, pinnedProps: pinned });
  if (passes(first)) return { level: first, pinned, mapped, dropped, repaired: false, fallback: false };
  const second = composeLevel({ ...base, seed: opts.seed + 1, pinnedProps: pinned });
  if (passes(second)) return { level: second, pinned, mapped, dropped, repaired: true, fallback: false };
  const plain = composeLevel({ ...base, seed: opts.seed });
  return { level: plain, pinned, mapped, dropped, repaired: true, fallback: true };
}
