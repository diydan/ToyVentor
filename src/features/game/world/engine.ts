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
// HUD, Factory/customizer, mission panels, Create mode, and the editor are
// in. The three.js upgrade comes last, on its own.
import {
  WORLD_PATH,
  toyWorldUrl,
  type ToyContract,
} from "../../../../shared/toycontract";

export const WORLDS = [
  { id: "garden", label: "Garden", lab: false },
  { id: "sky", label: "Sky Meadow", lab: false },
  { id: "junk", label: "Junkyard", lab: false },
  { id: "beach", label: "Beach", lab: false },
  { id: "snow", label: "Snow Peak", lab: false },
  { id: "room", label: "Toy Room", lab: false },
  { id: "lab1", label: "Lab 1", lab: true },
  { id: "lab2", label: "Lab 2", lab: true },
  { id: "lab3", label: "Lab 3", lab: true },
  { id: "lab4", label: "Lab 4", lab: true },
  { id: "lab5", label: "Lab 5", lab: true },
  { id: "lab6", label: "Lab 6", lab: true },
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

export interface WorldRecipeProp {
  type: string;
  x: number;
  y?: number;
  z?: number;
}

export interface WorldRecipeSpot {
  part: string;
  hide: string;
  x: number;
  z?: number;
}

/** The `toyventor.level/1` recipe shared by Create mode and the editor. */
export interface WorldRecipe {
  format: "toyventor.level/1";
  id: string;
  name: string;
  theme: string;
  props: WorldRecipeProp[];
  spots: WorldRecipeSpot[];
  missions?: unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validate and freeze an untrusted recipe value into snapshot data. */
export function normalizeRecipe(value: unknown): WorldRecipe | null {
  if (!isRecord(value) || value.format !== "toyventor.level/1") return null;
  if (!Array.isArray(value.props) || !Array.isArray(value.spots)) return null;
  const props: WorldRecipeProp[] = [];
  for (const prop of value.props) {
    if (!isRecord(prop) || typeof prop.type !== "string" || typeof prop.x !== "number") {
      return null;
    }
    props.push({
      type: prop.type,
      x: prop.x,
      ...(typeof prop.y === "number" ? { y: prop.y } : {}),
      ...(typeof prop.z === "number" ? { z: prop.z } : {}),
    });
  }
  const spots: WorldRecipeSpot[] = [];
  for (const spot of value.spots) {
    if (
      !isRecord(spot) ||
      typeof spot.part !== "string" ||
      typeof spot.hide !== "string" ||
      typeof spot.x !== "number"
    ) {
      return null;
    }
    spots.push({
      part: spot.part,
      hide: spot.hide,
      x: spot.x,
      ...(typeof spot.z === "number" ? { z: spot.z } : {}),
    });
  }
  return {
    format: "toyventor.level/1",
    id: cleanText(typeof value.id === "string" ? value.id : "") || "kid-world",
    name: cleanText(typeof value.name === "string" ? value.name : "") || "My world",
    theme: cleanText(typeof value.theme === "string" ? value.theme : "") || "garden",
    props,
    spots,
    ...(Array.isArray(value.missions)
      ? { missions: JSON.parse(JSON.stringify(value.missions)) as unknown[] }
      : {}),
  };
}

export interface CreateCard {
  title: string;
  text: string;
}

export type CreateAction = "undo" | "keep" | "play" | "code" | "mic";

/** Data-only view of legacy Create mode for React to render. */
export interface CreateSnapshot {
  open: boolean;
  busy: boolean;
  say: string;
  inputValue: string;
  chips: string[];
  cards: CreateCard[];
  canUndo: boolean;
  codeVisible: boolean;
  micAvailable: boolean;
  recipe: WorldRecipe | null;
}

export interface RawCreateSnapshot extends Omit<CreateSnapshot, "recipe"> {
  recipe?: unknown;
}

export const closedCreateSnapshot: CreateSnapshot = {
  open: false,
  busy: false,
  say: "",
  inputValue: "",
  chips: [],
  cards: [],
  canUndo: false,
  codeVisible: false,
  micAvailable: false,
  recipe: null,
};

export function normalizeCreateSnapshot(raw: Partial<RawCreateSnapshot> = {}): CreateSnapshot {
  if (!raw.open) return { ...closedCreateSnapshot, chips: [], cards: [] };
  return {
    open: true,
    busy: Boolean(raw.busy),
    say: cleanText(raw.say),
    inputValue: cleanText(raw.inputValue),
    chips: (raw.chips ?? []).map(cleanText).filter(Boolean),
    cards: (raw.cards ?? [])
      .map((card) => ({ title: cleanText(card.title), text: cleanText(card.text) }))
      .filter((card) => card.title || card.text),
    canUndo: Boolean(raw.canUndo),
    codeVisible: Boolean(raw.codeVisible),
    micAvailable: Boolean(raw.micAvailable),
    recipe: normalizeRecipe(raw.recipe),
  };
}

export function sameCreateSnapshot(a: CreateSnapshot, b: CreateSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The words a picture chip adds, matching the legacy Create chips. */
export function chipWord(chip: string): string {
  return cleanText(chip.replace(/^[^a-z]+/i, ""));
}

export type EditorTab = "spots" | "props" | "checks" | string;
export type EditorMode = "editor" | "create";
export type EditorAction =
  | "play"
  | "back"
  | "undo"
  | "redo"
  | "zoomIn"
  | "zoomOut"
  | "export"
  | "import";
export type EditorIoAction = "copy" | "load" | "close";

export interface EditorPaletteItem {
  index: number;
  label: string;
  detail: string;
  selected: boolean;
  color?: string;
}

export interface EditorControl {
  index: number;
  label: string;
  disabled: boolean;
  primary: boolean;
}

export interface EditorSelectOption {
  value: string;
  label: string;
  selected: boolean;
  group?: string;
}

export interface EditorSelect {
  index: number;
  label: string;
  value: string;
  options: EditorSelectOption[];
}

export interface EditorCheck {
  title: string;
  detail: string;
  ok: boolean;
}

export interface EditorIo {
  open: boolean;
  title: string;
  text: string;
  readOnly: boolean;
  canCopy: boolean;
  canLoad: boolean;
}

/** Data-only view of the legacy level editor for React to render. */
export interface EditorSnapshot {
  open: boolean;
  testing: boolean;
  mode: EditorMode;
  backLabel: string;
  name: string;
  theme: string;
  tab: EditorTab;
  tabs: Array<{ id: string; label: string; selected: boolean }>;
  canUndo: boolean;
  canRedo: boolean;
  selectedTitle: string;
  lines: string[];
  palette: EditorPaletteItem[];
  controls: EditorControl[];
  selects: EditorSelect[];
  checks: EditorCheck[];
  io: EditorIo;
  recipe: WorldRecipe | null;
}

export interface RawEditorSnapshot extends Omit<EditorSnapshot, "recipe" | "tab"> {
  tab?: EditorTab;
  recipe?: unknown;
}

const closedEditorIo: EditorIo = {
  open: false,
  title: "Level file",
  text: "",
  readOnly: true,
  canCopy: false,
  canLoad: false,
};

export const closedEditorSnapshot: EditorSnapshot = {
  open: false,
  testing: false,
  mode: "editor",
  backLabel: "Back to editor",
  name: "",
  theme: "garden",
  tab: "spots",
  tabs: [],
  canUndo: false,
  canRedo: false,
  selectedTitle: "",
  lines: [],
  palette: [],
  controls: [],
  selects: [],
  checks: [],
  io: closedEditorIo,
  recipe: null,
};

/** Normalize legacy editor DOM state into the one snapshot React renders. */
export function normalizeEditorSnapshot(
  raw: Partial<RawEditorSnapshot> = {},
): EditorSnapshot {
  const testing = Boolean(raw.testing);
  const mode: EditorMode = raw.mode === "create" ? "create" : "editor";
  const backLabel = cleanText(raw.backLabel) || closedEditorSnapshot.backLabel;
  if (!raw.open) {
    return {
      ...closedEditorSnapshot,
      testing,
      mode,
      backLabel,
      tabs: [],
      lines: [],
      palette: [],
      controls: [],
      selects: [],
      checks: [],
      io: { ...closedEditorIo },
    };
  }
  const tabs = (raw.tabs ?? []).map((tab) => ({
    id: cleanText(tab.id),
    label: cleanText(tab.label),
    selected: tab.selected,
  }));
  return {
    open: true,
    testing,
    mode,
    backLabel,
    name: cleanText(raw.name),
    theme: cleanText(raw.theme) || "garden",
    tab: raw.tab || tabs.find((tab) => tab.selected)?.id || tabs[0]?.id || "spots",
    tabs,
    canUndo: Boolean(raw.canUndo),
    canRedo: Boolean(raw.canRedo),
    selectedTitle: cleanText(raw.selectedTitle),
    lines: (raw.lines ?? []).map(cleanText).filter(Boolean),
    palette: (raw.palette ?? []).map((item, index) => ({
      ...item,
      index,
      label: cleanText(item.label),
      detail: cleanText(item.detail),
    })),
    controls: (raw.controls ?? []).map((control, index) => ({
      ...control,
      index,
      label: cleanText(control.label),
    })),
    selects: (raw.selects ?? []).map((select, index) => ({
      ...select,
      index,
      label: cleanText(select.label),
      options: select.options.map((option) => ({
        ...option,
        label: cleanText(option.label),
        group: option.group ? cleanText(option.group) : undefined,
      })),
    })),
    checks: (raw.checks ?? []).map((check) => ({
      title: cleanText(check.title),
      detail: cleanText(check.detail),
      ok: check.ok,
    })),
    io: raw.io
      ? {
          ...raw.io,
          title: cleanText(raw.io.title) || closedEditorIo.title,
        }
      : { ...closedEditorIo },
    recipe: normalizeRecipe(raw.recipe),
  };
}

export function sameEditorSnapshot(a: EditorSnapshot, b: EditorSnapshot): boolean {
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
  | { type: "missionsDone"; keys: string[]; total: number }
  | { type: "mission"; title: string | null }
  | { type: "toast"; text: string }
  | { type: "customizer"; customizer: CustomizerSnapshot }
  | { type: "missionPanel"; panel: MissionPanelSnapshot }
  | { type: "create"; create: CreateSnapshot }
  | { type: "editor"; editor: EditorSnapshot };

export interface WorldState {
  ready: boolean;
  world: string;
  zoom: ZoomLevel;
  foundTotal: number;
  missionsDoneTotal: number;
  missionTitle: string | null;
  toast: string;
  customizer: CustomizerSnapshot;
  missionPanel: MissionPanelSnapshot;
  create: CreateSnapshot;
  editor: EditorSnapshot;
}

export const initialWorldState: WorldState = {
  ready: false,
  world: "garden",
  zoom: 0,
  foundTotal: 0,
  missionsDoneTotal: 0,
  missionTitle: null,
  toast: "",
  customizer: closedCustomizerSnapshot,
  missionPanel: closedMissionPanelSnapshot,
  create: closedCreateSnapshot,
  editor: closedEditorSnapshot,
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
    case "missionsDone":
      return state.missionsDoneTotal === event.total
        ? state
        : { ...state, missionsDoneTotal: event.total };
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
    case "create":
      return sameCreateSnapshot(state.create, event.create)
        ? state
        : { ...state, create: event.create };
    case "editor":
      return sameEditorSnapshot(state.editor, event.editor)
        ? state
        : { ...state, editor: event.editor };
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
  /** Open kid Create mode and let React replace its panel. */
  openCreate: () => void;
  /** Exit Create mode back to the previous world. */
  closeCreate: () => void;
  /** Set the legacy Create prompt without submitting it (speech sync). */
  setCreateInput: (text: string) => void;
  /** Ask Muse (or the engine word parser) to make or change the world. */
  createMake: (text: string) => void;
  /** Run a legacy Create mode action. */
  createAction: (action: CreateAction) => void;
  /** Open the designer level editor and let React replace its panel. */
  openEditor: () => void;
  /** Exit the level editor back to the previous world. */
  closeEditor: () => void;
  /** Run a legacy level-editor toolbar action. */
  editorAction: (action: EditorAction) => void;
  /** Commit a level name through the legacy editor input. */
  setEditorName: (name: string) => void;
  /** Change the edited level's theme. */
  setEditorTheme: (theme: string) => void;
  /** Start a blank level or a copy from the legacy New menu value. */
  editorNew: (value: string) => void;
  /** Switch the editor's spots, scenery, or checks tab. */
  setEditorTab: (tab: EditorTab) => void;
  /** Arm a hiding spot or scenery palette entry for path placement. */
  editorPalette: (index: number) => void;
  /** Press an inspector control from the current editor snapshot. */
  editorControl: (index: number) => void;
  /** Change an inspector select from the current editor snapshot. */
  setEditorSelect: (index: number, value: string) => void;
  /** Replace the legacy export/import textarea contents. */
  setEditorIoText: (text: string) => void;
  /** Run an export/import dialog action. */
  editorIoAction: (action: EditorIoAction) => void;
  /** Leave the title screen and start playing. */
  start: () => void;
  /** Quiet the engine's background music when the calm Sleep Curtain fades in. */
  muteSound: () => void;
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
  mdone?: Record<string, number | boolean>;
  sel?: Record<string, Record<string, string>>;
  col?: Record<string, string>;
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
  cr?: {
    enter?: () => void;
    make?: (text: string) => void;
    exit?: () => void;
    R?: () => unknown;
    CR?: { busy?: boolean; code?: boolean };
  };
  ed?: {
    ED?: {
      on?: boolean;
      testing?: boolean;
      kid?: boolean;
      tab?: string;
      R?: unknown;
      undo?: unknown[];
      redo?: unknown[];
    };
    enter?: () => void;
    play?: () => void;
    back?: () => void;
    exit?: () => void;
  };
}

interface LegacyWindow extends Window {
  __x?: LegacyHooks;
}

const POLL_MS = 100;

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
  let pendingPanel: "create" | "editor" | null = null;
  let lastWorld = "";
  let lastZoom = -1;
  let lastFound = new Set<string>();
  let lastMissionsDone = new Set<string>();
  let lastMission: string | null | undefined;
  let lastToast = "";
  let lastCustomizer = closedCustomizerSnapshot;
  let lastMissionPanel = closedMissionPanelSnapshot;
  let lastCreate = closedCreateSnapshot;
  let lastEditor = closedEditorSnapshot;

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

  let boundDoc: Document | null = null;

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

  const load = (contract: ToyContract | null) => {
    const url = worldUrlFor(contract);
    if (url === lastUrl && frame.src.includes("ToyVentor-World.html")) return;
    const hadLoadedWorld = Boolean(lastUrl && frame.src.includes("ToyVentor-World.html"));
    lastUrl = url;

    const frameDoc = doc();
    const save = hooks()?.S;
    const sheetOpen = ready && Boolean(frameDoc?.querySelector("#sheet:not([hidden])"));
    if (hadLoadedWorld && sheetOpen && contract && save) {
      save.sel = save.sel ?? {};
      save.found = save.found ?? {};
      save.col = save.col ?? {};
      const sl = save.sel[contract.type] ?? (save.sel[contract.type] = {});
      for (const partKey of contract.parts) {
        const [t, slot, id] = partKey.split(".");
        if (t === contract.type && slot && id) {
          sl[slot] = id;
          save.found[partKey] = true;
        }
      }
      for (const zone of ["c1", "c2", "skin"] as const) {
        const hex = contract.col?.[zone] ?? "";
        if (/^#[0-9a-f]{6}$/i.test(hex)) save.col[zone] = hex;
      }
      const tag = frameDoc?.getElementById("toy-tag");
      if (tag && contract.name) {
        tag.textContent = `Your toy: ${contract.name.slice(0, 40)}`;
        tag.hidden = false;
      }
      try {
        win()?.history?.replaceState?.(null, "", url);
      } catch {
        // Ignore history state restrictions on unloaded frames.
      }
      save.type = contract.type === "vehicle" ? "robot" : "vehicle";
      if (!clickWhere("#types button", (b) => b.dataset.t === contract.type)) {
        save.type = contract.type;
      }
      return;
    }

    ready = false;
    boundDoc = null;
    const frameWin = win();
    if (hadLoadedWorld && frameWin?.location) {
      frameWin.location.replace(url);
      frameWin.location.reload();
      return;
    }
    frame.src = url;
  };
  load(initial.contract);

  const textOf = (element: Node | null | undefined): string =>
    (element?.textContent ?? "").replace(/\s+/g, " ").trim();

  const pressed = (button: HTMLElement): boolean =>
    button.getAttribute("aria-pressed") === "true" || button.classList.contains("on");

  // React renders customizer, mission, Create, and editor sheets as overlays
  // over the viewport; the legacy sheets stay hidden in the frame as backing
  // control surfaces until their definitions emit data natively.
  const suppressLegacyPanels = () => {
    const frameDoc = doc();
    if (!frameDoc?.head) return;
    const id = "toyventor-react-mission-style";
    let style = frameDoc.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
      style = frameDoc.createElement("style");
      style.id = id;
      frameDoc.head.appendChild(style);
    }
    style.textContent = "#sheet,#mp,#cr,#ed,#ed-io,#ed-back{display:none!important}";
    if (boundDoc !== frameDoc) {
      boundDoc = frameDoc;
      const syncSoon = () => {
        if (!disposed) window.setTimeout(poll, 0);
      };
      frameDoc.addEventListener("click", syncSoon, { passive: true });
      frameDoc.addEventListener("keyup", syncSoon, { passive: true });
    }
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

  const cloneValue = (value: unknown): unknown => {
    try {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  };

  const readCreate = (): CreateSnapshot => {
    const frameDoc = doc();
    const panel = frameDoc?.querySelector<HTMLElement>("#cr");
    const api = hooks();
    if (
      !frameDoc ||
      !panel ||
      panel.hidden ||
      api?.ed?.ED?.testing ||
      frameDoc.body.classList.contains("testing")
    ) {
      return normalizeCreateSnapshot();
    }
    const make = frameDoc.querySelector<HTMLButtonElement>("#cr-make");
    const mic = frameDoc.querySelector<HTMLButtonElement>("#cr-mic");
    return normalizeCreateSnapshot({
      open: true,
      busy: Boolean(api?.cr?.CR?.busy ?? make?.disabled),
      say: textOf(frameDoc.querySelector("#cr-say")),
      inputValue: frameDoc.querySelector<HTMLInputElement>("#cr-in")?.value ?? "",
      chips: buttonList(frameDoc, "#cr-chips button").map((button) => textOf(button)),
      cards: [...frameDoc.querySelectorAll<HTMLElement>("#cr-cards li")].map((item) => {
        const title = textOf(item.querySelector("b"));
        const whole = textOf(item);
        return { title, text: title && whole.startsWith(title) ? whole.slice(title.length).trim() : whole };
      }),
      canUndo: !frameDoc.querySelector<HTMLButtonElement>("#cr-undo")?.disabled,
      codeVisible: Boolean(
        api?.cr?.CR?.code ?? !frameDoc.querySelector<HTMLElement>("#cr-code")?.hidden,
      ),
      micAvailable: Boolean(mic && !mic.hidden),
      recipe: cloneValue(api?.cr?.R?.()),
    });
  };

  const newFrameEvent = (frameWindow: LegacyWindow, name: string): Event =>
    new (frameWindow as unknown as { Event: typeof Event }).Event(name, {
      bubbles: true,
    });

  const setFrameValue = (
    selector: string,
    value: string,
    eventName?: "input" | "change",
  ): boolean => {
    const frameWindow = win();
    const element = doc()?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      selector,
    );
    if (!frameWindow || !element) return false;
    element.value = value;
    if (eventName) {
      element.dispatchEvent(newFrameEvent(frameWindow, eventName));
    }
    return true;
  };

  function openCreateNow() {
    if (disposed) return;
    const api = hooks();
    if (!ready || !api?.cr) {
      pendingPanel = "create";
      return;
    }
    if (api.ed?.ED?.on && !api.ed.ED.kid) api.ed.exit?.();
    if (api.P?.title) click("#tcreate");
    else if (!doc()?.body.classList.contains("creating")) api.cr.enter?.();
    poll();
  }

  function openEditorNow() {
    if (disposed) return;
    const api = hooks();
    if (!ready || !api?.ed) {
      pendingPanel = "editor";
      return;
    }
    if (api.ed.ED?.kid) api.cr?.exit?.();
    if (api.P?.title) click("#tedit");
    else if (!api.ed.ED?.on) {
      if (api.ed.ED) api.ed.ED.kid = false;
      api.ed.enter?.();
    }
    poll();
  }

  const readEditor = (): EditorSnapshot => {
    const frameDoc = doc();
    const api = hooks();
    const edState = api?.ed?.ED;
    const testing = Boolean(edState?.testing);
    const mode: EditorMode = edState?.kid ? "create" : "editor";
    const backLabel = textOf(frameDoc?.querySelector("#ed-back")) || "Back to editor";
    const panel = frameDoc?.querySelector<HTMLElement>("#ed");
    if (!frameDoc || !panel || panel.hidden || !edState?.on || edState.kid) {
      return normalizeEditorSnapshot({ open: false, testing, mode, backLabel });
    }

    const bodyButtons = buttonList(frameDoc, "#ed-body button");
    const paletteButtons = buttonList(frameDoc, "#ed-body .ed-pal button");
    const paletteSet = new Set<Element>(paletteButtons);
    const ioPanel = frameDoc.querySelector<HTMLElement>("#ed-io");
    const ioText = frameDoc.querySelector<HTMLTextAreaElement>("#ed-txt");

    return normalizeEditorSnapshot({
      open: true,
      testing,
      mode,
      backLabel,
      name: frameDoc.querySelector<HTMLInputElement>("#ed-name")?.value ?? "",
      theme: frameDoc.querySelector<HTMLSelectElement>("#ed-theme")?.value ?? "garden",
      tab: edState.tab,
      tabs: buttonList(frameDoc, "#ed-tabs button").map((button) => ({
        id: button.dataset.tab ?? "",
        label: textOf(button),
        selected: pressed(button),
      })),
      canUndo: !frameDoc.querySelector<HTMLButtonElement>("#ed-undo")?.disabled,
      canRedo: !frameDoc.querySelector<HTMLButtonElement>("#ed-redo")?.disabled,
      selectedTitle: textOf(frameDoc.querySelector("#ed-body .ed-insp > b")),
      lines: [...frameDoc.querySelectorAll<HTMLElement>("#ed-body .ed-mut")]
        .filter((element) => !element.closest(".ed-chk"))
        .map((element) => textOf(element)),
      palette: paletteButtons.map((button, index) => {
        const label = textOf(button.querySelector("b")) || textOf(button);
        const detail = [...button.querySelectorAll("span")]
          .map((span) => textOf(span))
          .find(Boolean) ?? "";
        return {
          index,
          label,
          detail,
          selected: pressed(button),
          color: button.querySelector<HTMLElement>("i")?.style.background || undefined,
        };
      }),
      controls: bodyButtons
        .filter((button) => !paletteSet.has(button))
        .map((button, index) => ({
          index,
          label: textOf(button),
          disabled: button.disabled,
          primary: button.classList.contains("primary"),
        })),
      selects: [...frameDoc.querySelectorAll<HTMLSelectElement>("#ed-body select")].map(
        (select, index) => ({
          index,
          label: textOf(select.closest("label")?.childNodes[0] as ChildNode | undefined),
          value: select.value,
          options: [...select.options].map((option) => ({
            value: option.value,
            label: textOf(option),
            selected: option.selected,
            group:
              option.parentElement instanceof HTMLOptGroupElement
                ? option.parentElement.label
                : option.parentElement?.tagName === "OPTGROUP"
                  ? (option.parentElement as HTMLOptGroupElement).label
                  : undefined,
          })),
        }),
      ),
      checks: [...frameDoc.querySelectorAll<HTMLElement>("#ed-body .ed-chk li")].map(
        (item) => ({
          title: textOf(item.querySelector("b")),
          detail: textOf(item.querySelector(".ed-mut")),
          ok: item.classList.contains("ok"),
        }),
      ),
      io: {
        open: Boolean(ioPanel && !ioPanel.hidden),
        title: textOf(frameDoc.querySelector("#ed-io-t")) || "Level file",
        text: ioText?.value ?? "",
        readOnly: Boolean(ioText?.readOnly),
        canCopy: !frameDoc.querySelector<HTMLButtonElement>("#ed-copy")?.hidden,
        canLoad: !frameDoc.querySelector<HTMLButtonElement>("#ed-load")?.hidden,
      },
      recipe: cloneValue(edState.R),
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
    suppressLegacyPanels();
    if (api.P?.title) api.start?.(true);
    else if (!doc()?.querySelector("#sheet:not([hidden])")) api.open?.();
    if (mode === "forge" && !doc()?.body.classList.contains("forging")) click("#forgeb");
    poll();
  }

  function closeCustomizerNow() {
    if (disposed) return;
    pendingCustomizer = null;
    hooks()?.close?.();
    poll();
  }

  const poll = () => {
    if (disposed) return;
    suppressLegacyPanels();
    const api = hooks();
    const save = api?.S;
    if (!api || !save) return;
    if (!ready) {
      ready = true;
      lastFound = new Set(Object.keys(save.found ?? {}));
      lastMissionsDone = new Set(
        Object.entries(save.mdone ?? {})
          .filter(([, done]) => Boolean(done))
          .map(([key]) => key),
      );
      events.onEvent({ type: "ready" });
      if (lastMissionsDone.size > 0) {
        events.onEvent({
          type: "missionsDone",
          keys: [],
          total: lastMissionsDone.size,
        });
      }
      if (pendingWorld) {
        api.go?.(pendingWorld);
        pendingWorld = null;
      }
      if (pendingCustomizer) {
        const mode = pendingCustomizer;
        pendingCustomizer = null;
        openCustomizerNow(mode);
      }
      if (pendingPanel) {
        const panel = pendingPanel;
        pendingPanel = null;
        if (panel === "create") openCreateNow();
        else openEditorNow();
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

    const mdoneKeys = new Set(
      Object.entries(save.mdone ?? {})
        .filter(([, done]) => Boolean(done))
        .map(([key]) => key),
    );
    const freshMissions = diffFoundKeys(lastMissionsDone, mdoneKeys);
    if (freshMissions.length > 0 || mdoneKeys.size !== lastMissionsDone.size) {
      events.onEvent({
        type: "missionsDone",
        keys: freshMissions,
        total: mdoneKeys.size,
      });
    }
    lastMissionsDone = mdoneKeys;

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

    const customizer = readCustomizer(save);
    if (!sameCustomizerSnapshot(lastCustomizer, customizer)) {
      lastCustomizer = customizer;
      events.onEvent({ type: "customizer", customizer });
    }
    const create = readCreate();
    if (!sameCreateSnapshot(lastCreate, create)) {
      lastCreate = create;
      events.onEvent({ type: "create", create });
    }
    const editor = readEditor();
    if (!sameEditorSnapshot(lastEditor, editor)) {
      lastEditor = editor;
      events.onEvent({ type: "editor", editor });
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
      suppressLegacyPanels();
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
    openCreate: () => {
      openCreateNow();
    },
    closeCreate: () => {
      if (disposed) return;
      pendingPanel = null;
      hooks()?.cr?.exit?.();
      poll();
    },
    setCreateInput: (text) => {
      setFrameValue("#cr-in", text);
    },
    createMake: (text) => {
      if (disposed || !text.trim()) return;
      setFrameValue("#cr-in", text);
      hooks()?.cr?.make?.(text);
      poll();
    },
    createAction: (action) => {
      click(
        action === "undo"
          ? "#cr-undo"
          : action === "keep"
            ? "#cr-keep"
            : action === "play"
              ? "#cr-play"
              : action === "code"
                ? "#cr-code-t"
                : "#cr-mic",
      );
      poll();
    },
    openEditor: () => {
      openEditorNow();
    },
    closeEditor: () => {
      if (disposed) return;
      pendingPanel = null;
      hooks()?.ed?.exit?.();
      poll();
    },
    editorAction: (action) => {
      if (action === "play") hooks()?.ed?.play?.();
      else if (action === "back") hooks()?.ed?.back?.();
      else {
        click(
          action === "undo"
            ? "#ed-undo"
            : action === "redo"
              ? "#ed-redo"
              : action === "zoomIn"
                ? "#ed-zi"
                : action === "zoomOut"
                  ? "#ed-zo"
                  : action === "export"
                    ? "#ed-export"
                    : "#ed-import",
        );
      }
      poll();
    },
    setEditorName: (name) => {
      if (setFrameValue("#ed-name", name, "change")) poll();
    },
    setEditorTheme: (theme) => {
      if (setFrameValue("#ed-theme", theme, "change")) poll();
    },
    editorNew: (value) => {
      if (value && setFrameValue("#ed-new", value, "change")) poll();
    },
    setEditorTab: (tab) => {
      if (clickWhere("#ed-tabs button", (button) => button.dataset.tab === tab)) poll();
    },
    editorPalette: (index) => {
      const button = buttonList(doc(), "#ed-body .ed-pal button")[index];
      if (!button) return;
      button.click();
      poll();
    },
    editorControl: (index) => {
      const palette = new Set(buttonList(doc(), "#ed-body .ed-pal button"));
      const button = buttonList(doc(), "#ed-body button").filter(
        (candidate) => !palette.has(candidate),
      )[index];
      if (!button || button.disabled) return;
      button.click();
      poll();
    },
    setEditorSelect: (index, value) => {
      const select = doc()?.querySelectorAll<HTMLSelectElement>("#ed-body select")[index];
      const frameWindow = win();
      if (!select || !frameWindow) return;
      select.value = value;
      select.dispatchEvent(newFrameEvent(frameWindow, "change"));
      poll();
    },
    setEditorIoText: (text) => {
      setFrameValue("#ed-txt", text);
    },
    editorIoAction: (action) => {
      click(action === "copy" ? "#ed-copy" : action === "load" ? "#ed-load" : "#ed-close");
      poll();
    },
    start: () => {
      hooks()?.start?.(false);
    },
    muteSound: () => {
      const snd = doc()?.querySelector<HTMLButtonElement>("#snd");
      if (snd && snd.getAttribute("aria-pressed") === "true") {
        snd.click();
      }
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
