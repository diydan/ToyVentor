// The browser's half of the pixels (runtime/lookArt.ts has the pure rules): decode a picture the Worker returned into RGBA at a size the phone can hold, and encode RGBA back to an image blob. Thin on purpose: every
// decision (the key-and-crop, the gates) is in lookArt.ts and is tested; these two only move pixels in and out of a canvas. Exercised for real by the live run and the e2e, not by unit tests.
import { fitWidth, type Rgba } from "./lookArt";

type Canvas2D = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/** The image as RGBA, scaled DOWN to at most `maxWidth` wide (never up). Rejects if the bytes are not an image the browser can decode. */
export async function decodeImage(blob: Blob, maxWidth: number): Promise<Rgba> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = fitWidth(bitmap.width, bitmap.height, maxWidth);
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("no 2d canvas");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  } finally { bitmap.close?.(); }
}

/** RGBA as an image blob: WebP where the browser can encode it (Chrome, Firefox), else whatever it gives back (Safari answers PNG: bigger, fine on a device that keeps only a few worlds). */
export async function encodeImage(image: Rgba, type = "image/webp", quality = 0.86): Promise<Blob> {
  const canvas = makeCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("no 2d canvas");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality));
}
