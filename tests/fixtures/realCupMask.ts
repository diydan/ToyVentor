// The one real SAM mask the repo has: the cup captured from a live sam-3.1 call on 2026-10-28 (a 1920 x 1280 photo).
// tests/sam-worker.test.ts holds the captured string; it is read from there so there is one copy. Decoded here with the
// vendor parser directly, not through worker/meta.ts, so a test can compare the Worker's own decode against it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import type { Raster } from "./outlineMasks";

export const CUP_PHOTO = { width: 1920, height: 1280 } as const;

export async function realCup(): Promise<{ raster: Raster; bounds: { left: number; top: number } }> {
  const src = readFileSync(join(__dirname, "..", "sam-worker.test.ts"), "utf8");
  const m = /const LIVE_CUP = "(.*?)";\n/s.exec(src);
  if (!m) throw new Error("the captured cup is gone from tests/sam-worker.test.ts");
  const live = m[1]!.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  const lane = { item_id: "m", output_index: 0, content_index: 0 };
  const events = [
    { type: "response.output_text.delta", ...lane, delta: live },
    { type: "response.output_text.done", ...lane, text: live },
    { type: "response.completed" },
  ];
  async function* gen() {
    yield* events as never[];
  }
  const result = await parseImageStream(gen()).finalResult;
  const rec = recordsOfKind(result.records, "mask")[0]!;
  const data = decodeMaskToRaster(rec.mask);
  return { raster: { data, width: rec.mask.width, height: rec.mask.height } as Raster, bounds: { left: rec.bounds.left, top: rec.bounds.top } };
}
