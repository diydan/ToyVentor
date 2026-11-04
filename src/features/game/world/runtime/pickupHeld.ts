// What Kip picked up with the camera, shown on the GAME's Kip (docs/product/close-out-checklist.md, section 1, row 3, scope C).
//
// The Kip bench (public/kip, its Tools > Pick it up) announces a pick-up with `window` event "tv:kip-picked-up" (`detail` is a PickupInfo, below): the word the child
// said, what Kip took (one of the bench's workshop props, or a household library item), and the object cut out of the camera frame as a small transparent PNG. The game's Kip is
// a different rig from the bench's (it is built from primitives in playerRig.ts), so it cannot take the bench's prop: it holds
//   - a mesh the game already has, where the bench prop has a twin (guitar, mop, the two vacuums, the scrub brush, the spatula); otherwise
//   - a flat CARD: the cut-out itself on a double-sided plane in the right hand, with a thin white edge, kept upright and facing the camera when Kip turns or the arm swings.
// So a photographed spoon, trumpet or frying pan shows in the game as the child's own cut-out.
//
// It does not use the single `HELD` slot that the Toy Room acts share (heldItems.ts): it wraps that slot's `hold` and `release` instead. When an act takes Kip's hands the pick-up steps
// aside (it is only taken off the arm, not forgotten); when the act lets go (and when a world switch clears the slot) it comes back. Putting it away is the child's choice: tap Kip, or
// the chip. A vehicle has no arms, so the item waits (and comes back with the character). In memory only: no storage, no network; the card's texture is let go when it is put away.
import { T } from "./worldScene";
import { HELD as HELD_SPECS, followHandsMesh, placeHeldMesh, type Held, type HeldItem } from "./heldItems";
import type * as THREE from "three";

export interface PickupCutout {
  dataUrl: string;
  w: number;
  h: number;
}
export interface PickupInfo {
  word: string;
  /** 'workshop' and 'library' name something the bench has; 'card' is an object it had neither for (the cut-out held as a flat card, which is what the game does with a library item too). */
  kind: "workshop" | "library" | "card";
  id: string;
  label: string;
  coloured: boolean;
  colours: string[];
  cutout: PickupCutout | null;
}

const PNG_PREFIX = "data:image/png;base64,";
/** A 256 px cut-out is about 100 kB of base64; this leaves room and still stops anything that is not one. */
const MAX_DATA_URL = 700_000;
const MAX_SIDE = 300;
const ID_RE = /^[a-z][a-z0-9_]{0,40}$/;
const COLOUR_RE = /^[a-z]{3,10}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** A word or label that is safe to show: letters, digits, spaces, apostrophes and hyphens, at most `max` characters. */
export function cleanLabel(s: unknown, max = 40): string {
  return typeof s === "string" ? s.replace(/[^\p{L}\p{N} '-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** The event's `detail`, checked field by field: a PickupInfo, or null when it is not one. Never throws. */
export function parsePickup(raw: unknown): PickupInfo | null {
  try {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (r.kind !== "workshop" && r.kind !== "library" && r.kind !== "card") return null;
    // a workshop prop and a library item are named by their id; a card has none worth keeping (an empty or odd one becomes "")
    const id = typeof r.id === "string" && ID_RE.test(r.id) ? r.id : "";
    if (!id && r.kind !== "card") return null;
    const label = cleanLabel(r.label) || cleanLabel(r.word);
    if (!label) return null;
    const colours = (Array.isArray(r.colours) ? r.colours : []).filter((c): c is string => typeof c === "string" && COLOUR_RE.test(c)).slice(0, 2);
    let cutout: PickupCutout | null = null;
    const c = r.cutout as Record<string, unknown> | null | undefined;
    if (c && typeof c === "object") {
      const { dataUrl, w, h } = c;
      if (
        typeof dataUrl === "string" && dataUrl.startsWith(PNG_PREFIX) && dataUrl.length <= MAX_DATA_URL && BASE64_RE.test(dataUrl.slice(PNG_PREFIX.length)) &&
        Number.isInteger(w) && Number.isInteger(h) && (w as number) >= 1 && (h as number) >= 1 && (w as number) <= MAX_SIDE && (h as number) <= MAX_SIDE
      ) cutout = { dataUrl, w: w as number, h: h as number };
    }
    return { word: cleanLabel(r.word) || label, kind: r.kind, id, label, coloured: r.coloured === true, colours, cutout }; // `named` (the helper named it) and any other field are ignored
  } catch {
    return null;
  }
}

/** The bench's workshop props that the game has its own mesh for. Everything else becomes a card. */
const GAME_TWINS: ReadonlyMap<string, HeldItem> = new Map<string, HeldItem>([
  ["guitar", "guitar"],
  ["mop", "mop"],
  ["vacuum", "vacuum"],
  ["upright_vacuum", "vacuum"],
  ["scrub_brush", "sponge"],
  ["spatula", "spatula"],
]);

/** The game's own mesh for a pick-up, or null (then it is shown as a card). Only workshop props have twins; a household item never does. */
export function heldItemFor(info: Pick<PickupInfo, "kind" | "id">): HeldItem | null {
  return info.kind === "workshop" ? GAME_TWINS.get(info.id) ?? null : null;
}

/** How big the card is, in the game's units (Kip is about 2.2 tall): the long side is `long`, the short side keeps the picture's shape and is grown towards `minShort` when it would be a sliver (but the long side never passes CARD_MAX_LONG). */
export const CARD_LONG = 1.15;
export const CARD_MIN_SHORT = 0.16;
export const CARD_MAX_LONG = 1.6;
export function cardSize(w: number, h: number, long = CARD_LONG, minShort = CARD_MIN_SHORT): { width: number; height: number } {
  const ww = Number.isFinite(w) && w > 0 ? w : 1;
  const hh = Number.isFinite(h) && h > 0 ? h : 1;
  let k = long / Math.max(ww, hh);
  const short = Math.min(ww, hh) * k;
  if (short < minShort) k *= Math.min(minShort / short, CARD_MAX_LONG / long); // a very thin thing is a little bigger, never huge
  return { width: ww * k, height: hh * k };
}

/** Where the card hangs: at the hand (in the arm's own frame) for its x and y, and a fixed CARD_FRONT in front of Kip's BODY (towards the camera, in the world) for its depth. The right arm is on the camera side when Kip faces right and on the far side when he faces left (the arm sits 0.33 either side of the body), so a depth taken from the arm hid the card inside him. */
export const CARD_HAND: readonly [number, number, number] = [0, -0.42, 0];
/** ... and when what carries it is the FIST's grip anchor (rig.grips: its origin is the fist) rather than the arm holder, the card hangs right there. */
export const CARD_FIST: readonly [number, number, number] = [0, 0, 0];
export const CARD_FRONT = 0.62;
/** The plain sticker (no cut-out) is smaller than a real cut-out: it is only a label. */
export const STICKER_LONG = 0.75;

/**
 * Where the card goes in the arm's own frame: the hand's world x and y, and the world depth `bodyZ + CARD_FRONT` (see CARD_FRONT). `parentWorld` is the arm's world matrix (its rotation, scale and
 * position, whatever Kip is doing), `bodyZ` the body's world z. Writes and returns `out`.
 */
export function cardLocalPosition(parentWorld: THREE.Matrix4, bodyZ: number, out: THREE.Vector3, hand: readonly [number, number, number] = CARD_HAND): THREE.Vector3 {
  out.set(hand[0], hand[1], hand[2]).applyMatrix4(parentWorld);
  out.z = bodyZ + CARD_FRONT;
  return out.applyMatrix4(new T.Matrix4().copy(parentWorld).invert());
}

/** The chip's words. */
export const putAwayLabel = (label: string): string => `Put the ${label.toLowerCase()} away`;

export interface RigParts {
  /** The body group (a held guitar or mop hangs from it). */
  model: THREE.Object3D;
  /** The right arm, then the left; a vehicle has none. */
  armR?: THREE.Object3D | null;
  armL?: THREE.Object3D | null;
}
export interface PickupHeldOptions {
  /** The Toy Room acts' single held slot: wrapped, so the pick-up steps aside while an act has Kip's hands. */
  held: Held;
  /** Kip's rig right now (it is rebuilt when the toy changes), or null before there is one. */
  rig: () => RigParts | null;
  /** The player's root group, for "tap Kip to put it away". */
  playerRoot?: () => THREE.Object3D | null;
  /** Where the "Put it away" chip is added (the world's host element). No host, no chip. */
  host?: HTMLElement | null;
  toast?: (text: string) => void;
  reduced?: () => boolean;
}

interface Wanted {
  info: PickupInfo;
  item: HeldItem | null;
  card: { group: THREE.Group; texture: THREE.Texture; geometry: THREE.BufferGeometry; material: THREE.Material } | null;
  bornMs: number;
  /** A belt tool or toy that is simply in the hand (`take`): no "put it away" chip, and a tap on Kip leaves it be. */
  quiet?: boolean;
}

/** The cut-out on a canvas with a thin white edge all round (the silhouette drawn in a ring of offsets, then the picture on top), or a plain sticker with the word when there is none. */
function cardCanvas(doc: Document, img: HTMLImageElement | null, info: PickupInfo): HTMLCanvasElement {
  const pad = 4;
  const c = doc.createElement("canvas");
  if (!img) {
    c.width = c.height = 160;
    const x = c.getContext("2d")!;
    x.fillStyle = "#fff";
    x.beginPath();
    x.roundRect(4, 4, 152, 152, 28);
    x.fill();
    x.fillStyle = "#ffd24d";
    x.beginPath();
    x.roundRect(12, 12, 136, 136, 22);
    x.fill();
    x.fillStyle = "#1b2238";
    x.font = "800 30px system-ui, sans-serif";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(info.label.split(" ")[0]!.slice(0, 12), 80, 80, 124); // the first word, squeezed to fit
    return c;
  }
  c.width = img.naturalWidth + pad * 2;
  c.height = img.naturalHeight + pad * 2;
  const x = c.getContext("2d")!;
  const sil = doc.createElement("canvas");
  sil.width = c.width;
  sil.height = c.height;
  const sx = sil.getContext("2d")!;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    sx.drawImage(img, pad + Math.cos(a) * pad, pad + Math.sin(a) * pad);
  }
  sx.globalCompositeOperation = "source-in";
  sx.fillStyle = "#fff";
  sx.fillRect(0, 0, sil.width, sil.height);
  x.drawImage(sil, 0, 0);
  x.drawImage(img, pad, pad);
  return c;
}

function loadImage(doc: Document, src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = doc.createElement("img");
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function createPickupHeld(opts: PickupHeldOptions) {
  const { held } = opts;
  const doc: Document | null = opts.host?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  let wanted: Wanted | null = null;
  /** What Kip holds when the camera has brought nothing: the tool or toy picked on the belt (`take`). A pick-up takes the hand first, and the belt's item comes back when it is put away. */
  let base: Wanted | null = null;
  let mounted: THREE.Object3D[] | null = null;
  /** Which of `wanted` and `base` the meshes on the arm belong to (a different one means they are replaced). */
  let mountedFor: Wanted | null = null;
  const current = (): Wanted | null => wanted ?? base;
  /** False while the belt's tool is away working on a fit (a copy of it flies to the fit, world.ts `toolAnim`): the one in the hand is hidden, and back when it returns. */
  let beltShown = true;
  let chip: HTMLButtonElement | null = null;
  let loadId = 0;
  let disposed = false;
  const q = new T.Quaternion();
  const inv = new T.Quaternion();
  const off = new T.Vector3();
  const bodyPos = new T.Vector3();

  // ---- the chip ---------------------------------------------------------------------------------------------------------------------
  function showChip(on: boolean): void {
    if (!opts.host || !doc) return;
    if (!on) { if (chip) chip.hidden = true; return; }
    if (!chip) {
      chip = doc.createElement("button");
      chip.type = "button";
      chip.className = "tv-pickup-chip";
      chip.style.cssText = "position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 150px);z-index:12;min-height:44px;padding:0 16px;border-radius:999px;border:0;background:rgba(251,249,245,.95);color:#1b2238;font:700 14px/1.1 system-ui,-apple-system,sans-serif;box-shadow:0 8px 22px rgba(27,34,56,.35);cursor:pointer;width:max-content;max-width:92%";
      chip.addEventListener("click", (e) => { e.stopPropagation(); putAway(true); });
      chip.addEventListener("pointerdown", (e) => e.stopPropagation()); // a press on the chip is not a tap on the world
      opts.host.append(chip);
    }
    chip.textContent = `✋ ${putAwayLabel(wanted?.info.label ?? "item")}`;
    chip.setAttribute("aria-label", putAwayLabel(wanted?.info.label ?? "item"));
    chip.hidden = false;
  }

  // ---- on and off Kip's arm -----------------------------------------------------------------------------------------------------------
  /** Take it off the arm (it is still wanted). The meshes the game builds are let go like the acts' ones; the card's own pieces stay for the next time. */
  function detach(): void {
    if (mounted) for (const m of mounted) m.parent?.remove(m);
    mounted = null;
    mountedFor = null;
    showChip(false);
  }

  /** Set the card's orientation and position for this instant: world-aligned (upright, facing the camera, never mirrored) and held in front of the body. Called when it goes on and every frame. */
  function place(g: THREE.Group, model: THREE.Object3D): void {
    const parent = g.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    parent.getWorldQuaternion(q);
    g.quaternion.copy(inv.copy(q).invert());
    model.getWorldPosition(bodyPos);
    g.position.copy(cardLocalPosition(parent.matrixWorld, bodyPos.z, off, parent.userData.grip ? CARD_FIST : CARD_HAND));
  }

  /** Put it on Kip if there is something to put on, an arm to put it on and nothing else in Kip's hands. True when it is on. */
  function carry(): boolean {
    const w = current();
    if (!w || disposed) return false;
    if (held.item !== null) return false; // an act has Kip's hands
    const rig = opts.rig();
    if (!rig || !rig.armR) return false; // no rig yet, or a vehicle (no arms): it waits, and comes back with the character
    if (w.item) {
      const spec = HELD_SPECS[w.item];
      const parents = spec.parent === "arms" ? [rig.armR, rig.armL] : [spec.parent === "armR" ? rig.armR : rig.model];
      if (parents.some((p) => !p)) return false;
      if (mountedFor === w && mounted && mounted.length === parents.length && mounted.every((m, i) => m.parent === parents[i])) return true;
      detach();
      mounted = parents.map((p) => {
        const mesh = spec.build();
        placeHeldMesh(mesh, spec, p!);                                  // the same placement as the acts' items: in the fist (a grip) or at the end of the arm holder
        p!.add(mesh);
        return mesh;
      });
      mountedFor = w;
      if (w === base) for (const m of mounted) m.visible = beltShown;
      showChip(!w.quiet);
      return true;
    }
    if (w.card) {
      const arm = rig.armR;
      if (!arm) return false;
      if (mountedFor === w && mounted && mounted[0]!.parent === arm) return true;
      detach();
      const g = w.card.group;
      g.scale.setScalar(opts.reduced?.() ? 1 : 0.01); // it pops in (tick grows it)
      w.bornMs = nowMs();
      arm.add(g);
      place(g, rig.model); // right now, so not even one frame shows it unturned
      mounted = [g];
      mountedFor = w;
      showChip(!w.quiet);
      return true;
    }
    return false; // a cut-out that is still loading
  }

  const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

  function freeCard(w: Wanted | null): void {
    if (!w?.card) return;
    w.card.group.parent?.remove(w.card.group);
    w.card.texture.dispose();
    w.card.geometry.dispose();
    w.card.material.dispose();
    w.card = null;
  }

  /** Let it go for good: off the arm, the card's texture, geometry and material disposed, the chip hidden. */
  function putAway(announce = false): void {
    const label = wanted?.info.label;
    loadId++;
    detach();
    freeCard(wanted);
    wanted = null;
    carry(); // the belt's tool or toy, if one is picked, comes back to the hand
    if (announce && label) opts.toast?.(`${label} put away.`);
  }

  // ---- wrapping the acts' slot -----------------------------------------------------------------------------------------------------------
  const origHold = held.hold;
  const origRelease = held.release;
  held.hold = ((...a: Parameters<Held["hold"]>) => {
    detach(); // an act takes Kip's hands: the pick-up steps aside
    return origHold.apply(held, a);
  }) as Held["hold"];
  held.release = (() => {
    origRelease.call(held);
    carry(); // hands free again (an act ended, or a world switch cleared the slot): it comes back
  }) as Held["release"];

  return {
    /** Kip takes what the bench picked up. Resolves true when there is something to hold (a card may still be loading). Replaces whatever was held before. */
    async pick(info: PickupInfo): Promise<boolean> {
      if (disposed) return false;
      putAway();
      const id = ++loadId;
      const item = heldItemFor(info);
      wanted = { info, item, card: null, bornMs: 0 };
      if (item) { carry(); return true; }
      if (!doc) return false;
      const img = info.cutout ? await loadImage(doc, info.cutout.dataUrl) : null;
      if (disposed || id !== loadId || !wanted) return false; // something newer came in, or it was put away while loading
      const canvas = cardCanvas(doc, img, info);
      const size = cardSize(canvas.width, canvas.height, img ? CARD_LONG : STICKER_LONG, img ? CARD_MIN_SHORT : 0);
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      texture.anisotropy = 4;
      const geometry = new T.PlaneGeometry(size.width, size.height);
      geometry.translate(0, size.height * 0.38, 0); // the hand holds it a little above its foot
      const material = new T.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.35, side: T.DoubleSide });
      const mesh = new T.Mesh(geometry, material);
      mesh.name = "pickup-card";
      mesh.renderOrder = 3;
      const group = new T.Group();
      group.name = "pickup-held";
      group.add(mesh);
      wanted.card = { group, texture, geometry, material };
      carry();
      return true;
    },
    putAway: () => putAway(false),
    /**
     * The belt's pick: Kip holds `item` (a belt tool, or a toy such as the guitar) until another is picked or `null` is passed. It is the hand's second choice: a camera pick-up replaces it while
     * it lasts, an act takes the hands from it and gives them back, and there is no chip for it. Passing the item that is already held changes nothing.
     */
    take(item: HeldItem | null, label = ""): void {
      if (disposed) return;
      if (base && base.item === item) return;
      const old = base;
      base = item ? { info: { word: label || item, kind: "workshop", id: item, label: label || item, coloured: false, colours: [], cutout: null }, item, card: null, bornMs: 0, quiet: true } : null;
      if (old && mountedFor === old) detach();
      carry();
    },
    /** Tap on Kip: when the ray hits the player while something is held, put it away. True when it did (the tap is used up). */
    tap(ray: THREE.Raycaster): boolean {
      if (!mounted || !wanted) return false;   // (a belt tool is not put away by a tap on Kip: the belt changes it)
      const root = opts.playerRoot?.();
      if (!root) return false;
      if (ray.intersectObject(root, true).length === 0) return false;
      putAway(true);
      return true;
    },
    /** Every frame, just before drawing: put it back on a rebuilt arm, grow the pop-in, and keep a card upright and facing the camera. */
    tick(): void {
      const w = current();
      if (!w || disposed) return;
      carry(); // cheap and idempotent: puts it back on a rebuilt rig or after a vehicle turns back into a character
      if (w.item && mounted) { const r = opts.rig(); if (r) followHandsMesh(mounted[0]!, HELD_SPECS[w.item], r.model, [r.armL, r.armR]); }   // a tool or a book keeps its handle in the hands
      const card = w.card;
      if (!card || !mounted) return;
      const g = card.group;
      const model = opts.rig()?.model;
      if (g.parent && model) place(g, model);
      const age = (nowMs() - w.bornMs) / 240;
      if (age < 1) {
        const e = 1 - Math.pow(1 - Math.max(0.01, age), 3);
        g.scale.setScalar(Math.max(0.01, e * (1 + 0.12 * Math.sin(Math.PI * Math.min(1, age)))));
      } else if (g.scale.x !== 1) g.scale.setScalar(1);
    },
    /** What is wanted and whether it is on Kip, for tests and the page. */
    get state() {
      return { wanted: wanted ? { id: wanted.info.id, kind: wanted.info.kind, label: wanted.info.label, item: wanted.item, card: Boolean(wanted.card) } : null, onKip: Boolean(mounted), chipShowing: Boolean(chip && !chip.hidden) };
    },
    /** Hide (false) or show (true) the belt's tool in the hand while a copy of it is away working on a fit. Safe whatever is held; the setting is remembered for the next time it is put on the arm. */
    beltVisible(on: boolean): void {
      beltShown = on;
      if (mounted && mountedFor === base) for (const m of mounted) m.visible = on;
    },
    /** What the belt has Kip holding (a tool or a toy), or null. For tests and the page. */
    get belt(): HeldItem | null { return base ? base.item : null; },
    /** The card group while it is on Kip, for tests. */
    get cardGroup(): THREE.Group | null { return wanted?.card && mounted ? wanted.card.group : null; },
    dispose(): void {
      if (disposed) return;
      base = null;                      // nothing may come back after this
      putAway();
      disposed = true;
      held.hold = origHold;
      held.release = origRelease;
      chip?.remove();
      chip = null;
    },
  };
}

export type PickupHeld = ReturnType<typeof createPickupHeld>;
