// Hand-authored clips for the outdoor things to do (docs/specs/playful-interactions-spec.md section 6): a snow angel, pouring from a watering can, picking and smelling flowers, offering a carrot,
// eating a sandwich sitting down, and sitting on a swing. Authored exactly like proceduralClips.ts (keyframes baked into the Mixamo clip format) and added to the same driver bank, so they blend like any
// other clip. Limbs are body-local unit vectors (rest is straight down), body and head Euler angles in radians (see proceduralClips.ts for the frame); a lying pose is authored at `gainFor`(real angle).
import { bake, gainFor, type Key } from "./proceduralClips";
import type { BakedClip, ClipBank } from "./mixamo";

type V3 = readonly [number, number, number];
const REST_ARM: V3 = [0, -1, 0];
const PI = Math.PI;

export const PLAY_ACTIONS = ["angel", "pour", "pick", "smell", "offer", "sit_eat", "swing"] as const;
export type PlayAction = (typeof PLAY_ACTIONS)[number];

/** The snow angel: lying on the back (the same pose as `sleep`), the arms and legs sweep out and in, ANGEL_SWEEPS times, one every ANGEL_SWEEP_S. */
export const ANGEL_S = 3.8;
export const ANGEL_SWEEPS = 3;
export const ANGEL_SWEEP_S = 0.9;
export const ANGEL_START_S = 0.5;
/** Pouring: the right arm lifts the can out in front (POUR_START_S), holds it tipped, and lowers it again at POUR_END_S. */
export const POUR_S = 3.0;
export const POUR_START_S = 0.55;
export const POUR_END_S = 2.45;
/** Picking flowers: bends down and the hand closes on them at PICK_GRAB_S. */
export const PICK_S = 1.7;
export const PICK_GRAB_S = 0.75;
/** Smelling the bouquet: the hand brings it up to the face, a deep sniff (SMELL_SNIFF_S), a happy sigh. */
export const SMELL_S = 2.3;
export const SMELL_SNIFF_S = 1.0;
/** Offering a carrot to the bunny: crouches and holds it out; the bunny takes it at OFFER_TAKE_S. */
export const OFFER_S = 2.7;
export const OFFER_TAKE_S = 1.1;
/** Eating a sandwich sitting down: one bite at each of these (seconds). */
export const BITES_S: readonly number[] = [1.1, 2.3, 3.5];
export const SIT_EAT_S = 4.7;
/** Sitting on a swing, the legs pumping. */
export const SWING_S = 5.2;

/** Sitting down with the legs out in front: the hips drop and the legs point forward. Used under the picnic and the swing. */
const SIT = { hips: [0, -0.4, 0.05] as V3, legL: [0.1, -0.12, 0.99] as V3, legR: [-0.1, -0.12, 0.99] as V3 };
const HAND_TO_MOUTH: V3 = [-0.2, 0.5, 0.85];

const angelKeys: Key[] = [];
const LIE = { body: [-gainFor(PI / 2), 0, 0] as V3, head: [0, 0, 0] as V3, hips: [0, 0.08, 0.5] as V3 };
angelKeys.push({ t: 0, ...LIE, armL: [0.12, -1, 0.04], armR: [-0.12, -1, 0.04], legL: [0.04, -1, 0], legR: [-0.04, -1, 0] });
for (let i = 0; i < ANGEL_SWEEPS; i++) {
  const t = ANGEL_START_S + i * ANGEL_SWEEP_S;
  angelKeys.push({ t, armL: [0.75, 0.62, 0.05], armR: [-0.75, 0.62, 0.05], legL: [0.5, -0.86, 0], legR: [-0.5, -0.86, 0] });              // up and out: arms over the head, legs apart
  angelKeys.push({ t: t + ANGEL_SWEEP_S / 2, armL: [0.2, -1, 0.04], armR: [-0.2, -1, 0.04], legL: [0.06, -1, 0], legR: [-0.06, -1, 0] });  // and back to the sides
}
angelKeys.push({ t: ANGEL_S, armL: [0.12, -1, 0.04], armR: [-0.12, -1, 0.04], legL: [0.04, -1, 0], legR: [-0.04, -1, 0] });

const biteKeys: Key[] = BITES_S.flatMap((t): Key[] => [
  { t: t - 0.35, armR: HAND_TO_MOUTH, head: [0.1, 0, 0] },
  { t: t - 0.05, head: [0.3, 0, 0] }, { t: t + 0.15, head: [0.1, 0, 0] }, { t: t + 0.35, head: [0.3, 0, 0] },
  { t: t + 0.65, armR: [-0.3, -0.5, 0.75], head: [0.02, 0, 0] },
]);

export const PLAY_CLIPS: ClipBank = {
  // Snow angel, 3.8 s.
  angel: bake("angel", ANGEL_S, false, angelKeys, { followBody: true }),
  // Pour from a watering can held in the right hand: the arm comes up and out, the body leans in, a small tremble while it pours, then the arm comes down. 3 s.
  pour: bake("pour", POUR_S, false, [
    { t: 0 },
    { t: POUR_START_S, armR: [-0.12, 0.1, 0.99], armL: [0.3, -0.7, 0.4], body: [0.14, 0, 0], head: [0.14, 0, 0] },
    { t: 1.1, armR: [-0.14, 0.02, 0.99] }, { t: 1.5, armR: [-0.1, 0.1, 0.99] }, { t: 1.9, armR: [-0.14, 0.02, 0.99] },
    { t: POUR_END_S, armR: [-0.12, 0.08, 0.99] },
    { t: POUR_S, armR: REST_ARM, armL: REST_ARM, body: [0, 0, 0], head: [0, 0, 0] },
  ]),
  // Bend down and pick flowers: lean forward, the right hand reaches down and closes on the stems at PICK_GRAB_S, then straighten up with them. 1.7 s.
  pick: bake("pick", PICK_S, false, [
    { t: 0 },
    { t: 0.45, body: [0.5, 0, 0], head: [0.15, 0, 0], armR: [-0.2, -0.45, 0.85], armL: [0.3, -0.7, 0.5], hips: [0, -0.06, 0.12] },
    { t: PICK_GRAB_S, armR: [-0.18, -0.4, 0.88] },
    { t: 1.2, body: [0.15, 0, 0], head: [0, 0, 0], armR: [-0.2, 0.0, 0.98], armL: REST_ARM, hips: [0, 0, 0] },
    { t: PICK_S, body: [0, 0, 0], armR: [-0.3, 0.2, 0.9] },
  ]),
  // Smell the bouquet: it comes up to the face, the head tips down into it, a deep sniff (the chest rises), then a happy sway. 2.3 s.
  smell: bake("smell", SMELL_S, false, [
    { t: 0, armR: [-0.3, 0.2, 0.9] },
    { t: 0.5, armR: [-0.15, 0.55, 0.82], head: [0.25, 0, 0], body: [0.05, 0, 0] },
    { t: SMELL_SNIFF_S, head: [0.32, 0, 0], body: [-0.04, 0, 0], hips: [0, 0.03, 0] },
    { t: 1.4, head: [0.2, 0, 0.1], body: [0.04, 0, 0.06], hips: [0, 0, 0] },
    { t: 1.8, head: [0.2, 0, -0.1], body: [0.04, 0, -0.06] },
    { t: SMELL_S, armR: REST_ARM, head: [0, 0, 0], body: [0, 0, 0] },
  ]),
  // Offer a carrot: crouch and lean forward, the right hand out low in front (the bunny takes it at OFFER_TAKE_S), the head following the bunny, then a pleased wiggle and up again. 2.7 s.
  offer: bake("offer", OFFER_S, false, [
    { t: 0 },
    { t: 0.55, armR: [-0.12, -0.55, 0.83], armL: [0.3, -0.75, 0.45], body: [0.32, 0, 0], head: [0.25, 0, 0], hips: [0, -0.12, 0.1] },
    { t: OFFER_TAKE_S, armR: [-0.12, -0.5, 0.86] },
    { t: 1.5, armR: [-0.2, -0.65, 0.73], head: [0.22, 0, 0.06], hips: [0, -0.1, 0.1] },
    { t: 1.9, head: [0.25, 0, -0.06], body: [0.3, 0, 0] },
    { t: OFFER_S, armR: REST_ARM, armL: REST_ARM, body: [0, 0, 0], head: [0, 0, 0], hips: [0, 0, 0] },
  ]),
  // Sit on the blanket with the legs out in front and eat a sandwich (a bite at each of BITES_S: the hand to the mouth, three chews, the hand down). 4.7 s.
  sit_eat: bake("sit_eat", SIT_EAT_S, false, [
    { t: 0 },
    { t: 0.5, ...SIT, armL: [0.4, -0.55, 0.4], armR: [-0.3, -0.5, 0.75], body: [0.03, 0, 0] },
    ...biteKeys,
    { t: 4.2, armR: [-0.3, -0.5, 0.5], head: [0, 0, 0] },
    { t: SIT_EAT_S, armL: REST_ARM, armR: REST_ARM, body: [0, 0, 0], head: [0, 0, 0], hips: [0, 0, 0], legL: REST_ARM, legR: REST_ARM },
  ]),
  // Ride the swing: sit with the legs out and pump them (back, forward, back...), the hands holding the ropes, the body leaning with each push. 5.2 s.
  swing: bake("swing", SWING_S, false, [
    { t: 0 },
    { t: 0.5, ...SIT, armL: [0.3, 0.45, 0.4], armR: [-0.3, 0.45, 0.4], body: [-0.03, 0, 0] },
    ...Array.from({ length: 8 }, (_, i): Key => ({ t: 0.9 + i * 0.5, legL: i % 2 ? [0.1, -0.12, 0.99] : [0.1, -0.6, 0.6], legR: i % 2 ? [-0.1, -0.12, 0.99] : [-0.1, -0.6, 0.6], body: [i % 2 ? -0.1 : 0.06, 0, 0], head: [i % 2 ? -0.08 : 0.04, 0, 0] })),
    { t: SWING_S, armL: REST_ARM, armR: REST_ARM, body: [0, 0, 0], head: [0, 0, 0], hips: [0, 0, 0], legL: REST_ARM, legR: REST_ARM },
  ]),
};

export type { BakedClip };
