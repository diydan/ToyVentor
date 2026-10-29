// ToyVentor World engine facade, port step 1: wrap, do not rewrite.
//
// The 2.5D engine in game/engine25.js stays imperative three.js 0.128 and
// keeps its canvas and render loop. For now it still runs as the standalone
// page built by game/build25.py, hosted same-origin in an iframe. This
// module is the only door between React and that page: commands go in
// through the engine's own UI (world tabs, zoom button, mission buttons,
// the #toy= contract on load), and state comes out as typed events read
// from the engine's save object, diffed a few times a second. React never
// touches the engine per frame.
//
// Later port steps replace pieces behind this same interface: React-owned
// HUD first, then Factory/customizer, mission panels as data, Create mode
// and the editor, and the three.js upgrade last.
import {
  WORLD_PATH,
  toyWorldUrl,
  type ToyContract,
} from "../../../../shared/toycontract";

export const WORLDS = [
  { id: "garden", label: "Garden" },
  { id: "sky", label: "Sky Meadow" },
  { id: "junk", label: "Junkyard" },
  { id: "beach", label: "Beach" },
  { id: "snow", label: "Snow Peak" },
  { id: "room", label: "Toy Room" },
  { id: "lab1", label: "Lab 1" },
] as const;

export type WorldId = (typeof WORLDS)[number]["id"];

export const ZOOM_LEVELS = ["Close", "Mid", "Far"] as const;
export type ZoomLevel = 0 | 1 | 2;

export type MissionAction = "test" | "later";

export type WorldEvent =
  | { type: "ready" }
  | { type: "world"; world: string }
  | { type: "zoom"; zoom: ZoomLevel }
  | { type: "found"; keys: string[]; total: number }
  | { type: "mission"; title: string | null }
  | { type: "toast"; text: string };

export interface WorldState {
  ready: boolean;
  world: string;
  zoom: ZoomLevel;
  foundTotal: number;
  missionTitle: string | null;
  toast: string;
}

export const initialWorldState: WorldState = {
  ready: false,
  world: "garden",
  zoom: 0,
  foundTotal: 0,
  missionTitle: null,
  toast: "",
};

/** Pure reducer: engine events in, HUD state out. */
export function applyWorldEvent(state: WorldState, event: WorldEvent): WorldState {
  switch (event.type) {
    case "ready":
      return state.ready ? state : { ...state, ready: true };
    case "world":
      return state.world === event.world ? state : { ...state, world: event.world };
    case "zoom":
      return state.zoom === event.zoom ? state : { ...state, zoom: event.zoom };
    case "found":
      return state.foundTotal === event.total
        ? state
        : { ...state, foundTotal: event.total };
    case "mission":
      return state.missionTitle === event.title
        ? state
        : { ...state, missionTitle: event.title };
    case "toast":
      return state.toast === event.text ? state : { ...state, toast: event.text };
  }
}

/** Minimal external store so the HUD re-renders on change, never per frame. */
export interface WorldStore {
  getState: () => WorldState;
  subscribe: (listener: () => void) => () => void;
  apply: (event: WorldEvent) => void;
}

export function createWorldStore(): WorldStore {
  let state = initialWorldState;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    apply: (event) => {
      const next = applyWorldEvent(state, event);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

/** The standalone world page, with the kid's build attached when there is one. */
export function worldUrlFor(contract: ToyContract | null): string {
  return contract ? toyWorldUrl(contract) : WORLD_PATH;
}

/** Keys present in next but not in prev, in next's order. */
export function diffFoundKeys(prev: ReadonlySet<string>, next: ReadonlySet<string>): string[] {
  return [...next].filter((key) => !prev.has(key));
}

/** Clicks needed on the engine's cycling zoom button to land on target. */
export function zoomClicks(from: number, target: ZoomLevel): number {
  return (target - from + ZOOM_LEVELS.length) % ZOOM_LEVELS.length;
}

/** One press of the engine's zoom button: Close to Mid to Far to Close. */
export function nextZoom(zoom: ZoomLevel): ZoomLevel {
  return ((zoom + 1) % ZOOM_LEVELS.length) as ZoomLevel;
}

export interface EngineHandle {
  /** Reload the world wearing this contract (or stock when null). */
  setToy: (contract: ToyContract | null) => void;
  /** Switch world through the engine's own world tabs. Queued until ready. */
  goWorld: (world: WorldId) => void;
  /** Set the camera zoom through the engine's own zoom button. */
  setZoom: (zoom: ZoomLevel) => void;
  /** Press the open mission panel's Test or Later button. */
  missionAction: (action: MissionAction) => void;
  /** Leave the title screen and start playing. */
  start: () => void;
  /** Stop polling and unload the frame, which destroys its WebGL context. */
  dispose: () => void;
}

export interface EngineEvents {
  onEvent: (event: WorldEvent) => void;
}

interface LegacySave {
  world?: string;
  zoom?: number;
  found?: Record<string, boolean>;
}

interface LegacyHooks {
  S?: LegacySave;
  go?: (world: string) => void;
  start?: (build: boolean) => void;
}

interface LegacyWindow extends Window {
  __x?: LegacyHooks;
}

const POLL_MS = 300;

/**
 * Host the legacy engine page in `frame` and talk to it through this
 * handle. Safe under StrictMode double-mounting: dispose unloads the
 * frame, and a fresh createEngine on the same element reloads it.
 */
export function createEngine(
  frame: HTMLIFrameElement,
  events: EngineEvents,
  initial: { contract: ToyContract | null },
): EngineHandle {
  let disposed = false;
  let ready = false;
  let lastUrl = "";
  let pendingWorld: WorldId | null = null;
  let lastWorld = "";
  let lastZoom = -1;
  let lastFound = new Set<string>();
  let lastMission: string | null | undefined;
  let lastToast = "";

  const win = (): LegacyWindow | null => {
    try {
      return (frame.contentWindow as LegacyWindow | null) ?? null;
    } catch {
      return null;
    }
  };
  const hooks = (): LegacyHooks | null => win()?.__x ?? null;
  const doc = (): Document | null => {
    try {
      return frame.contentDocument;
    } catch {
      return null;
    }
  };

  const load = (contract: ToyContract | null) => {
    const url = worldUrlFor(contract);
    if (url === lastUrl && frame.src.includes("ToyVentor-World.html")) return;
    lastUrl = url;
    ready = false;
    frame.src = url;
  };
  load(initial.contract);

  const click = (selector: string) => {
    doc()?.querySelector<HTMLElement>(selector)?.click();
  };

  const poll = () => {
    if (disposed) return;
    const api = hooks();
    const save = api?.S;
    if (!api || !save) return;
    if (!ready) {
      ready = true;
      lastFound = new Set(Object.keys(save.found ?? {}));
      events.onEvent({ type: "ready" });
      if (pendingWorld) {
        api.go?.(pendingWorld);
        pendingWorld = null;
      }
    }
    if (typeof save.world === "string" && save.world !== lastWorld) {
      lastWorld = save.world;
      events.onEvent({ type: "world", world: save.world });
    }
    const zoom = Math.max(0, Math.min(2, save.zoom ?? 0)) as ZoomLevel;
    if (zoom !== lastZoom) {
      lastZoom = zoom;
      events.onEvent({ type: "zoom", zoom });
    }
    const foundKeys = new Set(
      Object.entries(save.found ?? {})
        .filter(([, got]) => got)
        .map(([key]) => key),
    );
    const fresh = diffFoundKeys(lastFound, foundKeys);
    if (fresh.length > 0 || foundKeys.size !== lastFound.size) {
      events.onEvent({ type: "found", keys: fresh, total: foundKeys.size });
    }
    lastFound = foundKeys;

    const frameDoc = doc();
    const panel = frameDoc?.querySelector<HTMLElement>("#mp");
    const missionTitle =
      panel && !panel.hidden
        ? (frameDoc?.querySelector("#mp-t")?.textContent ?? "").trim() || "Mission"
        : null;
    if (missionTitle !== lastMission) {
      lastMission = missionTitle;
      events.onEvent({ type: "mission", title: missionTitle });
    }
    const toastEl = frameDoc?.querySelector<HTMLElement>("#toast");
    const toast =
      toastEl && toastEl.classList.contains("on") ? (toastEl.textContent ?? "").trim() : "";
    if (toast && toast !== lastToast) {
      events.onEvent({ type: "toast", text: toast });
    }
    lastToast = toast;
  };
  const timer = window.setInterval(poll, POLL_MS);
  poll();

  return {
    setToy: (contract) => {
      if (!disposed) load(contract);
    },
    goWorld: (world) => {
      if (disposed) return;
      const api = hooks();
      if (ready && api?.go) api.go(world);
      else pendingWorld = world;
    },
    setZoom: (target) => {
      const save = hooks()?.S;
      if (!save) return;
      const clicks = zoomClicks(save.zoom ?? 0, target);
      for (let i = 0; i < clicks; i++) click("#zoom");
    },
    missionAction: (action) => {
      click(action === "test" ? "#mp-go" : "#mp-x");
    },
    start: () => {
      hooks()?.start?.(false);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.clearInterval(timer);
      lastUrl = "";
      // Unloading the frame tears down its renderer, render loop,
      // listeners, and audio context with the document.
      frame.src = "about:blank";
    },
  };
}
