// The card an activity level asks its next step on (docs/specs/play-design-spec.md, "Activity levels": Prompt row). One small card over the stage with a line of words and a row of real
// <button>s, each at least 56 px tall with an accessible name, in a labelled group, so it can be tapped, tabbed to and pressed from the keyboard; it says the same words the voice says, so a muted
// game loses nothing. Made when first shown, inside the stage's own element (so a world change or a teardown takes it away with the stage) and styled inline (no stylesheet, no change to the
// stage's). It is the cleaning level's tool row and the cooking level's one step at a time; messPrompt.ts is the older one-button version for the Toy Room mess.
//
// A button with `hold` is the grown-up's "it's hot" (Dan, 2026-11-04, Q2): pressing it does nothing until it has been held HOLD_MS, a ring fills while it is held, and letting go early only empties the
// ring. There is no PIN and no sum on purpose: the point is "hot things are a grown-up job", not a lock. The keyboard does the same with Space or Enter held down.
//
// No game logic: `onPress(id)` is called when a button is pressed (or, for a hold button, held long enough); what it means, and showing and hiding, is the caller's.

export const PROMPT_MIN_HEIGHT_PX = 60;
/** The gear's hold (the grown-ups' gear in the corner asks for the same), in milliseconds. */
export const HOLD_MS = 1200;
export const ACTIVITY_PROMPT_TEST_ID = "activity-prompt";

export interface PromptButton {
  id: string;
  label: string;
  /** What a screen reader says; defaults to the label. */
  aria?: string;
  /** Needs HOLD_MS of holding. */
  hold?: boolean;
  /** Draw the eye to it (the right tool after a wrong one). */
  pulse?: boolean;
  /** The one chosen of a row (the tool in hand). */
  selected?: boolean;
}

export interface PromptSpec {
  /** The words (the question or the instruction): the same ones the voice says, or a text-only hint. */
  line: string;
  buttons: readonly PromptButton[];
  /** The card's accessible name. */
  group: string;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ActivityPromptDeps {
  /** The stage's element, or null while there is none (then nothing is shown). */
  host(): HTMLElement | null;
  onPress(id: string): void;
  /** Default: the page's own timers. */
  timers?: Timers;
  /** Reduced motion: no pulse, and the hold ring jumps instead of sweeping. */
  reduced?(): boolean;
}

export interface ActivityPrompt {
  show(spec: PromptSpec): void;
  hide(): void;
  readonly visible: boolean;
  /** The ids of the buttons now shown, in order (for tests and the dev handle). */
  readonly ids: readonly string[];
  /** Remove the card from the page for good (a world change, a teardown). */
  dispose(): void;
}

const CARD_CSS = [
  // centred with auto margins and a content width (left:50% would shrink the card to half the stage and stack every button in a column)
  "position:absolute", "left:0", "right:0", "margin:0 auto", "width:max-content", "bottom:calc(env(safe-area-inset-bottom,0px) + 176px)", "z-index:6",
  "display:flex", "flex-direction:column", "align-items:center", "gap:6px", "max-width:calc(100% - 20px)", "box-sizing:border-box", "padding:8px 10px 10px", "border-radius:26px",
  "background:rgba(36,22,84,.94)", "color:#f6f1ff", "border:2px solid rgba(255,255,255,.3)", "box-shadow:0 10px 28px rgba(2,6,28,.55)",
  "font:800 17px var(--fd,system-ui,sans-serif)", "text-align:center",
].join(";");
const ROW_CSS = ["display:flex", "flex-wrap:wrap", "justify-content:center", "gap:8px"].join(";");
/** Four buttons are ONE row on a 390 px phone only when each is tight (measured in the browser 2026-11-04: at the roomy size three tools plus "Clean it" wrapped to two rows and the card's top edge sat on the front mess). Still 56 px tall. */
const ROW_TIGHT_CSS = ["display:flex", "flex-wrap:nowrap", "justify-content:center", "gap:5px"].join(";");
const TIGHT_BUTTON_CSS = "min-width:56px;padding:0 9px;border-width:2px;font-size:15px";
const BUTTON_CSS = [
  `min-height:${PROMPT_MIN_HEIGHT_PX}px`, "min-width:88px", "padding:0 14px", "border-radius:999px", "border:3px solid rgba(255,255,255,.85)", "position:relative", "overflow:hidden",
  "background:var(--gold,#ffd24d)", "color:#2b1d00", "font:800 16px var(--fd,system-ui,sans-serif)", "cursor:pointer", "touch-action:manipulation", "-webkit-user-select:none", "user-select:none",
].join(";");

export function createActivityPrompt(deps: ActivityPromptDeps): ActivityPrompt {
  const timers: Timers = deps.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  let card: HTMLElement | null = null;
  let shown = false;
  let ids: string[] = [];
  /** The hold in progress, if any. */
  let holding: { id: string; handle: unknown; ring: HTMLElement } | null = null;

  function stopHold() {
    if (!holding) return;
    timers.clear(holding.handle);
    holding.ring.style.transition = "none";
    holding.ring.style.width = "0%";
    holding = null;
  }

  function makeButton(doc: Document, b: PromptButton, tight = false): HTMLButtonElement {
    const el = doc.createElement("button");
    el.type = "button";
    el.setAttribute("data-testid", `${ACTIVITY_PROMPT_TEST_ID}-${b.id}`);
    el.setAttribute("aria-label", b.aria ?? b.label);
    if (b.selected) el.setAttribute("aria-pressed", "true");
    el.style.cssText = BUTTON_CSS + (tight ? `;${TIGHT_BUTTON_CSS}` : "") + (b.selected ? ";outline:4px solid #fff;outline-offset:2px" : "") + (b.pulse && !deps.reduced?.() ? ";animation:none;box-shadow:0 0 0 6px rgba(255,255,255,.55)" : "");
    const text = doc.createElement("span");
    text.textContent = b.label;
    text.style.cssText = "position:relative;z-index:1";
    if (!b.hold) {
      el.append(text);
      el.addEventListener("click", () => { deps.onPress(b.id); });
      return el;
    }
    // the hold button: a ring (a bar filling from the left behind the words) shows how long to go
    const ring = doc.createElement("span");
    ring.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:0%;background:rgba(43,29,0,.28);z-index:0";
    el.append(ring, text);
    const begin = () => {
      if (holding) return;
      ring.style.transition = deps.reduced?.() ? "none" : `width ${HOLD_MS}ms linear`;
      ring.style.width = "100%";
      holding = {
        id: b.id, ring,
        handle: timers.set(() => { holding = null; ring.style.transition = "none"; ring.style.width = "0%"; deps.onPress(b.id); }, HOLD_MS),
      };
    };
    el.addEventListener("pointerdown", begin);
    for (const t of ["pointerup", "pointerleave", "pointercancel", "blur"]) el.addEventListener(t, stopHold);
    el.addEventListener("keydown", (e: Event) => { const k = (e as KeyboardEvent).key; if ((k === " " || k === "Enter") && !(e as KeyboardEvent).repeat) { e.preventDefault(); begin(); } });
    el.addEventListener("keyup", (e: Event) => { const k = (e as KeyboardEvent).key; if (k === " " || k === "Enter") stopHold(); });
    // a bare click (no press first) never counts: the point is the hold
    el.addEventListener("click", (e: Event) => { e.preventDefault(); });
    return el;
  }

  function build(host: HTMLElement, spec: PromptSpec): HTMLElement {
    const doc = host.ownerDocument;
    const el = doc.createElement("div");
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", spec.group);
    el.setAttribute("data-testid", ACTIVITY_PROMPT_TEST_ID);
    el.style.cssText = CARD_CSS;
    const line = doc.createElement("div");
    line.setAttribute("data-testid", `${ACTIVITY_PROMPT_TEST_ID}-line`);
    line.setAttribute("aria-live", "polite");
    line.textContent = spec.line;
    const row = doc.createElement("div");
    const tight = spec.buttons.length >= 4;
    row.style.cssText = tight ? ROW_TIGHT_CSS : ROW_CSS;
    for (const b of spec.buttons) row.append(makeButton(doc, b, tight));
    el.append(line, row);
    host.appendChild(el);
    return el;
  }

  return {
    show(spec) {
      const host = deps.host();
      if (!host) return;
      stopHold();
      card?.remove();
      card = build(host, spec);
      ids = spec.buttons.map((b) => b.id);
      shown = true;
    },
    hide() {
      stopHold();
      shown = false;
      if (card) { card.hidden = true; card.style.display = "none"; }
    },
    get visible() { return shown; },
    get ids() { return shown ? ids : []; },
    dispose() {
      stopHold();
      shown = false;
      card?.remove();
      card = null;
      ids = [];
    },
  };
}
