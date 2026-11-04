// What an activity level needs from the game, and what it offers back (docs/specs/play-design-spec.md, "Activity levels": the contract). One adapter for every activity, so the cleaning level
// and the cooking level (and the next ones) are written against the same small surface, and tests can stand in a fake world. world.ts builds the adapter once, beside `MESS`.
import type * as THREE from "three";
import type { Visit } from "./visitRoutine";
import type { PropInst } from "./propReactions";
import type { Timers } from "./activityPrompt";

/** The tools and utensils Kip can hold for an activity (heldItems.ts keeps the meshes). */
export type ActivityHeld = "vacuum" | "mop" | "sponge" | "spatula";
/** The character clips an activity plays (proceduralClips.ts; no new ones were needed, see the activity-levels spec "Built" note). */
export type ActivityClip = "oops" | "mop" | "tidy" | "cheer";

/** The parts of a PointerEvent an activity reads. */
export interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
}

export interface ActivityWorld {
  /** Where the activity's meshes live (the world's root, so a world change takes them away). */
  root(): THREE.Object3D;
  /** The stage's element, for the prompt card (null while there is none). */
  host(): HTMLElement | null;
  /** The player asked for less motion. */
  reduced(): boolean;
  /** Say one of the closed-list lines with the game's voice (a no-op when muted or offline). */
  say(text: string): void;
  /** Show a line as text (the toast): the twin of every spoken line. */
  toast(text: string): void;
  tone(freq: number, delay: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void;
  /** Play a character clip; false if it cannot (reduced motion, not loaded). */
  clip(action: ActivityClip): boolean;
  hold(item: ActivityHeld): void;
  release(): void;
  /** Start a visit on the toy: false (and nothing happens) if one is already under way or an act is not allowed now. */
  run(visit: Visit): boolean;
  /** Where the toy stands. */
  kip(): { x: number; z: number };
  /** The age band 0 to 5 the grown-up set (src/lib/age.ts); unset reads as 0. */
  band(): number;
  /** The floor (y = 0) under a screen point, or null if the point looks at the sky. */
  floorAt(clientX: number, clientY: number): { x: number; z: number } | null;
  /** The first of these meshes (or their children) under a screen point: the object in the list that owns it, or null. */
  pick(clientX: number, clientY: number, objects: readonly THREE.Object3D[]): THREE.Object3D | null;
  /** Where a world point lands on the screen, in client pixels (the dev handle and the e2e use it to put real mouse events on the right spot). */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  /** Something else (the Toy Room mess, another activity) is under way: an activity does not start. */
  busy(): boolean;
  /** The Map door: the rung is won (the world pays the stars and XP through its own path). Absent: the prop door. */
  rungWin?(): void;
  timers?: Timers;
}

export type ActivityId = "clean" | "cook";

export interface ActivitySnapshot {
  id: ActivityId;
  phase: string;
  band: number;
  source: "prop" | "rung" | null;
  promptIds: readonly string[];
  /** Everything else that matters to a test, as plain data. */
  detail: Record<string, unknown>;
}

export interface Activity {
  readonly id: ActivityId;
  /** Anything but idle. */
  readonly active: boolean;
  readonly phase: string;
  readonly promptVisible: boolean;
  /** The Toy Room door: the visit a tap on the prop starts, or null when something is under way or the prop is not ours. */
  visitFor(inst: PropInst): Visit | null;
  /** The Map door: begin where the toy stands. False if it cannot start now (the caller may try again). */
  startRung(): boolean;
  /** Pointer routing, called from the world's canvas handlers: true means the activity used the event and nothing else should. */
  down(e: PointerLike): boolean;
  move(e: PointerLike): boolean;
  up(e: PointerLike): boolean;
  cancel(): void;
  /** A button on the card was pressed (also what the tests and the switch form call). */
  press(id: string): void;
  update(dt: number): void;
  /** A world change or a new toy: everything put right, the card and the meshes gone. */
  reset(): void;
  snapshot(): ActivitySnapshot;
}
