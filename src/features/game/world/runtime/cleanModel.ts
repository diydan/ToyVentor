// The cleaning level's numbers (docs/specs/play-design-spec.md, "Activity levels", activity 1). Pure: which messes there are, which tool each needs, how many and how much by age band, the soap
// step of the sticky jam, and where the messes sit. No three.js. The finger work is the shared `scrub` primitive (scrub.ts); the meshes are cleanScene.ts; the state machine is clean.ts.
//
// The concept in one sentence: the tool has to fit the mess (a vacuum for dry crumbs, a mop for a liquid, a soapy sponge for sticky jam). Nothing here can fail a child: a wrong tool is a kind line
// and the same mess, and a band can always finish.
import { clampBand, scrubBandParams, type ScrubParams, type ScrubTool } from "./scrub";

export type CleanMess = "crumbs" | "puddle" | "jam";
export const CLEAN_MESSES: readonly CleanMess[] = ["crumbs", "puddle", "jam"];

/** The tool each mess needs: the Clean mission's CFIT (tests/clean-model.test.ts keeps them equal). */
export const CLEAN_FIT: Readonly<Record<CleanMess, ScrubTool>> = { crumbs: "vacuum", puddle: "mop", jam: "sponge" };
/** The tools the level offers when the child chooses (band 2 up). */
export const CLEAN_TOOLS: readonly ScrubTool[] = ["vacuum", "mop", "sponge"];

/** How each mess looks to the scrub primitive, in world units (a phone held upright shows about 6.3 units across the lane, so a mess is about a quarter of that and three fit beside Kip). `brush` is the wipe radius at band 3; younger bands get a bigger one. */
export const CLEAN_SHAPES: Readonly<Record<CleanMess, { shape: ScrubParams["shape"]; width: number; depth: number; cells: number; brush: number }>> = {
  crumbs: { shape: "scatter", width: 1.5, depth: 0.9, cells: 40, brush: 0.26 },
  puddle: { shape: "blob", width: 1.4, depth: 0.9, cells: 48, brush: 0.28 },
  jam: { shape: "blob", width: 1.2, depth: 0.8, cells: 36, brush: 0.26 },
};

/** The soap window of the Clean mission (soapWin in world.ts: tier 1 two or three scoops, tier 2 exactly two, tier 3 exactly three). */
export const SOAP_WINDOWS: readonly [number, number][] = [[2, 3], [2, 2], [3, 3]];

export interface CleanPlan {
  band: number;
  /** The messes, in the order they are laid out left to right. */
  messes: CleanMess[];
  /** Bands 0 and 1: the right tool is already in Kip's hand, so there is nothing to choose. */
  toolInHand: boolean;
  /** Does the plan have jam, and so a soap step before the sponge works? */
  soap: boolean;
  /** Band 3 up: the number of scoops must land in this window. Null = one tap on "Mix the soap" is enough. */
  soapWindow: [number, number] | null;
}

/**
 * What a band cleans (the activity-levels band table): bands 0 and 1 one mess with the right tool in hand (it alternates crumbs and puddle, never jam), band 2 two messes with a tool to
 * choose, band 3 up all three and the soap window. `start` rotates which mess or pair comes first, so playing again is not the same game.
 */
export function cleanPlan(band: number, start = 0): CleanPlan {
  const b = clampBand(band);
  const n = Math.max(0, Math.floor(Number.isFinite(start) ? start : 0));
  if (b <= 1) {
    const one: CleanMess = n % 2 === 0 ? "crumbs" : "puddle";
    return { band: b, messes: [one], toolInHand: true, soap: false, soapWindow: null };
  }
  if (b === 2) {
    const pairs: CleanMess[][] = [["crumbs", "puddle"], ["puddle", "jam"], ["jam", "crumbs"]];
    const messes = pairs[n % pairs.length]!.slice();
    return { band: b, messes, toolInHand: false, soap: messes.includes("jam"), soapWindow: null };
  }
  return { band: b, messes: ["crumbs", "puddle", "jam"], toolInHand: false, soap: true, soapWindow: SOAP_WINDOWS[Math.min(2, b - 3)]!.slice() as [number, number] };
}

/** The scrub parameters of one mess at a band. */
export function messParams(kind: CleanMess, band: number): ScrubParams {
  const s = CLEAN_SHAPES[kind];
  return { shape: s.shape, tool: CLEAN_FIT[kind], width: s.width, depth: s.depth, cells: s.cells, ...scrubBandParams(band, s.brush) };
}

/**
 * The mercy rule (the same one the flick has): after every two soaps that were not right the window widens by one scoop each side, never below one scoop, so a child who keeps trying always
 * lands one and no band is stuck. With no window nothing changes.
 */
export function widenSoap(window: readonly [number, number] | null, misses: number): [number, number] | null {
  if (!window) return null;
  const grow = Math.max(0, Math.floor(misses / 2));
  return [Math.max(1, window[0] - grow), window[1] + grow];
}

export type SoapResult = "low" | "ok" | "high";
/** Is `scoops` of soap right for the window? (No window: any soap at all is right, one tap.) */
export function soapStep(scoops: number, window: readonly [number, number] | null): SoapResult {
  if (!window) return scoops >= 1 ? "ok" : "low";
  if (scoops < window[0]) return "low";
  if (scoops > window[1]) return "high";
  return "ok";
}

/**
 * Where mess `i` of `n` is, relative to the anchor (the middle of the row), in x and z. One mess in the middle, two side by side, three in a triangle (two behind, one in front) so the whole row is
 * about 3.5 units wide: a phone held upright shows about 6.3 across the lane, and Kip stands beside it. No two overlap: tests/clean-model.test.ts checks every pair of every plan.
 */
export function messOffset(i: number, n: number): { x: number; z: number } {
  if (n <= 1) return { x: 0, z: 0 };
  if (n === 2) return { x: i === 0 ? -1.0 : 1.0, z: 0 };
  return [{ x: -1.0, z: -0.7 }, { x: 1.0, z: -0.7 }, { x: 0, z: 0.75 }][Math.min(2, i)]!;
}
/** How far either side of its anchor the row reaches (a positive number). */
export function rowHalfWidth(messes: readonly CleanMess[]): number {
  return Math.max(...messes.map((m, i) => Math.abs(messOffset(i, messes.length).x) + CLEAN_SHAPES[m].width / 2));
}

/** The middle of the row is this far in front of Kip (Kip is a little left of the middle of the screen, the camera looking ahead of it): the row is then inside the 6.3 units a phone shows. */
export const ROW_AHEAD = 2.55;
/** The row sits this far behind Kip's own line (z), so the front mess is not under the card at the bottom of the stage. */
export const ROW_Z = -0.8;
/** At the cleaning cart Kip stands this far to the right of it, so the row is beyond the cart. */
export const CART_STAND = 1.6;
/** Seconds: Kip arrives and the mess lands (0), "Oh no, oh no!" (the second number), "Clean?" and the card (the last). */
export const CLEAN_MAKE_S = 2.2;
export const CLEAN_OHNO_AT_S = 0.7;
export const CLEAN_ASK_AT_S = 1.7;
/** Seconds of the cheer before the level is over. */
export const CLEAN_CHEER_S = 1.8;
/** A wrong-tool line is spoken at most this often (seconds); the toast is always there. */
export const WRONG_SPEAK_GAP_S = 5;
/** Scrub swish: a tone at most this often while the finger is clearing something. */
export const SWISH_GAP_S = 0.14;
