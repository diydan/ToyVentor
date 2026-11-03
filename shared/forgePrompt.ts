/**
 * The system prompts the model gets for a Recipe v1 (versions v0 to v5), one source for the eval harness (scripts/forge-eval.ts) and the
 * Worker's text-to-part route (worker/forgeMake.ts). Pure text: no DOM, no network, no clock. Moved out of the harness on 2026-11-03 with no
 * change to any word (tests/forge/forge-prompt.test.ts compares every version with the golden files in tests/forge/golden/, which were
 * captured from the harness before the move). Edit a version here and the golden file in the same change, or add a new version.
 *
 * Why each version says what it says is in the comments on its constants below and in docs/specs/forge-ai-spec.md.
 */

export const SAFETY =
  "You help a young child (ages 4 to 10) build a pretend toy. Keep it kind and safe. Never mention brands, trademarks or real-world products. Never include real names or personal details.";

const RECIPE_PROMPT_V0 = `${SAFETY}

You design ONE small printable accessory for a child's snap-together toy character or vehicle. Answer with a single JSON object (a "Recipe v1") and nothing else.

Recipe v1 fields:
- "v": 1
- "id": lowercase letters, digits and underscores
- "name": 2 to 4 friendly words
- "stat": one of "Speed", "Spin", "Torque", "Glow"
- "behavior": one short sentence
- "slot": one of crown (hat on a head), head, back, hand, front, rollbar, spoiler, hood, roof, exhaust. Use the slot you are given.
- "shape": for every slot except hand, {"kind":"loft","slices":[...]} with 3 to 12 slices from bottom to top. Each slice: {"z": height in mm (first slice z=0), "w": width mm, "d": depth mm, "r": corner radius mm, optional "x","y": offsets}. Widths and depths are between 3.6 and 90 mm. For slot hand use {"kind":"star2d","points":3-12,"outer_r_mm":10-28,"inner_r_mm":5-20} or {"kind":"profile2d","points":[[x,z],...3 to 64 points]}.
- "features": optional list of at most 6: {"op":"knob","radius_mm":1.8-6} or {"op":"brim","width_mm":16-42,"depth_mm":12-32,"thickness_mm":1.6-4}.

Printing rules (the checker rejects breaking them):
- No overhangs: going up, each slice may be at most 0.78 x its height step wider than the slice below, per side. Shrinking is always fine.
- Size: the smallest cylinder that can hold the whole part must be under 29.5 mm across, or over 36 mm across. Sizes from 31.75 to 34.9 mm are rejected.
- No brand or trademark words anywhere.

Example for slot crown:
{"v":1,"id":"wizard_hat","name":"Starlight Wizard Hat","stat":"Glow","behavior":"Tall hat that clicks onto the crown studs","slot":"crown","shape":{"kind":"loft","slices":[{"z":0,"w":23.4,"d":11.4,"r":4.6},{"z":7.5,"w":27.5,"d":17,"r":6.2,"y":-1.8},{"z":17,"w":11,"d":11,"r":4.5,"y":-0.5},{"z":23.5,"w":5.6,"d":5.6,"r":2.4,"y":1.2}]}}`;

/**
 * v1 adds the per-slot facts v0 left out. The first Spark baseline (v0) failed every head because
 * `character_head` puts the crown studs at z = height_mm (30.5) and the prompt never said so, and
 * because heads started wider than the 24.6 x 12.1 collar. Footprints are from the slot table in
 * public/kip/LLM_PART_PROMPT.md and VEHICLE_SLOTS in parts/kip/sdk/kip_partspec_sdk.py.
 * The hand paragraph is a hypothesis from the baseline failures (the daemon centres the shape's
 * bounding box on the grip, so a pole at the edge of a flag does not touch the grip neck).
 */
const SLOT_FACTS_V1 = `Slot facts (z = 0 is the bottom of your shape, sizes in mm):
- crown: sits on a head's crown studs. Slice 0 should be about 23.8 wide x 11.6 deep.
- head: sits on a neck collar 24.6 wide x 12.1 deep. Slice 0 should be about 24.6 x 12.1, then grow gradually. The head is 30.5 tall: your LAST slice must be at z = 30.5, or set "height_mm" (24 to 38) inside "shape" and end at that z. Crown studs are added on top automatically, so do not model them. Do not model eyes, mouths or noses; the front stays smooth.
- back: sits on a backpack plate 24.6 x 24.6. Slice 0 should be about that size.
- front, rollbar, spoiler: sit on a socket pad 23.8 wide x 11.6 deep. Slice 0 should be about that size.
- exhaust: sits on a socket pad 11.6 wide x 23.8 deep. Slice 0 should be about that size.
- hood, roof: sit on a socket pad 23.8 x 23.8. Slice 0 should be about that size.
- hand: a flat 2D shape on a stick that a toy hand holds. For stars and flowers use star2d (points 3 to 12, outer_r_mm 12 to 28, inner_r_mm about half of outer_r_mm). For anything else use profile2d: points [x, z] with z from 0 up, 18 to 40 tall. The shape is centred on the grip automatically, so its handle must run up the middle of the shape's width, starting at z = 0, and everything must be one connected piece. Do not put a stick at the edge of the shape (a flag pole on the left edge fails). Avoid parts thinner than 3 mm.`;

/**
 * v2 documents the feature ops the daemon gained after the first taste check (ears, horns, spikes,
 * and a brim that survives). In the v1 run Spark left "features" empty for 18 of 22 crowns and heads,
 * even for "a pirate hat with a wide brim", and Dan rated 19 of those parts 1.47 out of 5 on average:
 * hats were tapered blocks and every head was the same box. The v2 text also tells it to keep the body
 * simple and put the character in the features.
 */
const FEATURES_V2 = `- "features": optional list of at most 6 from these ops. A body shape alone is a plain block, so use them whenever the request names a part like a brim, ears, horns or points:
  - {"op":"brim","width_mm":16-42,"depth_mm":12-32,"thickness_mm":1.6-4}: a flat brim around the bottom (pirate, sun, cowboy or top hat). Keep the slices narrow and let the brim make the width.
  - {"op":"ears","style":"round"|"pointy"|"tall","width_mm":5-16,"height_mm":0-26,"tilt_deg":0-35}: a mirrored pair of flat ears on the upper corners of a head or crown. Bear = round, cat = pointy, bunny = tall.
  - {"op":"horns","length_mm":8-30,"base_mm":3-9,"curl":0-1}: a mirrored pair of curved horns on the sides of a crown or head.
  - {"op":"spikes","count":2-7,"height_mm":3-16,"base_mm":2.5-7,"center_boost_mm":0-6}: a row of points along the top of a crown or back piece (crown points, feathers).
  - {"op":"knob","radius_mm":1.8-6}: a ball on top (bobble, pompom, tassel).
Put the character in the features and keep the body simple. Give different requests different body shapes: a chef hat is wider at the top, a beanie is rounded, a top hat is a straight tube, a cone hat tapers to a point.`;

/**
 * v3 adds the head snout op and fixes what v1 and v2 told Spark about heads. v1 said "do not model noses",
 * so a dinosaur "with a long snout" could only be the same box, and v2 let it put a knob or a brim on a head
 * (both do nothing there: `character_head` clips them). In the v2 run robot, alien, astronaut, dinosaur and
 * pumpkin heads were all the same tapered box.
 */
const SNOUT_LINE_V3 = `  - {"op":"snout","style":"muzzle"|"beak"|"bill","length_mm":3-16,"width_mm":6-22,"height_mm":4-16,"z_frac":0.2-0.65}: a snout on the front of an ANIMAL head only (dog, dinosaur, bear, pig = muzzle; parrot, toucan, eagle = beak; duck = bill). z_frac is how high on the face it sits. A head with a snout needs an upright face: keep every head slice's "d" between 12 and 16 and its "y" at 0, because a head whose front leans forward cannot hold a snout (it is dropped).`;
const HEAD_NOTE_V3 = `On a head, only ears, horns and snout do anything (knob, brim and spikes are ignored there). Antennae for a robot or alien are horns with base_mm 3 and curl 0. A bear has round ears 11-14 wide. Put the character in the features`;
const HEAD_FACT_V1 = "Do not model eyes, mouths or noses; the front stays smooth.";
const HEAD_FACT_V3 =
  "Do not model eyes or mouths (decals go there). Keep the body a plain head: ears, horns and a snout are added on top of it. The face looks toward negative y, so never move head slices to positive y.";

/**
 * v4 fixes the proportions of heads. Dan, round 7: the heads "are very narrow" next to the catalog (Kip) heads. The
 * twelve catalog heads are 38 to 55 mm wide and 27 to 38 mm deep; v3 heads were 25 to 31 wide and 13 deep, because
 * v1 said "grow gradually" from the 24.6 x 12.1 collar and v3 said "keep d between 12 and 16 and y at 0" so a snout
 * could attach. The daemon now lets a head reach 20 mm behind the neck (the SDK back clip used to cut it flat at
 * +6.15) and builds a Kip-shaped head with snouts, so both rules go. The profile below is measured from
 * toyventor_char_head_kid_S.stl (slices at z = 0, 5, 10, 15, 20, 25, 30).
 */
const KID_HEAD_V4 = `{"slices":[{"z":0,"w":26,"d":12.7,"r":5},{"z":5,"w":28.6,"d":17.6,"r":6,"y":-0.3},{"z":10,"w":33.5,"d":23.6,"r":8},{"z":15,"w":38.1,"d":25.7,"r":9,"y":-0.5},{"z":20,"w":34.8,"d":27.1,"r":9,"y":-1},{"z":25,"w":33.9,"d":25.5,"r":8,"y":-1.2},{"z":30.5,"w":30.7,"d":17.8,"r":6,"y":-0.5}]}`;
/**
 * v5 adds round crowns. Dan, round 2, on "a crown with five points": "does not look like a crown at all, crowns should
 * be round". The body is one convex hull, so points on it were a bumpy cone. The daemon's `spikes` op now has a ring
 * layout (points round the rim of a round body, top hollowed out) and there is a `hollow` op for cup hats.
 */
const CROWN_RING_V5 = `
  - {"op":"spikes","layout":"ring","count":4-12,"height_mm":4-16}: with layout "ring" the crown's top becomes a ring and its rim a zigzag of wide triangular points, like a drawn crown (a king's, queen's or princess's crown, a tiara). Use it for anything called a crown. A round crown body has w = d = 26 from about z = 9.5 up (it can only grow slowly from the 23.8 x 11.6 pad), for example {"slices":[{"z":0,"w":23.8,"d":11.6,"r":4},{"z":9.5,"w":26,"d":26,"r":12.4},{"z":14,"w":26,"d":26,"r":12.4}]} with 5 to 8 points 8 to 10 mm high. Use the plain spikes row only for a row of feathers.
  - {"op":"star","size_mm":6-16,"thickness_mm":1.6-3.6}: one five-point star standing on the very top of a crown. Use it whenever the request names a star or stars (a wizard hat gets one on its tip).
  - {"op":"hollow","wall_mm":1.6-4,"depth_mm":2-20}: hollows the top of a crown into an open cup. Only for a bowl, pot, basket or cup hat; never for a helmet, dome or hat that is closed on top.
  - {"op":"ribs","count":6-12,"width_mm":2-6,"depth_mm":0.8-3.5}: on a HEAD only, vertical grooves down the sides, leaving the front smooth, for a pumpkin, melon, beehive or acorn. A pumpkin head is a wide, squat, round body (about 44 wide and 30 deep) with ribs count 8, width_mm 5, depth_mm 3.
  - {"op":"brow","width_mm":10-26,"thickness_mm":1.5-5,"height_mm":3-8,"z_frac":0.5-0.9}: on a HEAD only, a heavy ridge across the front above the eyes, for a gorilla, troll, ogre, caveman or a grumpy or angry character. thickness_mm is how far it stands out of the face. Typical: width_mm 20, thickness_mm 3.5, height_mm 6, z_frac 0.75. If the head also has a snout, keep the snout low and short (z_frac 0.3, length_mm 6-8) so the brow shows above it. A troll, ogre or goblin ALSO needs big pointy ears (style "pointy", width_mm 11, height_mm 18, tilt_deg 20) so it is not a bare box. A gorilla gets small round ears on the sides (width_mm 9-10, z_frac 0.55-0.6), a big brow (width_mm 24-26, thickness_mm 5, height_mm 7-8, z_frac 0.7) and NO snout: on this head a gorilla muzzle comes out as a tall column and looks bad.`;
const EARS_LINE_V2 = `  - {"op":"ears","style":"round"|"pointy"|"tall","width_mm":5-16,"height_mm":0-26,"tilt_deg":0-35}: a mirrored pair of flat ears on the upper corners of a head or crown. Bear = round, cat = pointy, bunny = tall.`;
const EARS_LINE_V5 = `  - {"op":"ears","style":"round"|"pointy"|"tall","width_mm":5-24,"height_mm":0-26,"tilt_deg":0-35,"z_frac":0.3-0.9}: a mirrored pair of flat ears on a head or crown. z_frac (heads only) is how far up the head they sit: leave it out for the top corners, 0.5 to 0.7 puts them on the sides. Pick the style from the animal: "round" for a bear, panda, tiger or lion (width 10-13, at the top corners), for a monkey (width 13-15, z_frac 0.55-0.65 on the sides) and for an elephant (width 15-18, z_frac 0.5-0.6, big flaps); "pointy" for a fox, cat, fennec, corgi or devil (height 14-22, a pig or panda's short triangles are height about equal to width, 8-10); "tall" for a bunny (height 15-22).`;
const HEAD_NOTE_V5 = `On a head, only ears, horns, snout, brow and ribs do anything (knob, brim and spikes are ignored there). Antennae for a robot or alien are horns with base_mm 6 and curl 0 (thinner ones break). A bear has round ears 11-14 wide. Put the character in the features`;
const HEAD_GROW_V1 = "Slice 0 should be about 24.6 x 12.1, then grow gradually.";
const HEAD_GROW_V4 = `Slice 0 should be about 24.6 x 12.1 (the collar). Heads are BIG and ROUND, like the toy's own heads: 38 to 55 mm wide and 26 to 38 mm deep at their widest, so widen quickly (each slice may be 0.78 x its height step wider per side) to your widest slice at z 14 to 20, hold it, then taper at the top. Sizes from 31.75 to 34.9 mm are rejected, so make the widest slice at least 38 mm wide; a wider, deeper head is better than a slim one. A standard kid head: ${KID_HEAD_V4}. Make a bear, alien or monster head wider (45 to 55) and deeper, a chibi or robot head about 40 wide. The face looks toward negative y: use "y" offsets of about -1 to -2 at the widest slices.`;
/**
 * v5 gives Spark a library of real head shapes instead of the single kid profile. Dan, 2026-11-03: "all the heads are too
 * basic, I'd like more variety", and his hearted Sketchfab picks were round, squat heads with distinct ears (side-mounted round, big flaps, large pointed, short triangles). The profiles are measured from the toy's own heads
 * (public/kip/partspec/toyventor_*head*_S.stl) with the ears left out, and fitted to the 0.78 per mm growth limit.
 */
const HEAD_LIBRARY_V5 = [
  ["kid", "[[0,26,12.7,5],[5,28.7,18,6],[10,33.7,23.6,8],[15,38,25.9,9],[20,34.7,27.2,9],[25,33.7,25,8],[30.5,31,18.4,6]]", "a plain round head"],
  ["chibi", "[[0,26,12.7,5],[5,27.7,18.3,6],[10,31.1,24.1,8],[15,39.5,26.9,9],[20,36.7,28,9],[25,35.9,25.3,8],[30.5,33.9,18.5,6]]", "wide cheeks and a wide top, a baby look"],
  ["round_cheeky", "[[0,26,12.7,5],[5,33.7,20,7],[10,40.6,27.8,10],[15,44.2,34.5,12],[20,45.7,36.8,12],[25,42,33,10],[30.5,36,24,8]]", "bear, panda, monkey, tiger, lion"],
  ["wedge", "[[0,26,12.7,5],[5,34.4,20.4,7],[10,41.9,28.2,10],[15,46.9,35,12],[20,44.5,35.9,12],[25,40,29,9],[30.5,34,20,7]]", "fox, cat, dog: wide low, narrower on top"],
  ["big_forehead", "[[0,25.9,12.6,5],[5,28.8,17.1,6],[10,34.4,23.7,8],[15,40.8,30.7,10],[20,48.2,34.9,12],[25,51.7,33,12],[30.5,50,24.2,9]]", "alien, imp: widest at the top"],
  ["robot", "[[0,26.4,12.3,5],[5,32.1,16.8,6],[10,38.9,25.6,6],[15,42.6,31.2,6],[20,46.2,32.2,6],[25,47.2,33.6,6],[30.5,46.3,25.1,6]]", "boxy with a flat top"],
  ["pumpkin", "[[0,26,12.7,5],[5,33,21,8],[10,41,29,12],[15,48,34,14],[20,48,34,13],[26,38,24,9]] with height_mm 26", "squat and round"],
] as const;
const HEAD_GROW_V5 = `Slice 0 should be about 24.6 x 12.1 (the collar). Heads are BIG and ROUND, like the toy's own heads: 38 to 55 mm wide and 26 to 38 mm deep at their widest, so widen quickly (each slice may be 0.78 x its height step wider per side) to your widest slice at z 14 to 25, hold it, then taper at the top. Sizes from 31.75 to 34.9 mm are rejected, so make the widest slice at least 38 mm wide; a wider, deeper head is better than a slim one. Start from the closest of these real head shapes (each slice is [z, w, d, r]; the face looks toward negative y, so add "y" -1 to -2 at the widest slices) and change it to suit the request: ${HEAD_LIBRARY_V5.map(([n, sl, use]) => `${n} (${use}): ${sl}`).join("; ")}. Different requests should get different shapes: do not give every head the same one.`;
const HEAD_FACT_V4 =
  "Do not model eyes or mouths (decals go there). Keep the body a plain head: ears, horns and a snout are added on top of it.";
const SNOUT_LINE_V4 = SNOUT_LINE_V3.replace(
  `A head with a snout needs an upright face: keep every head slice's "d" between 12 and 16 and its "y" at 0, because a head whose front leans forward cannot hold a snout (it is dropped).`,
  `A snout needs a front that is not leaning far forward: the front edge (y minus d/2) may move forward by at most about 0.5 mm per mm of height, as in the kid head below, or the snout is dropped.`,
);

function replaceOnce(text: string, from: string, to: string, what: string): string {
  if (!text.includes(from)) throw new Error(`v3 prompt: ${what} moved`);
  return text.replace(from, to);
}

const FEATURES_V0_LINE = `- "features": optional list of at most 6: {"op":"knob","radius_mm":1.8-6} or {"op":"brim","width_mm":16-42,"depth_mm":12-32,"thickness_mm":1.6-4}.`;

export type PromptVersion = "v0" | "v1" | "v2" | "v3" | "v4" | "v5";

export function systemPromptFor(version: PromptVersion): string {
  if (version === "v0") return RECIPE_PROMPT_V0;
  if (version === "v1") return `${RECIPE_PROMPT_V0}\n\n${SLOT_FACTS_V1}`;
  if (!RECIPE_PROMPT_V0.includes(FEATURES_V0_LINE)) throw new Error("v2 prompt: the v0 features line moved");
  const withV2 = RECIPE_PROMPT_V0.replace(FEATURES_V0_LINE, FEATURES_V2);
  if (version === "v2") return `${withV2}\n\n${SLOT_FACTS_V1}`;
  const v4plus = version === "v4" || version === "v5";
  const snoutLine = v4plus ? SNOUT_LINE_V4 : SNOUT_LINE_V3;
  if (v4plus && snoutLine === SNOUT_LINE_V3) throw new Error("v4 prompt: the v3 snout line moved");
  const featuresV2 =
    version === "v5"
      ? replaceOnce(
          replaceOnce(FEATURES_V2, '  - {"op":"knob"', `${CROWN_RING_V5.trimStart().replace(/^/, "  ")}\n  - {"op":"knob"`, "the knob line (v5 ring)"),
          EARS_LINE_V2,
          EARS_LINE_V5,
          "the ears line",
        )
      : FEATURES_V2;
  const features = replaceOnce(
    replaceOnce(featuresV2, '  - {"op":"knob"', `${snoutLine}\n  - {"op":"knob"`, "the knob line"),
    "Put the character in the features",
    version === "v5" ? HEAD_NOTE_V5 : HEAD_NOTE_V3,
    "the features closing note",
  );
  let facts = replaceOnce(SLOT_FACTS_V1, HEAD_FACT_V1, v4plus ? HEAD_FACT_V4 : HEAD_FACT_V3, "the head slot fact");
  if (v4plus) facts = replaceOnce(facts, HEAD_GROW_V1, version === "v5" ? HEAD_GROW_V5 : HEAD_GROW_V4, "the head growth sentence");
  return `${RECIPE_PROMPT_V0.replace(FEATURES_V0_LINE, features)}\n\n${facts}`;
}
