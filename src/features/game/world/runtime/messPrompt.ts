// "Clean?" and its one big button (docs/specs/playful-interactions-spec.md, "Spill and clean up"; Dan, 2026-11-03: "Followed by clean? Clean"). A small card over the stage, made when it is first
// shown, that asks the question in words and answers with one button, "Clean", at least 56 px tall. It is a real <button> in a labelled group, so it can be tapped, tabbed to and pressed with
// the keyboard, and it says the same words the voice says, so a muted game loses nothing. It is created inside the stage's own element (so a world change or a teardown takes it away with
// the stage) and styled inline, so it needs no stylesheet and no change to the stage's.
//
// No game logic: `onClean` is called when the button is pressed; hiding and showing is the caller's.
import { CLEAN_BUTTON, CLEAN_Q } from "./messLines";

export const PROMPT_MIN_HEIGHT_PX = 60;
export const PROMPT_TEST_ID = "mess-prompt";

export interface MessPromptDeps {
  /** The stage's element, or null while there is none (then nothing is shown). */
  host(): HTMLElement | null;
  /** The button was pressed. */
  onClean(): void;
}

export interface MessPrompt {
  show(): void;
  hide(): void;
  readonly visible: boolean;
  /** Remove the card from the page for good (a world change, a teardown). */
  dispose(): void;
}

const CARD_CSS = [
  "position:absolute", "left:50%", "bottom:calc(env(safe-area-inset-bottom,0px) + 176px)", "transform:translateX(-50%)", "z-index:6",
  "display:flex", "align-items:center", "gap:12px", "padding:8px 10px 8px 18px", "border-radius:999px",
  "background:rgba(36,22,84,.94)", "color:#f6f1ff", "border:2px solid rgba(255,255,255,.3)", "box-shadow:0 10px 28px rgba(2,6,28,.55)",
  "font:800 20px var(--fd,system-ui,sans-serif)", "white-space:nowrap",
].join(";");
const BUTTON_CSS = [
  `min-height:${PROMPT_MIN_HEIGHT_PX}px`, "min-width:132px", "padding:0 22px", "border-radius:999px", "border:3px solid rgba(255,255,255,.85)",
  "background:var(--gold,#ffd24d)", "color:#2b1d00", "font:800 20px var(--fd,system-ui,sans-serif)", "cursor:pointer", "touch-action:manipulation",
].join(";");

export function createMessPrompt(deps: MessPromptDeps): MessPrompt {
  let card: HTMLElement | null = null;
  let shown = false;

  function build(host: HTMLElement): HTMLElement {
    const doc = host.ownerDocument;
    const el = doc.createElement("div");
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Clean up?");
    el.setAttribute("data-testid", PROMPT_TEST_ID);
    el.style.cssText = CARD_CSS;
    const q = doc.createElement("span");
    q.textContent = CLEAN_Q;
    const b = doc.createElement("button");
    b.type = "button";
    b.textContent = `\u{1F9FD} ${CLEAN_BUTTON}`;
    b.setAttribute("aria-label", CLEAN_BUTTON);
    b.style.cssText = BUTTON_CSS;
    b.addEventListener("click", () => { deps.onClean(); });
    el.append(q, b);
    host.appendChild(el);
    return el;
  }

  return {
    show() {
      const host = deps.host();
      if (!host) return;
      if (!card || !card.isConnected) card = build(host);
      card.hidden = false;
      card.style.display = "flex";
      shown = true;
    },
    hide() {
      shown = false;
      if (card) { card.hidden = true; card.style.display = "none"; }
    },
    get visible() { return shown; },
    dispose() {
      shown = false;
      card?.remove();
      card = null;
    },
  };
}
