#!/usr/bin/env tsx
// Rebuild the selfie sample faces with Muse Image (images/edits, muse-image-1.0), composed for the face plate, then measure
// where each face's eyes and mouth are with SAM 3.1 (text prompts "eye" and "mouth") and write them to faces.json.
//
//   npx tsx scripts/kip-gen-faces.ts --pilot knight        one face into the scratch dir, nothing replaced
//   npx tsx scripts/kip-gen-faces.ts --all                 all 8 faces, SAM, retries, then replaces selfie-faces/*.jpg + faces.json
//   npx tsx scripts/kip-gen-faces.ts --all --only knight,monster   just those faces; faces.json keeps the entries of the others
//   npx tsx scripts/kip-gen-faces.ts --sam-old DIR         only run SAM on the 8 JPEGs in DIR and print hit rates
//   flags: --out DIR (scratch, default os tmp), --budget N (API calls, default 70), --tries N (per face, default 3)
//
// The API key is read from .dev.vars (MODEL_API_KEY or META_MODEL_API_KEY) and is never printed or written.
// Only prompts and a plain guide template go to the API: no photo of any person is involved.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { parseSegmentationBoxes, type SamBox } from "../shared/sam";

const root = process.cwd();
const FACES_DIR = path.join(root, "parts/kip/viewer/selfie-faces");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const OUT = opt("out") ?? path.join(os.tmpdir(), "kip-faces-new");
mkdirSync(OUT, { recursive: true });
const BUDGET = Number(opt("budget") ?? 70);

// ---- the plate marks (mirror of faceTargetFractions() in parts/kip/viewer/kip-faceplate-shape.js) -------------
const W = 1120, H = 599; // 23.2 x 12.4 mm window
const MARKS = {
  leftEye: { x: 0.27155172, y: 0.57258065 },
  rightEye: { x: 0.72844828, y: 0.57258065 },
  mouth: { x: 0.5, y: 0.91935484 },
};

// ---- API -----------------------------------------------------------------------------------------------------
function loadKey(): string {
  const text = readFileSync(path.join(root, ".dev.vars"), "utf8");
  for (const name of ["MODEL_API_KEY", "META_MODEL_API_KEY"]) {
    const m = new RegExp(`^${name}=(.+)$`, "m").exec(text);
    if (m && m[1]!.trim()) return m[1]!.trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("no MODEL_API_KEY in .dev.vars");
}
const KEY = loadKey();
const BASE = (process.env.META_MODEL_API_URL ?? "https://api.meta.ai/v1").replace(/\/+$/, "").replace(/\/responses$/, "");
let calls = 0;
class Stop extends Error {}
function spend(what: string) {
  if (calls >= BUDGET) throw new Stop(`API call budget (${BUDGET}) reached before ${what}`);
  calls++;
}
function checkStatus(status: number, what: string, detail: string) {
  if (status === 401 || status === 403 || status === 429) throw new Stop(`${what}: HTTP ${status} (stopping, not retrying): ${detail.slice(0, 200)}`);
}

async function museEdit(guide: Buffer, prompt: string): Promise<Buffer> {
  spend("image edit");
  const res = await fetch(`${BASE}/images/edits`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "muse-image-1.0", prompt, images: [{ image_url: `data:image/png;base64,${guide.toString("base64")}` }], n: 1 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    checkStatus(res.status, "image edit", detail);
    throw new Error(`image edit failed: HTTP ${res.status} ${detail.slice(0, 120)}`);
  }
  const body = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error("image edit returned no image");
  return Buffer.from(b64, "base64");
}

async function samBoxes(jpeg: Buffer, prompt: string): Promise<SamBox[]> {
  spend(`SAM "${prompt}"`);
  const res = await fetch(`${BASE}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({
      model: "sam-3.1",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: `data:image/jpeg;base64,${jpeg.toString("base64")}` }] }],
      stream: true,
      metadata: { mask_encoding: "one_bit" },
    }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok || !res.body) {
    const detail = res.body ? (await res.text()).slice(0, 300) : "no body";
    checkStatus(res.status, `SAM "${prompt}"`, detail);
    throw new Error(`SAM failed: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:") || line === "data: [DONE]") continue;
      try {
        const ev = JSON.parse(line.slice(5)) as { type?: string; delta?: unknown };
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
      } catch { /* keepalive */ }
    }
  }
  return parseSegmentationBoxes(text);
}

// ---- feature extraction from SAM boxes -----------------------------------------------------------------------
interface Pt { x: number; y: number }
const centre = (b: SamBox): Pt => ({ x: (b.x1 + b.x2) / 2 / b.imageWidth, y: (b.y1 + b.y2) / 2 / b.imageHeight });
const area = (b: SamBox) => (b.x2 - b.x1) * (b.y2 - b.y1);
/** Unique instances (a streaming run repeats the same object per frame): keep the last box per objectId. */
function uniq(boxes: SamBox[]): SamBox[] {
  const m = new Map<number, SamBox>();
  for (const b of boxes) m.set(b.objectId, b);
  return [...m.values()];
}

async function features(jpeg: Buffer, log: string[]) {
  let eyes: Pt[] = [];
  let mouth: Pt | undefined;
  for (const q of ["eye", "eyes"]) {
    const boxes = uniq(await samBoxes(jpeg, q));
    log.push(`SAM "${q}": ${boxes.length} box(es)`);
    if (boxes.length >= 2) {
      // the two largest boxes at a similar height are the pair of eyes
      const top = boxes.sort((a, b) => area(b) - area(a)).slice(0, 4).map(centre);
      let best: [Pt, Pt] | undefined, bestDy = 9;
      for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
        const dy = Math.abs(top[i]!.y - top[j]!.y);
        if (dy < bestDy && Math.abs(top[i]!.x - top[j]!.x) > 0.1) { bestDy = dy; best = [top[i]!, top[j]!]; }
      }
      if (best) { eyes = best.sort((a, b) => a.x - b.x); break; }
    } else if (boxes.length === 1) {
      const b = boxes[0]!; // one box that spans both eyes (e.g. a visor or goggles): split it
      const wide = (b.x2 - b.x1) / b.imageWidth;
      if (wide > 0.35) {
        const c = centre(b);
        eyes = [{ x: c.x - wide / 4, y: c.y }, { x: c.x + wide / 4, y: c.y }];
        log.push("one wide eye box split in two");
        break;
      }
    }
  }
  for (const q of ["mouth", "lips"]) {
    const boxes = uniq(await samBoxes(jpeg, q));
    log.push(`SAM "${q}": ${boxes.length} box(es)`);
    if (boxes.length) { mouth = centre(boxes.sort((a, b) => area(b) - area(a))[0]!); break; }
  }
  return { eyes: eyes.length === 2 ? eyes : undefined, mouth };
}

const dist = (a: Pt, b: Pt) => Math.hypot((a.x - b.x) * (W / H), a.y - b.y); // as a fraction of image height
/** Largest distance of each eye and the mouth from its own mark. Dominated by eye spacing, which the model does not follow. */
function placementError(eyes: Pt[], mouth: Pt): number {
  return Math.max(dist(eyes[0]!, MARKS.leftEye), dist(eyes[1]!, MARKS.rightEye), dist(mouth, MARKS.mouth));
}
/** What a similarity line-up (zoom, turn, shift) cannot fix: the eye midpoint and the mouth against their marks. */
function alignError(eyes: Pt[], mouth: Pt): number {
  const mid = { x: (eyes[0]!.x + eyes[1]!.x) / 2, y: (eyes[0]!.y + eyes[1]!.y) / 2 };
  const tmid = { x: (MARKS.leftEye.x + MARKS.rightEye.x) / 2, y: MARKS.leftEye.y };
  return Math.max(dist(mid, tmid), dist(mouth, MARKS.mouth));
}
const eyeSpanOf = (eyes: Pt[]) => eyes[1]!.x - eyes[0]!.x; // fraction of image width; the mark spacing is 0.534

// ---- guide + prompts -----------------------------------------------------------------------------------------
const BG: Record<string, string> = {
  pirate: "#d9ecff", astronaut: "#e4dcff", robot: "#dff3e4", cat: "#fff0d6", clown: "#ffe3ee", knight: "#e6dcff", monster: "#e2f4d8", superhero: "#ffe9d2",
};
async function guideFor(id: string): Promise<Buffer> {
  const bg = BG[id] ?? "#e8e8f0";
  const eyeR = Math.round(0.075 * H);
  const mark = "rgba(60,60,90,0.35)";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <circle cx="${MARKS.leftEye.x * W}" cy="${MARKS.leftEye.y * H}" r="${eyeR}" fill="none" stroke="${mark}" stroke-width="5"/>
  <circle cx="${MARKS.rightEye.x * W}" cy="${MARKS.rightEye.y * H}" r="${eyeR}" fill="none" stroke="${mark}" stroke-width="5"/>
  <line x1="${(MARKS.mouth.x - 0.09) * W}" y1="${MARKS.mouth.y * H}" x2="${(MARKS.mouth.x + 0.09) * W}" y2="${MARKS.mouth.y * H}" stroke="${mark}" stroke-width="6" stroke-linecap="round"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const WHO: Record<string, string> = {
  pirate: "a friendly cartoon pirate captain with a red bandana, a gold hoop earring and a big grin",
  astronaut: "a friendly cartoon astronaut with a round glass helmet visor face opening, the face visible inside the helmet",
  robot: "a friendly cartoon robot with a metal face, two glowing round eyes and a small antenna",
  cat: "a friendly cartoon orange tabby cat with pointed ears, whiskers and a small pink nose",
  clown: "a friendly cartoon clown with a rainbow wig, a red nose and a wide smile",
  knight: "a friendly cartoon knight in a silver helmet with a red plume, the face visible under the raised visor",
  monster: "a friendly goofy cartoon green monster with two small horns and a toothy smile",
  superhero: "a friendly cartoon superhero kid with a blue mask and a lightning bolt on the forehead",
};
function promptFor(id: string, tries: number): string {
  return `Redraw this empty template as ${WHO[id]}. The three faint grey marks on the template are placement guides: the two circles are where the centres of the two eyes go, the short line is where the middle of the mouth goes. Put each eye exactly on its circle and the mouth exactly on the line, then REMOVE the guide marks completely. The eyes are set wide apart: the left eye is centred one quarter of the picture width in from the left edge and the right eye one quarter of the width in from the right edge, so the circles are far apart and the face is wide and round. `
    + `Front view, symmetrical, the face fills the whole frame from the left edge to the right edge: the cheeks touch the left and right edges, the forehead or top of the head is cropped off the top of the picture, and the chin is cropped off the bottom of the picture just below the mouth. `
    + `Flat cartoon colours, bold dark outlines, friendly, kid-safe. Keep the same single solid plain pale background colour as the template everywhere outside the character. No text, no letters, no numbers, no logo, no watermark, no border, not a real person or likeness.${tries > 0 ? " Make the eyes large and clearly separated, and the mouth clearly visible." : ""}`;
}

async function toJpeg(png: Buffer): Promise<Buffer> {
  return sharp(png).resize(W, H, { fit: "cover", position: "centre" }).jpeg({ quality: 88 }).toBuffer();
}

interface FaceResult { id: string; file: string; jpeg: Buffer; eyes?: Pt[]; mouth?: Pt; err?: number; align?: number; log: string[]; tries: number; srcSize: string }

async function makeFace(id: string, maxTries: number): Promise<FaceResult> {
  const guide = await guideFor(id);
  writeFileSync(path.join(OUT, `guide-${id}.png`), guide);
  let best: FaceResult | undefined;
  for (let t = 0; t < maxTries; t++) {
    const log: string[] = [];
    const t0 = Date.now();
    const raw = await museEdit(guide, promptFor(id, t));
    const meta = await sharp(raw).metadata();
    const srcSize = `${meta.width}x${meta.height}`;
    const jpeg = await toJpeg(raw);
    log.push(`edit ${(Date.now() - t0) / 1000}s src ${srcSize}`);
    writeFileSync(path.join(OUT, `face-${id}-try${t}.jpg`), jpeg);
    const f = await features(jpeg, log);
    const err = f.eyes && f.mouth ? placementError(f.eyes, f.mouth) : undefined;
    const align = f.eyes && f.mouth ? alignError(f.eyes, f.mouth) : undefined;
    log.push(f.eyes && f.mouth ? `placementError ${err!.toFixed(3)} alignError ${align!.toFixed(3)} eyeSpan ${eyeSpanOf(f.eyes).toFixed(3)} (mark 0.534)` : "SAM did not find both eyes and the mouth");
    const res: FaceResult = { id, file: `face-${id}.jpg`, jpeg, eyes: f.eyes, mouth: f.mouth, err, align, log, tries: t + 1, srcSize };
    console.log(`[${id} try ${t}] ${log.join(" | ")}`);
    if (!best || (align !== undefined && (best.align === undefined || align < best.align))) best = res;
    if (align !== undefined && align <= 0.06) break;
  }
  return best!;
}

async function samOld(dir: string) {
  const ids = Object.keys(WHO);
  let eyeHits = 0, mouthHits = 0;
  const rows: string[] = [];
  for (const id of ids) {
    const jpeg = await sharp(path.join(dir, `face-${id}.jpg`)).jpeg({ quality: 88 }).toBuffer();
    const log: string[] = [];
    const f = await features(jpeg, log);
    if (f.eyes) eyeHits++;
    if (f.mouth) mouthHits++;
    rows.push(`${id}: eyes ${f.eyes ? "found" : "MISSING"}, mouth ${f.mouth ? "found" : "MISSING"} (${log.join("; ")})`);
  }
  console.log(rows.join("\n"));
  console.log(`SAM on old faces: eyes ${eyeHits}/8, mouth ${mouthHits}/8`);
}

async function main() {
  try {
    if (opt("sam-old")) { await samOld(opt("sam-old")!); return; }
    if (opt("pilot")) {
      const r = await makeFace(opt("pilot")!, Number(opt("tries") ?? 3));
      writeFileSync(path.join(OUT, `pilot-${r.id}.jpg`), r.jpeg);
      console.log(`pilot saved ${path.join(OUT, `pilot-${r.id}.jpg`)} err=${r.err?.toFixed(3)} src=${r.srcSize}`);
      return;
    }
    if (flag("all")) {
      const results: FaceResult[] = [];
      const only = opt("only")?.split(",");
      for (const id of Object.keys(WHO).filter((x) => !only || only.includes(x))) {
        try { results.push(await makeFace(id, Number(opt("tries") ?? 3))); } catch (e) {
          if (e instanceof Stop) { console.error(`STOP at ${id}: ${e.message}; keeping the faces finished so far`); break; }
          throw e;
        }
      }
      const faces = results.map((r) => ({
        id: r.id, file: r.file, width: W, height: H,
        ...(r.eyes && r.mouth ? { eyes: r.eyes.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4) })), mouth: { x: +r.mouth.x.toFixed(4), y: +r.mouth.y.toFixed(4) } } : {}),
        placementError: r.err === undefined ? null : +r.err.toFixed(4),
        alignError: r.align === undefined ? null : +r.align.toFixed(4),
        ...(r.eyes ? { eyeSpan: +eyeSpanOf(r.eyes).toFixed(4) } : {}),
      }));
      for (const r of results) {
        writeFileSync(path.join(OUT, `final-${r.id}.jpg`), r.jpeg);
        copyFileSync(path.join(OUT, `final-${r.id}.jpg`), path.join(FACES_DIR, r.file));
      }
      // keep the entries of faces that were not regenerated this run
      const jsonPath = path.join(FACES_DIR, "faces.json");
      const prev: { faces?: { id: string }[] } = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) : {};
      const merged = [...(prev.faces ?? []).filter((f) => !faces.some((n) => n.id === f.id)), ...faces]
        .sort((a, b) => Object.keys(WHO).indexOf(a.id) - Object.keys(WHO).indexOf(b.id));
      writeFileSync(jsonPath, JSON.stringify({ generator: "muse-image-1.0", samModel: "sam-3.1", targets: MARKS, faces: merged }, null, 2) + "\n");
      console.log(`wrote ${results.length} faces + faces.json`);
      return;
    }
    console.log("usage: --pilot <id> | --all | --sam-old <dir>");
  } catch (e) {
    console.error(e instanceof Stop ? `STOP: ${e.message}` : `ERROR: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    console.log(`API calls used: ${calls}/${BUDGET}`);
  }
}
void main();
