// SAM 3.1 segmentation output parsing (Meta Model API).
// Wire grammar: one line per frame in the output_text lane, e.g.
//   <0f>0<|box;x1=347;y1=734;x2=837;y2=1104;w=1920;h=1280|><|mask;x=0;y=0;data=371,491,!...|>
// Zero matches arrive as an empty lane — a valid result, not an error.
// Boxes are parsed here so the Worker keeps a no-dependency fallback. Mask
// payloads are decoded only in the Worker with Meta's official parser; the
// pure raster summary below is shared so its geometry can be unit-tested.

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
/** Box as fractions of the source image (0..1), so it survives the
 *  client downscaling the photo to a different pixel size. */
export interface NormalizedBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

/** Half-open source-pixel bounds covered by a decoded mask raster. */
export interface MaskBoundsPixels {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SamMaskSilhouette {
  /** Coarse filled-cell SVG path in a width x height viewBox. This keeps
   *  a recognisable silhouette without persisting a pixel-level path. */
  path: string;
  width: number;
  height: number;
}

/** Compact, storage-safe facts derived from a decoded SAM raster. All
 *  points and the outline are fractions of the original photo. */
export interface SamMaskSummary {
  coverage: number;
  outline: NormalizedBox;
  pixelWidth: number;
  pixelHeight: number;
  centroid: NormalizedPoint;
  /** Mean x on the first materially occupied row; useful as a mount seat. */
  topAnchor: NormalizedPoint;
  /** Centre of the row with the most occupied pixels. */
  widestAnchor: NormalizedPoint;
  silhouette?: SamMaskSilhouette;
}

export function normalizeBox(box: SamBox): NormalizedBox {
  return {
    x1: box.x1 / box.imageWidth,
    y1: box.y1 / box.imageHeight,
    x2: box.x2 / box.imageWidth,
    y2: box.y2 / box.imageHeight,
  };
}

export function largestBox(boxes: SamBox[]): SamBox | undefined {
  return boxes.reduce<SamBox | undefined>((best, box) => {
    const area = (box.x2 - box.x1) * (box.y2 - box.y1);
    const bestArea = best ? (best.x2 - best.x1) * (best.y2 - best.y1) : -1;
    return area > bestArea ? box : best;
  }, undefined);
}

/**
 * Derive the toy's other dimension from an aspect ratio, given a
 * human-supplied scale anchor: the real length (longest side) in mm.
 * SAM measures proportions, not millimetres — the anchor is not optional.
 */
export function dimensionsFromPixelSize(
  widthPx: number,
  heightPx: number,
  longestMm: number,
): { lengthMm: number; widthMm: number } {
  const bw = Math.max(1, widthPx);
  const bh = Math.max(1, heightPx);
  const widthMm = Math.round((longestMm * bw) / Math.max(bw, bh));
  return { lengthMm: Math.round(longestMm), widthMm: Math.max(1, widthMm) };
}

export function dimensionsFromBox(
  box: SamBox,
  longestMm: number,
): { lengthMm: number; widthMm: number } {
  return dimensionsFromPixelSize(box.x2 - box.x1, box.y2 - box.y1, longestMm);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function silhouetteFromRaster(
  raster: Uint8Array | readonly number[],
  width: number,
  height: number,
  minX: number,
  minY: number,
  pixelWidth: number,
  pixelHeight: number,
): SamMaskSilhouette | undefined {
  const cols = Math.min(48, pixelWidth);
  const rows = Math.min(36, pixelHeight);
  if (cols <= 0 || rows <= 0) return undefined;

  let path = "";
  for (let row = 0; row < rows; row++) {
    const relY0 = Math.floor((row * pixelHeight) / rows);
    const relY1 = Math.max(relY0 + 1, Math.floor(((row + 1) * pixelHeight) / rows));
    const y0 = minY + relY0;
    const y1 = minY + relY1;
    let runStart: number | undefined;
    for (let col = 0; col <= cols; col++) {
      let occupied = false;
      if (col < cols) {
        const relX0 = Math.floor((col * pixelWidth) / cols);
        const relX1 = Math.max(relX0 + 1, Math.floor(((col + 1) * pixelWidth) / cols));
        const x0 = minX + relX0;
        const x1 = minX + relX1;
        let filled = 0;
        let total = 0;
        for (let y = y0; y < y1 && y < minY + pixelHeight; y++) {
          for (let x = x0; x < x1 && x < minX + pixelWidth; x++) {
            total++;
            if (raster[y * width + x]) filled++;
          }
        }
        occupied = total > 0 && filled / total >= 0.2;
      }
      if (occupied && runStart === undefined) runStart = col;
      if (!occupied && runStart !== undefined) {
        const runWidth = col - runStart;
        path += `M${runStart} ${row}h${runWidth}v1h${-runWidth}Z`;
        runStart = undefined;
        if (path.length > 8_000) return undefined;
      }
    }
  }
  return path ? { path, width: cols, height: rows } : undefined;
}

/**
 * Summarise a row-major decoded mask raster. The raster covers `bounds`
 * in the source image; returned coordinates are normalized to that image.
 * Returns undefined for malformed dimensions or an empty mask so callers
 * can keep their box-only fallback.
 */
export function summarizeMaskRaster(
  raster: Uint8Array | readonly number[],
  width: number,
  height: number,
  bounds: MaskBoundsPixels,
  imageWidth: number,
  imageHeight: number,
): SamMaskSummary | undefined {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width <= 0 || height <= 0 || raster.length < width * height ||
    imageWidth <= 0 || imageHeight <= 0
  ) return undefined;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let occupied = 0;
  let sumX = 0;
  let sumY = 0;
  const rowCounts = new Array<number>(height).fill(0);
  const rowSumX = new Array<number>(height).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!raster[y * width + x]) continue;
      occupied++;
      sumX += x;
      sumY += y;
      rowCounts[y] = (rowCounts[y] ?? 0) + 1;
      rowSumX[y] = (rowSumX[y] ?? 0) + x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (occupied === 0 || maxX < minX || maxY < minY) return undefined;

  const point = (meanRasterX: number, rasterY: number): NormalizedPoint => ({
    x: round4(clamp01((bounds.left + meanRasterX + 0.5) / imageWidth)),
    y: round4(clamp01((bounds.top + rasterY + 0.5) / imageHeight)),
  });

  const materialRowThreshold = Math.max(1, Math.ceil(width * 0.01));
  let topRow = rowCounts.findIndex((count) => count >= materialRowThreshold);
  if (topRow < 0) topRow = minY;

  let widestRow = minY;
  for (let y = minY + 1; y <= maxY; y++) {
    if ((rowCounts[y] ?? 0) > (rowCounts[widestRow] ?? 0)) widestRow = y;
  }

  const pixelWidth = maxX - minX + 1;
  const pixelHeight = maxY - minY + 1;
  const silhouette = silhouetteFromRaster(
    raster,
    width,
    height,
    minX,
    minY,
    pixelWidth,
    pixelHeight,
  );

  return {
    coverage: round4(occupied / (width * height)),
    outline: {
      x1: round4(clamp01((bounds.left + minX) / imageWidth)),
      y1: round4(clamp01((bounds.top + minY) / imageHeight)),
      x2: round4(clamp01((bounds.left + maxX + 1) / imageWidth)),
      y2: round4(clamp01((bounds.top + maxY + 1) / imageHeight)),
    },
    pixelWidth,
    pixelHeight,
    centroid: point(sumX / occupied, sumY / occupied),
    topAnchor: point((rowSumX[topRow] ?? 0) / Math.max(1, rowCounts[topRow] ?? 0), topRow),
    widestAnchor: point(
      (rowSumX[widestRow] ?? 0) / Math.max(1, rowCounts[widestRow] ?? 0),
      widestRow,
    ),
    ...(silhouette ? { silhouette } : {}),
  };
}
