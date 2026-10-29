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
// HUD, Factory/customizer, and mission panels as data are in; Create mode
// and the editor come next, and the three.js upgrade last.
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

export type MissionAction = "test" | "later" | "forge";

export interface MissionPanelControl {
  index: number;
  label: string;
  disabled: boolean;
  primary: boolean;
  active: boolean;
  danger: boolean;
  dataset: Record<string, string>;
  group?: string;
  borderColor?: string;
}

export interface MissionPanelChip {
  text: string;
  question: boolean;
  background?: string;
}

/** Data-only view of one legacy mission panel for React to render. */
export interface MissionPanelSnapshot {
  open: boolean;
  title: string;
  goal: string;
  lines: string[];
  chips: MissionPanelChip[];
  controls: MissionPanelControl[];
  actionLabel: string;
  forgeAvailable: boolean;
  binText: string;
}

export interface RawMissionPanelSnapshot {
  open?: boolean;
  title?: string;
  goal?: string;
  lines?: string[];
  chips?: MissionPanelChip[];
  controls?: Array<Omit<MissionPanelControl, "index"> & { index?: number }>;
  actionLabel?: string;
  forgeAvailable?: boolean;
  binText?: string;
}

export const closedMissionPanelSnapshot: MissionPanelSnapshot = {
  open: false,
  title: "",
  goal: "",
  lines: [],
  chips: [],
  controls: [],
  actionLabel: "Test it",
  forgeAvailable: false,
  binText: "",
};

const cleanText = (text: string | undefined): string =>
  (text ?? "").replace(/\s+/g, " ").trim();

/** Normalize any legacy mission panel into the one shape React renders. */
export function normalizeMissionPanelSnapshot(
  raw: RawMissionPanelSnapshot = {},
): MissionPanelSnapshot {
  if (!raw.open) return { ...closedMissionPanelSnapshot, lines: [], chips: [], controls: [] };
  return {
    open: true,
    title: cleanText(raw.title) || "Mission",
    goal: cleanText(raw.goal),
    lines: (raw.lines ?? []).map(cleanText).filter(Boolean),
    chips: (raw.chips ?? [])
      .map((chip) => ({ ...chip, text: cleanText(chip.text) }))
      .filter((chip) => chip.text),
    controls: (raw.controls ?? []).map((control, index) => ({
      ...control,
      index,
      label: cleanText(control.label),
      dataset: { ...control.dataset },
      group: control.group ? cleanText(control.group) : undefined,
    })),
    actionLabel: cleanText(raw.actionLabel) || "Test it",
    forgeAvailable: Boolean(raw.forgeAvailable),
    binText: cleanText(raw.binText),
  };
}

export function sameMissionPanelSnapshot(
  a: MissionPanelSnapshot,
  b: MissionPanelSnapshot,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type PaintZone = "c1" | "c2" | "skin";
export type FactoryAction = "done" | "fix" | "order" | "reset" | "forge";

export interface CustomizerChoice {
  id: string;
  label: string;
  selected: boolean;
}

export interface CustomizerPartOption extends CustomizerChoice {
  detail: string;
  locked: boolean;
  lockLabel: string;
  statColor?: string;
}

export interface PaintOption {
  color: string;
  selected: boolean;
}

export interface ForgeItem {
  id: string | null;
  label: string;
  description: string;
  owned: number | null;
  locked: boolean;
  canForge: boolean;
  forgeLabel: string;
  printLabel: string;
  onPrintList: boolean;
}

/** Data-only view of the legacy Factory/customizer sheet for React to render. */
export interface CustomizerSnapshot {
  open: boolean;
  forge: boolean;
  toyType: string;
  types: CustomizerChoice[];
  slot: string;
  slots: CustomizerChoice[];
  options: CustomizerPartOption[];
  paintZone: PaintZone;
  paintZones: Array<CustomizerChoice & { id: PaintZone }>;
  paints: PaintOption[];
  moves: string;
  checkText: string;
  checkOk: boolean | null;
  scrap: number;
  forgeItems: ForgeItem[];
}

export interface RawCustomizerSnapshot {
  open?: boolean;
  forge?: boolean;
  toyType?: string;
  types?: CustomizerChoice[];
  slot?: string;
  slots?: CustomizerChoice[];
  options?: CustomizerPartOption[];
  paintZone?: PaintZone;
  paintZones?: Array<CustomizerChoice & { id: PaintZone }>;
  paints?: PaintOption[];
  moves?: string;
  checkText?: string;
  checkOk?: boolean | null;
  scrap?: number;
  forgeItems?: ForgeItem[];
}

export const closedCustomizerSnapshot: CustomizerSnapshot = {
  open: false,
  forge: false,
  toyType: "vehicle",
  types: [],
  slot: "",
  slots: [],
  options: [],
  paintZone: "c1",
  paintZones: [],
  paints: [],
  moves: "",
  checkText: "",
  checkOk: null,
  scrap: 0,
  forgeItems: [],
};

/** Normalize legacy sheet data and derive the selected ids React renders. */
export function normalizeCustomizerSnapshot(
  raw: RawCustomizerSnapshot = {},
): CustomizerSnapshot {
  const scrap = Math.max(0, Math.floor(raw.scrap ?? 0));
  if (!raw.open) return { ...closedCustomizerSnapshot, scrap };

  const types = (raw.types ?? []).map((choice) => ({ ...choice }));
  const slots = (raw.slots ?? []).map((choice) => ({ ...choice }));
  const paintZones = (raw.paintZones ?? []).map((choice) => ({ ...choice }));
  const selectedToy = types.find((choice) => choice.selected)?.id;
  const selectedSlot = slots.find((choice) => choice.selected)?.id;
  const selectedZone = paintZones.find((choice) => choice.selected)?.id;

  return {
    open: true,
    forge: Boolean(raw.forge),
    toyType: raw.toyType || selectedToy || types[0]?.id || closedCustomizerSnapshot.toyType,
    types,
    slot: raw.slot || selectedSlot || slots[0]?.id || "",
    slots,
    options: (raw.options ?? []).map((option) => ({ ...option })),
    paintZone: raw.paintZone || selectedZone || paintZones[0]?.id || "c1",
    paintZones,
    paints: (raw.paints ?? []).map((paint) => ({ ...paint })),
    moves: raw.moves ?? "",
    checkText: raw.checkText ?? "",
    checkOk: raw.checkOk ?? null,
    scrap,
    forgeItems: (raw.forgeItems ?? []).map((item) => ({ ...item })),
  };
}

export function sameCustomizerSnapshot(
  a: CustomizerSnapshot,
  b: CustomizerSnapshot,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type WorldEvent =
  | { type: "ready" }
  | { type: "world"; world: string }
  | { type: "zoom"; zoom: ZoomLevel }
  | { type: "found"; keys: string[]; total: number }
  | { type: "mission"; title: string | null }
  | { type: "toast"; text: string }
  | { type: "customizer"; customizer: CustomizerSnapshot }
  | { type: "missionPanel"; panel: MissionPanelSnapshot };

export interface WorldState {
  ready: boolean;
  world: string;
  zoom: ZoomLevel;
  foundTotal: number;
  missionTitle: string | null;
  toast: string;
  customizer: CustomizerSnapshot;
  missionPanel: MissionPanelSnapshot;
}

export const initialWorldState: WorldState = {
  ready: false,
  world: "garden",
  zoom: 0,
  foundTotal: 0,
  missionTitle: null,
  toast: "",
  customizer: closedCustomizerSnapshot,
  missionPanel: closedMissionPanelSnapshot,
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
    case "customizer":
      return sameCustomizerSnapshot(state.customizer, event.customizer)
        ? state
        : { ...state, customizer: event.customizer };
    case "missionPanel":
      return sameMissionPanelSnapshot(state.missionPanel, event.panel)
        ? state
        : {
            ...state,
            missionPanel: event.panel,
            missionTitle: event.panel.open ? event.panel.title : null,
          };
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
  /** Press the open mission panel's main, Forge, or Later button. */
  missionAction: (action: MissionAction) => void;
  /** Press one control from the current mission panel snapshot. */
  missionControl: (index: number) => void;
  /** Open the Factory stage and let React replace the legacy sheet. */
  openCustomizer: (mode?: "build" | "forge") => void;
  /** Close the Factory/customizer and restore the standalone sheet. */
  closeCustomizer: () => void;
  /** Choose a toy body type through the legacy customizer. */
  setToyType: (toyType: string) => void;
  /** Choose which customizer slot is being edited. */
  selectSlot: (slot: string) => void;
  /** Equip a part in the currently selected slot. */
  selectPart: (partId: string) => void;
  /** Choose which paint zone the swatches edit. */
  setPaintZone: (zone: PaintZone) => void;
  /** Apply one of the engine's paint or skin colors. */
  setPaint: (color: string) => void;
  /** Run a legacy Factory sheet action. `forge` toggles Forge mode. */
  factoryAction: (action: FactoryAction) => void;
  /** Forge a mission tool when its blueprint and scrap allow it. */
  forgeTool: (toolId: string) => void;
  /** Add a forged tool to the legacy print list. */
  printTool: (toolId: string) => void;
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
  type?: string;
  scrap?: number;
  found?: Record<string, boolean>;
}

interface LegacyPlayer {
  title?: boolean;
  showcase?: boolean;
}

interface LegacyHooks {
  S?: LegacySave;
  P?: LegacyPlayer;
  go?: (world: string) => void;
  start?: (build: boolean) => void;
  open?: () => void;
  close?: () => void;
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
  let pendingCustomizer: "build" | "forge" | null = null;
  let sheetSuppressed = false;
  let lastWorld = "";
  let lastZoom = -1;
  let lastFound = new Set<string>();
  let lastMission: string | null | undefined;
  let lastToast = "";
  let lastCustomizer = closedCustomizerSnapshot;
  let lastMissionPanel = closedMissionPanelSnapshot;

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

  const buttonList = (root: ParentNode | null, selector: string): HTMLButtonElement[] =>
    root ? ([...root.querySelectorAll(selector)] as HTMLButtonElement[]) : [];

  const clickWhere = (
    selector: string,
    test: (button: HTMLButtonElement) => boolean,
  ): boolean => {
    const button = buttonList(doc(), selector).find(test);
    if (!button) return false;
    button.click();
    return true;
  };

  const textOf = (element: Element | null | undefined): string =>
    (element?.textContent ?? "").replace(/\s+/g, " ").trim();

  const pressed = (button: HTMLElement): boolean =>
    button.getAttribute("aria-pressed") === "true" || button.classList.contains("on");

  // React renders the customizer while the legacy sheet remains only as
  // the engine's backing control surface during this port step.
  const suppressLegacySheet = (on: boolean) => {
    sheetSuppressed = on;
    const frameDoc = doc();
    if (!frameDoc) return;
    const id = "toyventor-react-customizer-style";
    const existing = frameDoc.getElementById(id);
    if (on && !existing) {
      const style = frameDoc.createElement("style");
      style.id = id;
      style.textContent = "#sheet{display:none!important}";
      frameDoc.head.appendChild(style);
    }
    if (!on) existing?.remove();
  };

  // React renders mission panels for this host; the legacy panel stays as
  // the backing control surface until mission definitions emit data natively.
  const suppressLegacyMissionPanel = () => {
    const frameDoc = doc();
    if (!frameDoc?.head) return;
    const id = "toyventor-react-mission-style";
    if (frameDoc.getElementById(id)) return;
    const style = frameDoc.createElement("style");
    style.id = id;
    style.textContent = "#mp{display:none!important}";
    frameDoc.head.appendChild(style);
  };

  const textLines = (element: Element): string[] => {
    const lines: string[] = [];
    let current = "";
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        current += node.textContent ?? "";
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "BR") {
        lines.push(current);
        current = "";
        return;
      }
      node.childNodes.forEach(walk);
    };
    element.childNodes.forEach(walk);
    lines.push(current);
    return lines.map(cleanText).filter(Boolean);
  };

  const readMissionPanel = (): MissionPanelSnapshot => {
    const frameDoc = doc();
    const panel = frameDoc?.querySelector<HTMLElement>("#mp");
    if (!frameDoc || !panel || panel.hidden) return normalizeMissionPanelSnapshot();

    const lines = [...frameDoc.querySelectorAll<HTMLElement>("#mp-slots .mp-stat")].flatMap(
      textLines,
    );
    const groupOf = (button: HTMLButtonElement): string | undefined => {
      const header = button.closest(".mp-slot")?.querySelector(".mp-sn");
      if (!header) return undefined;
      const name = textOf(header.querySelector("b"));
      const status = textOf(header.querySelector("span"));
      return [name, status].filter(Boolean).join(" · ") || textOf(header) || undefined;
    };
    const controls = buttonList(frameDoc, "#mp-slots button").map((button, index) => ({
      index,
      label: textOf(button),
      disabled: button.disabled,
      primary: button.classList.contains("primary"),
      active: pressed(button),
      danger: button.classList.contains("bad"),
      dataset: Object.fromEntries(
        Object.entries(button.dataset).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      group: groupOf(button),
      borderColor: button.style.borderColor || undefined,
    }));
    const forgeButton = frameDoc.querySelector<HTMLElement>("#mp-forge");

    return normalizeMissionPanelSnapshot({
      open: true,
      title: textOf(frameDoc.querySelector("#mp-t")),
      goal: textOf(frameDoc.querySelector("#mp-g")),
      lines,
      chips: [...frameDoc.querySelectorAll<HTMLElement>("#mp-slots .pseq span")].map(
        (chip) => ({
          text: textOf(chip),
          question: chip.classList.contains("q"),
          background: chip.style.background || undefined,
        }),
      ),
      controls,
      actionLabel: textOf(frameDoc.querySelector("#mp-go")),
      forgeAvailable: Boolean(forgeButton && !forgeButton.hidden),
      binText: textOf(frameDoc.querySelector("#mp-bin")),
    });
  };

  const readCustomizer = (save: LegacySave): CustomizerSnapshot => {
    const frameDoc = doc();
    const sheet = frameDoc?.querySelector<HTMLElement>("#sheet");
    if (!frameDoc || !sheet || sheet.hidden) {
      return normalizeCustomizerSnapshot({ open: false, scrap: save.scrap });
    }

    const forge = frameDoc.body.classList.contains("forging");
    const options = buttonList(frameDoc, "#opts button").map((button) => ({
      id: button.dataset.id ?? "",
      label: textOf(button.querySelector("b")) || textOf(button),
      detail: textOf(button.querySelector(".meta")),
      selected: pressed(button),
      locked: button.classList.contains("lock"),
      lockLabel: textOf(button.querySelector(".lk")),
      statColor: button.querySelector<HTMLElement>(".meta i")?.style.background,
    }));
    const check = frameDoc.querySelector<HTMLElement>("#check .ck");
    const forgeItems: ForgeItem[] = forge
      ? [...frameDoc.querySelectorAll<HTMLElement>("#forge .fg-it")].map((item) => {
          const forgeButton = item.querySelector<HTMLButtonElement>("[data-forge]");
          const printButton = item.querySelector<HTMLButtonElement>("[data-print]");
          const countText = textOf(item.querySelector(".fg-n"));
          const count = /(\d+)/.exec(countText)?.[1];
          const description =
            [...item.querySelectorAll<HTMLElement>(".fg-t span")]
              .map((span) => textOf(span))
              .find((text) => text && !text.startsWith("You have")) ?? "";
          return {
            id: forgeButton?.dataset.forge ?? printButton?.dataset.print ?? null,
            label: textOf(item.querySelector(".fg-t b")) || "Forge item",
            description,
            owned: count ? Number(count) : null,
            locked: item.classList.contains("lock"),
            canForge: Boolean(forgeButton && !forgeButton.disabled),
            forgeLabel: textOf(forgeButton),
            printLabel: textOf(printButton),
            onPrintList: textOf(printButton).startsWith("On print list"),
          };
        })
      : [];

    return normalizeCustomizerSnapshot({
      open: true,
      forge,
      toyType: save.type,
      types: buttonList(frameDoc, "#types button").map((button) => ({
        id: button.dataset.t ?? "",
        label: textOf(button),
        selected: pressed(button),
      })),
      slots: buttonList(frameDoc, "#slots button").map((button) => ({
        id: button.dataset.s ?? "",
        label: textOf(button),
        selected: pressed(button),
      })),
      options,
      paintZones: buttonList(frameDoc, "#seg button").map((button) => ({
        id: (button.dataset.z ?? "c1") as PaintZone,
        label: textOf(button),
        selected: pressed(button),
      })),
      paints: buttonList(frameDoc, "#sw button").map((button) => ({
        color: button.dataset.c ?? "",
        selected: pressed(button),
      })),
      moves: textOf(frameDoc.querySelector("#moves")),
      checkText: textOf(check),
      checkOk: check?.classList.contains("ok")
        ? true
        : check?.classList.contains("bad")
          ? false
          : null,
      scrap: save.scrap,
      forgeItems,
    });
  };

  function openCustomizerNow(mode: "build" | "forge" = "build") {
    if (disposed) return;
    const api = hooks();
    if (!ready || !api) {
      pendingCustomizer = mode;
      return;
    }
    suppressLegacySheet(true);
    if (api.P?.title) api.start?.(true);
    else if (!doc()?.querySelector("#sheet:not([hidden])")) api.open?.();
    if (mode === "forge" && !doc()?.body.classList.contains("forging")) click("#forgeb");
    poll();
  }

  function closeCustomizerNow() {
    if (disposed) return;
    pendingCustomizer = null;
    hooks()?.close?.();
    suppressLegacySheet(false);
    poll();
  }

  const poll = () => {
    if (disposed) return;
    suppressLegacyMissionPanel();
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
      if (pendingCustomizer) {
        const mode = pendingCustomizer;
        pendingCustomizer = null;
        openCustomizerNow(mode);
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
    const missionPanel = readMissionPanel();
    const missionTitle = missionPanel.open ? missionPanel.title : null;
    if (missionTitle !== lastMission) {
      lastMission = missionTitle;
      events.onEvent({ type: "mission", title: missionTitle });
    }
    if (!sameMissionPanelSnapshot(lastMissionPanel, missionPanel)) {
      lastMissionPanel = missionPanel;
      events.onEvent({ type: "missionPanel", panel: missionPanel });
    }
    const toastEl = frameDoc?.querySelector<HTMLElement>("#toast");
    const toast =
      toastEl && toastEl.classList.contains("on") ? (toastEl.textContent ?? "").trim() : "";
    if (toast && toast !== lastToast) {
      events.onEvent({ type: "toast", text: toast });
    }
    lastToast = toast;

    if (sheetSuppressed) suppressLegacySheet(true);
    const customizer = readCustomizer(save);
    if (!sameCustomizerSnapshot(lastCustomizer, customizer)) {
      lastCustomizer = customizer;
      events.onEvent({ type: "customizer", customizer });
    }
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
      if (action === "forge") suppressLegacySheet(true);
      click(action === "test" ? "#mp-go" : action === "forge" ? "#mp-forge" : "#mp-x");
      poll();
    },
    missionControl: (index) => {
      const button = buttonList(doc(), "#mp-slots button")[index];
      if (!button || button.disabled) return;
      button.click();
      poll();
    },
    openCustomizer: (mode = "build") => {
      openCustomizerNow(mode);
    },
    closeCustomizer: () => {
      closeCustomizerNow();
    },
    setToyType: (toyType) => {
      if (clickWhere("#types button", (button) => button.dataset.t === toyType)) poll();
    },
    selectSlot: (slot) => {
      if (clickWhere("#slots button", (button) => button.dataset.s === slot)) poll();
    },
    selectPart: (partId) => {
      if (clickWhere("#opts button", (button) => button.dataset.id === partId)) poll();
    },
    setPaintZone: (zone) => {
      if (clickWhere("#seg button", (button) => button.dataset.z === zone)) poll();
    },
    setPaint: (color) => {
      if (clickWhere("#sw button", (button) => button.dataset.c === color)) poll();
    },
    factoryAction: (action) => {
      if (action === "done") {
        closeCustomizerNow();
        return;
      }
      click(action === "forge" ? "#forgeb" : `#${action}`);
      poll();
    },
    forgeTool: (toolId) => {
      if (clickWhere("#forge button", (button) => button.dataset.forge === toolId)) poll();
    },
    printTool: (toolId) => {
      if (clickWhere("#forge button", (button) => button.dataset.print === toolId)) poll();
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
