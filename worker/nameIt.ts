// POST /api/scan with { nameIt: { imageDataUrl } }: what is in this photo? Used by the camera pick-up (parts/kip/viewer/kip-pickup.js) when a child points the camera at something
// and presses the shutter without saying what it is. It asks Scan Assist (worker/meta.ts `inspectPhotoNouns`, the hosted vision model) for the main thing in the picture,
// keeps only names that are an object a child could hold, and answers up to three, best first. The client then runs the ordinary scan with the first one.
//
//   reply { ok: true, names: string[], checked: boolean, configured: boolean }   names is empty when nothing usable was found or the helper is off
//
// The photo is sent to the hosted model here, as it is for the scan itself (Meta's hosted terms are for adults: the demo is adult-operated, a child's version uses the self-hosted
// model, docs/decisions/0008). Nothing is stored or logged but the count of names. The names come from a model, so they are screened like every other model word a child sees:
// no people, body parts or surfaces (not what is being held), nothing the kid-safe lists refuse, one or two plain words.
import { inspectPhotoNouns, samConfigured, type MetaEnv } from "./meta";
import { kidSafeText } from "./muse";

/** Things in a photo that are not "the thing held up": people, parts of them, and what it lies on. */
export const NOT_HELD = new Set([
  "person", "people", "man", "woman", "boy", "girl", "child", "kid", "baby", "human", "adult", "face", "head", "hair", "hand", "hands", "finger", "fingers", "thumb", "arm", "arms",
  "table", "desk", "floor", "wall", "ceiling", "room", "background", "surface", "counter", "countertop", "carpet", "rug", "tablecloth", "ground", "grass", "sky", "table top", "tabletop",
]);
const MAX_NAMES = 3;

/** The names a child can be told: lowercase, one or two words, not a person or a surface, nothing the kid-safe lists refuse, no duplicates, at most three. Never throws. */
export function safeObjectNames(nouns: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(nouns) ? nouns : []) {
    if (typeof raw !== "string") continue;
    const noun = raw.trim().toLowerCase().replace(/\s+/g, " ");
    const words = noun.split(" ");
    if (!/^[a-z][a-z ]{1,29}$/.test(noun) || words.length > 2) continue;
    if (NOT_HELD.has(noun) || NOT_HELD.has(words[words.length - 1]!)) continue; // the head noun is the last word: "wooden table" is a table, "table lamp" is a lamp
    if (!kidSafeText(noun)) continue;
    if (!out.includes(noun)) out.push(noun);
    if (out.length >= MAX_NAMES) break;
  }
  return out;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function handleNameIt(nameIt: unknown, env: MetaEnv): Promise<Response> {
  const image = nameIt && typeof nameIt === "object" ? (nameIt as { imageDataUrl?: unknown }).imageDataUrl : undefined;
  if (typeof image !== "string" || !image.startsWith("data:image/")) return json({ error: "invalid scan request" }, 422);
  const configured = samConfigured(env);
  const inspected = await inspectPhotoNouns(env, image, undefined, { focus: true });
  const names = inspected.checked ? safeObjectNames(inspected.nouns) : [];
  console.log(JSON.stringify({ event: "name_it", checked: inspected.checked, names: names.length })); // the count only: never the names, never the photo
  return json({ ok: true, names, checked: inspected.checked, configured });
}
