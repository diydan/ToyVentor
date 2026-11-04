// The bench: where a "put this part in that slot" mission is played (Dan, 2026-11-04: the half-screen mission card hid the very machine the child was building, so "controls in the world").
//
// The Gear lift and the Bridge (the two classic slot missions, `MDEF` in catalog.ts) no longer open a card. While Kip is near the machine, each slot is a round pad floating where its part goes; tap
// an empty pad and a small picker opens under it with the parts you can put there; tap a full pad to take the part out. The action ("Turn crank", "Test it") is one gold pill by the machine, and
// "Forge parts" a small one under it. Everything the child has to look at (the tower, the gears, Kip) stays on screen, so the whole bench is a handful of small glass pieces, not a panel.
//
// This file is only the pieces and where they sit: no game logic. `show` takes what the slots are (`benchSpecFromControls` reads the mission's own control list, so the card and the bench can never
// disagree about what is allowed) and where in the world each piece hangs; `place` (called every frame by the world) projects those points to the screen and clamps them inside it. The caller answers
// `onUse` / `onOut` / `onGo` / `onForge` through the same `mpPress` path the card's buttons used. Made when first shown, inside the stage's own element, styled inline (like activityPrompt.ts).

export const BENCH_TEST_ID = "mission-bench";
/** Every button is at least this tall, in CSS px (the pads are round and this wide). */
export const BENCH_MIN_PX = 48;

export interface BenchChoice {
  /** The part's key (`sgear`). */
  key: string;
  label: string;
  disabled: boolean;
}
export interface BenchSlot {
  id: string;
  name: string;
  /** The name of the part in the slot, or null when it is empty. */
  filled: string | null;
  choices: BenchChoice[];
}
export interface BenchSpec {
  slots: BenchSlot[];
  goLabel: string;
  forgeAvailable: boolean;
}
/** A world point; the bench shows a piece where this lands on the screen. */
export type WorldPoint = readonly [number, number, number];
export interface BenchLayout {
  slots: Record<string, WorldPoint>;
  /** The action pill; "Forge parts" hangs under it. */
  go: WorldPoint;
}

/** The control shape the mission data builds (missionData.ts `MpCtrl`), only the parts the bench reads. */
export interface BenchControl {
  label: string;
  disabled: boolean;
  dataset: Record<string, string>;
  group?: string;
}

/** The slots of a classic mission, read from its own control list: `use` controls are the choices of an empty slot, an `out` control marks a full one. Slot order is the list's order. */
export function benchSpecFromControls(ctrls: readonly BenchControl[], goLabel: string, forgeAvailable: boolean): BenchSpec {
  const slots: BenchSlot[] = [];
  const slot = (id: string, group: string | undefined): BenchSlot => {
    let s = slots.find((x) => x.id === id);
    if (!s) {
      const [name = id, status] = (group ?? id).split(" · ");
      s = { id, name, filled: status && status !== "empty" ? status : null, choices: [] };
      slots.push(s);
    }
    return s;
  };
  for (const c of ctrls) {
    const use = c.dataset.use;
    const out = c.dataset.out;
    if (use) {
      const [id = "", key = ""] = use.split(":");
      if (id && key) slot(id, c.group).choices.push({ key, label: c.label, disabled: c.disabled });
    } else if (out) {
      const s = slot(out, c.group);
      if (!s.filled) s.filled = (c.group ?? "").split(" · ")[1] ?? "part";
    }
  }
  return { slots, goLabel, forgeAvailable };
}

export interface BenchDeps {
  /** The stage's element, or null while there is none (then nothing is shown). */
  host(): HTMLElement | null;
  /** A world point as a position inside the host (px from its top left), or null when it is behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  onUse(slot: string, key: string): void;
  onOut(slot: string): void;
  onGo(): void;
  onForge(): void;
  reduced?(): boolean;
}

export interface MissionBench {
  /** Show (or refresh) the bench for the mission `key`; the picker stays open only while its slot is still empty. */
  show(key: string, spec: BenchSpec, layout: BenchLayout): void;
  hide(): void;
  /** Re-project every piece (the world calls this each frame). */
  place(): void;
  /** Hidden while the mission plays its own animation, shown again after; the pieces are kept. */
  setVisible(v: boolean): void;
  readonly active: boolean;
  readonly key: string | null;
  /** The ids of the buttons now shown, in order (for tests and the dev handle). */
  readonly ids: readonly string[];
  dispose(): void;
}

const GLASS = "background:rgba(16,26,68,.66);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#f6f1ff";
const FONT = "font:800 14px var(--fb,system-ui,sans-serif)";
const BTN = `min-height:${BENCH_MIN_PX}px;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none;${FONT}`;
const PAD_CSS = `${BTN};position:relative;width:${BENCH_MIN_PX + 8}px;height:${BENCH_MIN_PX + 8}px;border-radius:50%;padding:0;${GLASS};border:3px dashed rgba(255,255,255,.85);display:flex;align-items:center;justify-content:center;flex-direction:column;line-height:1.05;font-size:13px`;
const PAD_FULL_CSS = "border:3px solid var(--gold,#ffd24d);background:rgba(54,40,6,.72);color:#fff3b0";
const PICK_CSS = `position:absolute;left:50%;top:calc(100% + 8px);transform:translateX(-50%);display:flex;gap:6px;padding:6px;border-radius:18px;${GLASS};border:2px solid rgba(255,255,255,.5);z-index:2;box-shadow:0 8px 22px rgba(2,6,28,.45)`;
const CHOICE_CSS = `${BTN};min-width:82px;padding:0 12px;border-radius:14px;border:2px solid rgba(255,255,255,.7);background:var(--sky,#52b7ff);color:#06122b;white-space:nowrap`;
const GO_CSS = `${BTN};min-height:52px;min-width:128px;padding:0 20px;border-radius:999px;border:3px solid rgba(255,255,255,.9);background:var(--gold,#ffd24d);color:#2b1d00;font-size:16px;box-shadow:0 6px 16px rgba(2,6,28,.4);white-space:nowrap`;
const FORGE_CSS = `${BTN};min-height:40px;padding:0 14px;border-radius:999px;border:2px solid rgba(255,255,255,.7);${GLASS};font-size:13px;white-space:nowrap`;
const NAME_CSS = `position:absolute;left:50%;bottom:calc(100% + 3px);transform:translateX(-50%);white-space:nowrap;padding:1px 8px;border-radius:999px;background:rgba(16,26,68,.55);color:#f6f1ff;font:800 11px var(--fb,system-ui,sans-serif);pointer-events:none`;
/** How far in from the stage's edges a piece's centre may go, so a pad is never cut off or under the Kip button's corner. */
const EDGE_X = 46;
const EDGE_TOP = 62;
const EDGE_BOTTOM = 40;

interface Piece {
  el: HTMLElement;
  at: WorldPoint;
  /** Half the piece's width: how far in from the edge its centre must stay so none of it is cut off. */
  half: number;
}

export function createMissionBench(deps: BenchDeps): MissionBench {
  let root: HTMLElement | null = null;
  let pieces: Piece[] = [];
  let shownKey: string | null = null;
  let visible = true;
  let ids: string[] = [];
  /** The slot whose picker is open. */
  let picking: string | null = null;
  let last: { spec: BenchSpec; layout: BenchLayout } | null = null;

  function ensureRoot(): HTMLElement | null {
    const host = deps.host();
    if (!host) return null;
    if (root && root.parentElement === host) return root;
    root?.remove();
    const doc = host.ownerDocument;
    root = doc.createElement("div");
    root.setAttribute("data-testid", BENCH_TEST_ID);
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Build here");
    root.style.cssText = "position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:7;overflow:hidden";
    host.appendChild(root);
    return root;
  }

  function anchor(el: HTMLElement): HTMLElement {
    // a zero-size box at the projected point; its child is centred on it
    el.style.position = "absolute";
    el.style.left = "0";
    el.style.top = "0";
    el.style.pointerEvents = "none";
    el.style.willChange = "transform";
    return el;
  }

  function button(doc: Document, id: string, label: string, css: string, aria: string, onClick: () => void): HTMLButtonElement {
    const b = doc.createElement("button");
    b.type = "button";
    b.setAttribute("data-testid", `${BENCH_TEST_ID}-${id}`);
    b.setAttribute("aria-label", aria);
    b.style.cssText = `${css};pointer-events:auto`;
    b.textContent = label;
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    ids.push(id);
    return b;
  }

  function build() {
    const r = ensureRoot();
    if (!r || !last) return;
    const doc = r.ownerDocument;
    r.replaceChildren();
    pieces = [];
    ids = [];
    const { spec, layout } = last;
    if (picking && !spec.slots.some((s) => s.id === picking && !s.filled)) picking = null;

    for (const s of spec.slots) {
      const at = layout.slots[s.id];
      if (!at) continue;
      const a = anchor(doc.createElement("div"));
      const holder = doc.createElement("div");
      holder.style.cssText = "position:absolute;left:0;top:0;transform:translate(-50%,-50%);pointer-events:none";
      const name = doc.createElement("span");
      name.style.cssText = NAME_CSS;
      name.textContent = s.name;
      holder.append(name);
      let pickEl: HTMLElement | null = null;
      if (s.filled) {
        const pad = button(doc, `out-${s.id}`, "", `${PAD_CSS};${PAD_FULL_CSS}`, `Take out the ${s.filled} from the ${s.name} slot`, () => deps.onOut(s.id));
        const w = doc.createElement("span");
        w.textContent = s.filled.replace(/ gear$/i, "");
        const x = doc.createElement("span");
        x.textContent = "✕";
        x.style.cssText = "font-size:11px;opacity:.85";
        pad.append(w, x);
        holder.append(pad);
      } else {
        const open = picking === s.id;
        const pad = button(doc, `pad-${s.id}`, open ? "–" : "+", `${PAD_CSS};font-size:26px`, `Put a part in the ${s.name} slot`, () => { picking = picking === s.id ? null : s.id; build(); place(); });
        pad.setAttribute("aria-expanded", String(open));
        holder.append(pad);
        if (open) {
          const pick = doc.createElement("div");
          pick.setAttribute("role", "group");
          pick.setAttribute("aria-label", `Parts for the ${s.name} slot`);
          pick.style.cssText = `${PICK_CSS};pointer-events:auto`;
          for (const c of s.choices) {
            const cb = button(doc, `use-${s.id}-${c.key}`, c.label, CHOICE_CSS, c.label, () => { picking = null; deps.onUse(s.id, c.key); });
            if (c.disabled) { cb.disabled = true; cb.style.opacity = "0.45"; }
            pick.append(cb);
          }
          holder.append(pick);
          pickEl = pick;
        }
      }
      if (picking === s.id) a.style.zIndex = "3";          // an open picker is above every other piece
      a.append(holder);
      r.append(a);
      pieces.push({ el: a, at, half: Math.max(EDGE_X, holder.offsetWidth / 2 + 8, (pickEl ? pickEl.offsetWidth : 0) / 2 + 8) });
    }

    const go = anchor(doc.createElement("div"));
    const goHolder = doc.createElement("div");
    goHolder.style.cssText = "position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none";
    goHolder.append(button(doc, "go", spec.goLabel, GO_CSS, spec.goLabel, () => deps.onGo()));
    if (spec.forgeAvailable) goHolder.append(button(doc, "forge", "Forge parts", FORGE_CSS, "Forge parts", () => deps.onForge()));
    if (picking) goHolder.style.visibility = "hidden";          // the open picker has the floor; the action comes back when it closes
    go.append(goHolder);
    r.append(go);
    pieces.push({ el: go, at: layout.go, half: Math.max(EDGE_X, goHolder.offsetWidth / 2 + 8) });
    r.style.display = visible ? "" : "none";
  }

  function place() {
    if (!root || !last || !visible) return;
    const host = root.parentElement;
    if (!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    for (const p of pieces) {
      const s = deps.project(p.at[0], p.at[1], p.at[2]);
      if (!s) { p.el.style.display = "none"; continue; }
      p.el.style.display = "";
      const x = Math.min(w - p.half, Math.max(p.half, s.x));
      const y = Math.min(h - EDGE_BOTTOM, Math.max(EDGE_TOP, s.y));
      p.el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    }
  }

  function hide() {
    root?.replaceChildren();
    root?.remove();
    root = null;
    pieces = [];
    ids = [];
    shownKey = null;
    picking = null;
    last = null;
  }

  return {
    show(key, spec, layout) {
      if (shownKey !== key) picking = null;
      shownKey = key;
      last = { spec, layout };
      build();
      place();
    },
    hide,
    place,
    setVisible(v) {
      visible = v;
      if (root) root.style.display = v ? "" : "none";
      if (v) place();
    },
    get active() { return shownKey !== null; },
    get key() { return shownKey; },
    get ids() { return ids; },
    dispose: hide,
  };
}
