// The moment song: after Kip picks something up (kip-pickup.js), one button makes a song about it (docs/product/close-out-checklist.md, section 1, row 4).
//
// The song is written and sung by the app's own route (worker/themeSong.ts) through the theme song card (kip-theme-song.js): the card shows the name and words as soon as
// they come back, plays a starter tune while the song is sung (about 45 to 50 seconds in all), and keeps the finished song in "My songs" so Kip can dance to it.
//
// WHAT THE SONG KNOWS. One sentence this file builds from closed words: the object ("guitar"), up to two colour words read from the cut-out, and what Kip does with it
// ("strums it"). Never the photo, a face, a name, a place or a voice. The word is the one the child tapped or typed, so the route screens it like any other idea.
//
// QUIET WHEN ABSENT. One cheap GET asks whether the song route is on (the same probe the card makes). When it is off, or answers anything but `enabled: true`, no button
// is shown, so a child never presses one that does nothing. Nothing is spent until the button is pressed, and then only through the metered route (a weekly limit per device).
import { createThemeSong, themeHeaders } from './kip-theme-song.js';

const COLOURS = new Set(['white', 'silver', 'grey', 'black', 'red', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']);

/** What Kip does with each workshop prop, in words the song's text model can turn into a mood and an instrument. */
const PROP_ACTION = {
  guitar: 'Kip strums it and sings along.',
  trumpet: 'Kip plays it loud and proud.',
  maracas: 'Kip shakes it to the beat.',
  hammer: 'Kip builds things with it.',
  screwdriver: 'Kip builds things with it.',
  paint_roller: 'Kip paints the whole wall with it.',
  mop: 'Kip cleans up with it.',
  broom: 'Kip sweeps up with it.',
  scrub_brush: 'Kip cleans up with it.',
  vacuum: 'Kip cleans up with it.',
  upright_vacuum: 'Kip cleans up with it.',
  spatula: 'Kip cooks pancakes with it in the kitchen.',
  frying_pan: 'Kip cooks pancakes with it in the kitchen.',
  flag: 'Kip waves it high.',
  magnifier: 'Kip looks closely at everything with it.',
};
const KITCHEN_WORDS = /\b(spoon|ladle|bowl|cup|mug|pot|pan|whisk|plate|banana|apple|orange|lemon)\b/;

/**
 * The description handed to the song route for a pick-up: `{ word, kind, id, label, colours }` from kip-pickup.js. At most 300 characters (the route's limit),
 * letters and spaces only in the object's name, and only colour words from the closed list. Never throws.
 */
export function songSentence(info) {
  const clean = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 '-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
  const label = clean(info?.label) || clean(info?.word) || 'thing';
  const colours = (Array.isArray(info?.colours) ? info.colours : []).map((c) => String(c)).filter((c) => COLOURS.has(c)).slice(0, 2);
  const look = colours.length ? `${colours.join(' and ')} ` : '';
  const article = /^[aeiou]/.test(look || label) ? 'an' : 'a';
  const action = (info?.kind === 'workshop' && PROP_ACTION[info.id]) || (KITCHEN_WORDS.test(label) ? 'Kip cooks with it in the kitchen.' : 'Kip just picked it up and cannot stop smiling.');
  return `A song about ${article} ${look}${label}. ${action}`.slice(0, 300);
}

const CSS = `
.kms-btn{position:fixed;left:50%;bottom:116px;transform:translateX(-50%);z-index:40;font:inherit;font-size:14px;font-weight:800;color:#fff;background:#6a4cff;border:0;border-radius:999px;min-height:44px;padding:0 18px;box-shadow:0 8px 22px rgba(42,33,80,.35);cursor:pointer;max-width:92vw}
.kms-btn[hidden],.kms-box[hidden]{display:none}
.kms-box{position:fixed;left:50%;bottom:116px;transform:translateX(-50%);z-index:41;width:min(360px,92vw);background:#fbf9f5;border-radius:16px;box-shadow:0 18px 44px rgba(27,34,56,.35);padding:8px 10px 10px;color:#2a2150;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.kms-close{position:absolute;top:-12px;right:-8px;z-index:2;font:inherit;font-size:14px;font-weight:800;border:0;background:#fff;color:#1b2238;border-radius:999px;min-width:36px;min-height:36px;box-shadow:0 4px 12px rgba(27,34,56,.35);cursor:pointer}
.kms-box .kts-card{margin:0}
.kms-box [hidden]{display:none!important}
`;

/**
 * @param {{ root: Element, url?: string, fetchImpl?: typeof fetch, onSong?: (song: object) => unknown, themeOptions?: object }} options
 */
export function createMomentSong({ root, url = '/api/theme-song', fetchImpl = globalThis.fetch, onSong = () => {}, themeOptions = {} } = {}) {
  if (!root) throw new Error('createMomentSong needs a root element');
  const doc = root.ownerDocument;
  let on = null; // null: not asked yet
  let built = null;
  let theme = null;
  let current = null;
  let disposed = false;

  async function routeOn() {
    if (on !== null) return on;
    try {
      const res = await fetchImpl(url, { headers: themeHeaders() });
      on = res.ok ? (await res.json())?.enabled === true : false;
    } catch { on = false; }
    return on;
  }

  function build() {
    if (built) return built;
    const style = doc.createElement('style');
    style.textContent = CSS;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'kms-btn';
    btn.hidden = true;
    const box = doc.createElement('section');
    box.className = 'kms-box';
    box.setAttribute('aria-label', 'A song about what Kip picked up');
    box.hidden = true;
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'kms-close';
    close.setAttribute('aria-label', 'Close the song');
    close.textContent = '✕';
    theme = createThemeSong({ doc, url, fetchImpl, onSong, ...themeOptions });
    box.append(close, theme.node);
    root.append(style, btn, box);
    btn.addEventListener('click', () => {
      if (!current) return;
      btn.hidden = true;
      box.hidden = false;
      theme.start(songSentence(current), { label: 'Song about it', waiting: 'Singing your song. This takes about a minute. Keep playing with Kip!' });
    });
    close.addEventListener('click', () => { theme.silence(); box.hidden = true; if (current) btn.hidden = false; });
    built = { style, btn, box, close };
    return built;
  }

  const api = {
    /** A pick-up just happened: show the song button for it, if the route is on. Resolves true when the button is showing. */
    async offer(info) {
      if (disposed || !info) return false;
      if (!(await routeOn()) || disposed) return false;
      const b = build();
      current = { ...info };
      theme.cancel();            // an older song's card goes; a song that is already being made carries on in My songs
      b.box.hidden = true;
      b.btn.textContent = `🎵 Make a song about the ${String(info.label || info.word || 'thing').toLowerCase().slice(0, 30)}`;
      b.btn.hidden = false;
      return true;
    },
    /** Hide the button and the card, and stop any tune. */
    hide() { if (built) { theme.silence(); built.btn.hidden = true; built.box.hidden = true; } current = null; },
    /** The card, for tests. */
    get theme() { return theme; },
    get state() { return { on, buttonShowing: Boolean(built && !built.btn.hidden), boxShowing: Boolean(built && !built.box.hidden), sentence: current ? songSentence(current) : null }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      theme?.dispose();
      if (built) { built.style.remove(); built.btn.remove(); built.box.remove(); built = null; }
      current = null;
    },
  };
  return api;
}
