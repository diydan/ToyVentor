// SAM 3.1 segmentation output parsing (Meta Model API).
// Wire grammar: one line per frame in the output_text lane, e.g.
//   <0f>0<|box;x1=347;y1=734;x2=837;y2=1104;w=1920;h=1280|><|mask;x=0;y=0;data=371,491,!...|>
// Zero matches arrive as an empty lane — a valid result, not an error.
// Today we only need boxes (sizing, attach regions); mask payloads are
// base85 and get decoded when AR cutouts land. Pure functions, no I/O.

export interface SamBox {
  objectId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Source image dimensions, repeated on every record. */
  imageWidth: number;
  imageHeight: number;
  confidence?: number;
}

const BOX_RE =
  /(?:^|[>,])(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([0-9]*\.?[0-9]+))?\|>/g;

/** Extract every box record from accumulated segmentation text. */
export function parseSegmentationBoxes(text: string): SamBox[] {
  const boxes: SamBox[] = [];
  for (const m of text.matchAll(BOX_RE)) {
    boxes.push({
      objectId: Number(m[1]),
      x1: Number(m[2]),
      y1: Number(m[3]),
      x2: Number(m[4]),
      y2: Number(m[5]),
      imageWidth: Number(m[6]),
      imageHeight: Number(m[7]),
      ...(m[8] !== undefined ? { confidence: Number(m[8]) } : {}),
    });
  }
  return boxes;
}

/** The match to build on: largest box wins when a concept matches several
 *  instances (the hero toy should be the prominent one in frame). */
export function largestBox(boxes: SamBox[]): SamBox | undefined {
  return boxes.reduce<SamBox | undefined>((best, box) => {
    const area = (box.x2 - box.x1) * (box.y2 - box.y1);
    const bestArea = best ? (best.x2 - best.x1) * (best.y2 - best.y1) : -1;
    return area > bestArea ? box : best;
  }, undefined);
}

/**
 * Derive the toy's other dimension from the box aspect ratio, given a
 * human-supplied scale anchor: the real length (longest side) in mm.
 * SAM measures proportions, not millimetres — the anchor is not optional.
 */
export function dimensionsFromBox(
  box: SamBox,
  longestMm: number,
): { lengthMm: number; widthMm: number } {
  const bw = Math.max(1, box.x2 - box.x1);
  const bh = Math.max(1, box.y2 - box.y1);
  const widthMm = Math.round((longestMm * bw) / Math.max(bw, bh));
  return { lengthMm: Math.round(longestMm), widthMm: Math.max(1, widthMm) };
}
