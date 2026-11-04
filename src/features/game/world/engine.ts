// ToyVentor World engine facade (Phase 0A: native in-process stage).
//
// The 2.5D runtime in runtime/world.ts runs in-process behind this
// interface. Commands go through the runtime's own controls, and state
// comes out as typed events emitted via a microtask-batched notify()
// on every mutation — no polling, no iframe. React never touches the
// engine per frame.
import {
  WORLD_PATH,
  toyWorldUrl,
  type ToyContract,
} from "../../../../shared/toycontract";
import type { BakedClip, BeatSource } from "./runtime/mixamo";
import { createWorldRuntime } from "./runtime";
import { PORTRAIT_PX, type ToyPortrait } from "../../../lib/toyPortrait";
import type { BuildSummary } from "../../../lib/garage";

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

/** "open" opens the mission's card from the small chip walking up to it shows (the card no longer opens by itself). */
export type MissionAction = "test" | "later" | "forge" | "open";

/** The small chip shown beside the Kip button while Kip stands at a mission whose card is closed. */
export interface MissionHint {
  title: string;
  /** Solved already: the card then only offers "Play again". */
  done: boolean;
}

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
  /** Engine mission id, e.g. "lab1.measure"; null when unknown. */
  missionId: string | null;
  /** Active difficulty tier stored on the mission state (1-3). */
  tier: 1 | 2 | 3;
  title: string;
  goal: string;
  lines: string[];
  chips: MissionPanelChip[];
  controls: MissionPanelControl[];
  actionLabel: string;
  forgeAvailable: boolean;
  binText: string;
  /** Set only while the card is closed and Kip is at a mission that has one to open. */
  hint: MissionHint | null;
}

export interface RawMissionPanelSnapshot {
  open?: boolean;
  missionId?: string | null;
  tier?: number;
  title?: string;
  goal?: string;
  lines?: string[];
  chips?: MissionPanelChip[];
  controls?: Array<Omit<MissionPanelControl, "index"> & { index?: number }>;
  actionLabel?: string;
  forgeAvailable?: boolean;
  binText?: string;
  hint?: { title?: string; done?: boolean } | null;
}

export const closedMissionPanelSnapshot: MissionPanelSnapshot = {
  open: false,
  missionId: null,
  tier: 1,
  title: "",
  goal: "",
  lines: [],
  chips: [],
  controls: [],
  actionLabel: "Test it",
  forgeAvailable: false,
  binText: "",
  hint: null,
};

const cleanText = (text: string | undefined): string =>
  (text ?? "").replace(/\s+/g, " ").trim();

/** Normalize any legacy mission panel into the one shape React renders. */
export function normalizeMissionPanelSnapshot(
  raw: RawMissionPanelSnapshot = {},
): MissionPanelSnapshot {
  if (!raw.open) {
    const title = cleanText(raw.hint?.title);
    return { ...closedMissionPanelSnapshot, lines: [], chips: [], controls: [], hint: title ? { title, done: Boolean(raw.hint?.done) } : null };
  }
  return {
    open: true,
    hint: null,
    missionId: typeof raw.missionId === "string" ? raw.missionId : null,
    tier: raw.tier === 2 || raw.tier === 3 ? raw.tier : 1,
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

/** `wish:<id>` loads one of the wish worlds (runtime/wishWorlds.ts) into Create. */
export type CreateAction = "undo" | "keep" | "play" | "code" | "mic" | "unlook" | `wish:${string}`;
/** A card of the Create sheet's "wish worlds" row. */
export interface CreateWish {
  id: string;
  name: string;
}

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
  /** The wish worlds that can be picked (a generated look, ready made). */
  wishes: CreateWish[];
  /** The name of the AI-made look the world wears (shown with an "AI-made" label and a way to remove it), or null. */
  lookName: string | null;
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
  wishes: [],
  lookName: null,
  recipe: null,
};

export function normalizeCreateSnapshot(raw: Partial<RawCreateSnapshot> = {}): CreateSnapshot {
  if (!raw.open) return { ...closedCreateSnapshot, chips: [], cards: [], wishes: [] };
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
    wishes: (raw.wishes ?? []).map((w) => ({ id: cleanText(w.id), name: cleanText(w.name) })).filter((w) => w.id && w.name),
    lookName: cleanText(raw.lookName ?? undefined) || null,
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
export type FactoryAction = "done" | "order" | "reset" | "forge";

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

export interface MissionSolveDetail {
  key: string;
  /** Active difficulty tier; 1 when the runtime predates tiers. */
  tier: number;
  attempts: number;
  error: number;
  stats?: string[];
}

/** Active carousel Learn run (carousel spec §12.1), or null. */
export interface LearnSnapshot {
  track: string;
  rungIndex: number;
  step: number;
  total: number;
  kidMode: boolean;
}

export type WorldEvent =
  | { type: "ready" }
  | { type: "learn"; learn: LearnSnapshot | null }
  | { type: "learnFinished" }
  | { type: "world"; world: string; name?: string }
  | { type: "zoom"; zoom: ZoomLevel }
  | { type: "found"; keys: string[]; total: number; all?: string[] }
  | { type: "missionsDone"; keys: string[]; total: number; all?: string[] }
  | { type: "missionSolved"; detail: MissionSolveDetail }
  | { type: "mission"; title: string | null }
  | { type: "toast"; text: string }
  | { type: "customizer"; customizer: CustomizerSnapshot }
  | { type: "missionPanel"; panel: MissionPanelSnapshot }
  | { type: "create"; create: CreateSnapshot }
  | { type: "editor"; editor: EditorSnapshot };

export interface WorldState {
  ready: boolean;
  world: string;
  /** Display name of the world when it is not one of the fixed WORLDS (composed seed worlds). */
  worldName?: string;
  zoom: ZoomLevel;
  foundTotal: number;
  /** Every hidden-part key found so far (Map carousel pips). */
  foundKeys: string[];
  missionsDoneTotal: number;
  /** Every mission id done so far (Map carousel pips). */
  missionsDoneKeys: string[];
  missionTitle: string | null;
  toast: string;
  learn: LearnSnapshot | null;
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
  foundKeys: [],
  missionsDoneTotal: 0,
  missionsDoneKeys: [],
  missionTitle: null,
  toast: "",
  learn: null,
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
      return state.world === event.world && state.worldName === event.name
        ? state
        : { ...state, world: event.world, worldName: event.name };
    case "zoom":
      return state.zoom === event.zoom ? state : { ...state, zoom: event.zoom };
    case "found": {
      const foundKeys =
        event.all ?? [...new Set([...state.foundKeys, ...event.keys])];
      return state.foundTotal === event.total &&
        state.foundKeys.length === foundKeys.length
        ? state
        : { ...state, foundTotal: event.total, foundKeys };
    }
    case "missionsDone": {
      const missionsDoneKeys =
        event.all ?? [...new Set([...state.missionsDoneKeys, ...event.keys])];
      return state.missionsDoneTotal === event.total &&
        state.missionsDoneKeys.length === missionsDoneKeys.length
        ? state
        : { ...state, missionsDoneTotal: event.total, missionsDoneKeys };
    }
    case "missionSolved":
      // Scoring detail for the XP layer; HUD totals come from missionsDone.
      return state;
    case "mission":
      return state.missionTitle === event.title
        ? state
        : { ...state, missionTitle: event.title };
    case "toast":
      return state.toast === event.text ? state : { ...state, toast: event.text };
    case "learn":
      return JSON.stringify(state.learn) === JSON.stringify(event.learn)
        ? state
        : { ...state, learn: event.learn };
    case "learnFinished":
      return state;
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

/** Knobs for a seeded level (the explorer map's generated paths and secret exits). */
export interface SeedOptions {
  tier?: 1 | 2 | 3;
  mood?: "day" | "dusk" | "night";
}

export interface EngineHandle {
  /** Apply this contract in-memory (or stock when null); no reload. */
  setToy: (contract: ToyContract | null) => void;
  /** Switch world through the engine's own world tabs. Queued until ready. */
  goWorld: (world: WorldId) => void;
  /** Compose a level from the level kit (a seed code, or random when omitted) and play it. Returns the code. */
  /** Play a seeded level. `theme` forces the world's look; `opts` sets its difficulty tier
   *  (1-3, stations start at that tier) and mood. Null = it could not start. */
  playSeed: (code?: string, theme?: string, opts?: SeedOptions) => string | null;
  /** The toy as built right now (type, part per slot, stats): what the Garage checks a mission against. */
  buildSummary: () => BuildSummary | null;
  /** Open these parts to try (the Garage's loaner); any `known` loaner not in `active` and still worn goes back. */
  setLoanKeys: (active: string[], known: string[]) => void;
  /** The dance party: start the character's dance on a song's clock (`source()` says which dance and how far into it, in seconds, read every frame). False when it cannot dance (reduced motion, no rig). */
  partyDanceStart: (source: BeatSource) => boolean;
  /** Put converted dance clips into the character's bank (the party loads its dances on demand). */
  partyAddClips: (clips: Record<string, BakedClip>) => void;
  partyDanceStop: () => void;
  /** Fade the world's own music out (true) and back (false) while a song plays. */
  partyMusicDuck: (on: boolean) => void;
  /** Signature of the toy's current outfit once its parts have finished loading; null until then. */
  portraitSig: () => string | null;
  /** A small picture of the toy as it is dressed now (the Map's character token). Null when it cannot be taken. */
  capturePortrait: (size?: number) => ToyPortrait | null;
  /** Set the camera zoom level in the runtime. */
  setZoom: (zoom: ZoomLevel) => void;
  /** Pause the world (no drawing, no keyboard, music faded out) while a full-screen overlay such as the Workshop is open; false resumes it. */
  setPaused: (paused: boolean) => void;
  /** Start a carousel Learn run over the given rung plan. */
  startLearnRun: (track: string, plan: number[], kidMode: boolean) => void;
  /** Stop the active Learn run (Free world). */
  stopLearnRun: () => void;
  /** Press the open mission panel's main, Forge, or Later button. */
  missionAction: (action: MissionAction) => void;
  /** Press one control from the current mission panel snapshot. */
  missionControl: (index: number) => void;
  /** Set the open mission's difficulty tier (1-3); persists per mission. */
  setMissionTier: (tier: number) => void;
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
  /** The new-player setup's "meet Kip" scene (runtime/world.ts ONBS): `pile` paints the shirt `hex` and lays Kip out as a pile of bricks, `build` carries them to their seats, `end` puts Kip back as he was. */
  onbStage: (op: "hide" | "pile" | "build" | "abort" | "end" | "phonesShow" | "phones" | "phonesOff", hex?: string) => void;
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
  /** Load a toyventor.level/1 object into the editor and open it (Feature 3 room-photo levels). */
  openEditorWithLevel: (level: unknown) => boolean;
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
  /** Back to the main menu from the world. False when something is mid-way (the editor, a driven mission, a sleep) and the world stays where it is. */
  goTitle: () => boolean;
  /** True while the world is still on its title (the main menu is up): boot waits there when `createEngine` was given `title: true`. */
  isTitle: () => boolean;
  /** Quiet the engine's background music when the calm Sleep Curtain fades in. */
  muteSound: () => void;
  /** Stock blueprints, forged tools, and Garden river position for Demo Mode v1 without mutating earned XP. */
  seedDemoSave?: () => void;
  /** Dispose the runtime, destroying its WebGL context. */
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
  ma?: Record<string, number>;
  me?: Record<string, number>;
  lastWin?: {
    key: string;
    tier?: number;
    attempts: number;
    error: number;
    stats?: string[];
    at: number;
  };
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
  playSeed?: (code?: string, theme?: string, opts?: SeedOptions) => string | null;
  buildSummary?: () => BuildSummary;
  setLoanKeys?: (active: string[], known: string[]) => void;
  partyDanceStart?: (source: BeatSource) => boolean;
  partyAddClips?: (clips: Record<string, BakedClip>) => void;
  partyDanceStop?: () => void;
  partyMusicDuck?: (on: boolean) => void;
  portraitSig?: () => string | null;
  capturePortrait?: (size: number) => ToyPortrait | null;
  worldName?: (id: string) => string;
  start?: (build: boolean) => void;
  goTitle?: () => boolean;
  open?: () => void;
  close?: () => void;
  seedDemo?: () => void;
  setTier?: (tier: number) => void;
  setZoom?: (zoom: number) => void;
  setPaused?: (paused: boolean) => void;
  mute?: () => void;
  startLearnRun?: (track: string, plan: number[], kidMode: boolean) => void;
  stopLearnRun?: () => void;
  learnState?: () => { run: LearnSnapshot | null; finished: number };
  /** Stamped mission-panel snapshot, served without touching the DOM. */
  mpSnap?: () => RawMissionPanelSnapshot;
  /** Press stamped mission control i (honors its disabled flag). */
  mpPress?: (index: number) => void;
  /** Mission primary action without synthetic clicks. */
  mpAct?: (action: MissionAction) => void;
  /** Live customizer snapshot, served without touching the DOM. */
  cuSnap?: () => RawCustomizerSnapshot;
  /** Customizer actions without synthetic clicks. */
  cuAct?: (action: FactoryAction) => void;
  cuType?: (toyType: string) => void;
  cuSlot?: (slot: string) => void;
  cuPart?: (partId: string) => void;
  cuZone?: (zone: PaintZone) => void;
  cuPaint?: (color: string) => void;
  onbStage?: (op: string, hex?: string) => void;
  cuForgeTool?: (toolId: string) => void;
  cuPrintTool?: (toolId: string) => void;
  cr?: {
    enter?: () => void;
    make?: (text: string) => void;
    exit?: () => void;
    R?: () => unknown;
    CR?: { busy?: boolean; code?: boolean };
  };
  /** Live editor snapshot, served without touching the DOM. */
  edSnap?: () => RawEditorSnapshot;
  /** Editor actions without synthetic clicks. */
  edUndo?: () => void;
  edRedo?: () => void;
  edZoomBy?: (factor: number) => void;
  edExport?: () => void;
  edImport?: () => void;
  edSetName?: (name: string) => void;
  edSetTheme?: (theme: string) => void;
  edNew?: (value: string) => void;
  edSetTab?: (tab: string) => void;
  edArm?: (index: number) => void;
  edControl?: (index: number) => void;
  edNudge?: (direction: number) => void;
  edDelete?: () => void;
  edDoneSel?: () => void;
  edSetHide?: (value: string) => void;
  edSetPart?: (value: string) => void;
  edSetIoText?: (text: string) => void;
  edIoCopy?: () => void;
  edIoLoad?: () => void;
  edLoad?: (level: unknown) => boolean;
  edIoClose?: () => void;
  edFromTitle?: () => void;
  /** Live create snapshot, served without touching the DOM. */
  crSnap?: () => RawCreateSnapshot;
  /** Create actions without synthetic clicks. */
  crSubmit?: (text: string) => void;
  crSetInput?: (text: string) => void;
  crUndo?: () => void;
  crKeep?: () => void;
  crPlay?: () => void;
  crCodeToggle?: () => void;
  crMicStart?: () => void;
  crWish?: (id: string) => void;
  crUnlook?: () => void;
  crFromTitle?: () => void;
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


/**
 * Host the native runtime in `hostEl` and talk to it through this
 * handle. Safe under StrictMode double-mounting: dispose tears down
 * the WebGL context, and a fresh createEngine remounts cleanly.
 */
export function createEngine(
  hostEl: HTMLElement,
  events: EngineEvents,
  initial: { contract: ToyContract | null; title?: boolean },
): EngineHandle {
  let disposed = false;
  let ready = false;
  let pendingWorld: WorldId | null = null;
  let pendingCustomizer: "build" | "forge" | null = null;
  let pendingPanel: "create" | "editor" | null = null;
  let pendingLevel: unknown = null;
  let lastWorld = "";
  let lastZoom = -1;
  let lastFound = new Set<string>();
  let lastMissionsDone = new Set<string>();
  let lastMission: string | null | undefined;
  let lastToast = "";
  let lastLearnJson = "null";
  let lastLearnFinished = 0;
  let lastCustomizer = closedCustomizerSnapshot;
  let lastMissionPanel = closedMissionPanelSnapshot;
  let lastCreate = closedCreateSnapshot;
  let lastEditor = closedEditorSnapshot;
  let lastWinAt = -1;

  let runtime: ReturnType<typeof createWorldRuntime> | null = null;
  const hooks = (): LegacyHooks | null => (runtime as unknown as LegacyHooks | null) ?? null;
  const doc = (): HTMLElement | null => hostEl;
  const hostCtrl = new AbortController();
  let boundDoc: HTMLElement | null = null;
  let notifyQueued = false;
  const schedulePoll = () => {
    if (disposed || notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => { notifyQueued = false; poll(); });
  };

  const load = (contract: ToyContract | null) => {
    runtime?.setToy(contract);
  };


  // Stage clicks/keys can change runtime state between notify() calls
  // (tool belt, tray, pickup card); re-sync snapshots after them.
  const bindHostSync = () => {
    const host = doc();
    if (!host || disposed) return;
    if (boundDoc !== host) {
      boundDoc = host;
      const syncSoon = () => schedulePoll();
      host.addEventListener("click", syncSoon, {
        passive: true,
        signal: hostCtrl.signal,
      });
      host.addEventListener("keyup", syncSoon, {
        passive: true,
        signal: hostCtrl.signal,
      });
    }
  };

  // Native mission read (5A-U1): the runtime stamps snapshot data at render
  // time, so there is nothing to scrape from the hidden #mp sheet.
  const readMissionPanel = (): MissionPanelSnapshot => {
    const snap = hooks()?.mpSnap?.();
    return normalizeMissionPanelSnapshot(snap ?? undefined);
  };

  // Native create read (5A-U1 slice R): the runtime serves the same
  // snapshot from live state, so there is nothing left to scrape.
  const readCreate = (): CreateSnapshot => {
    const snap = hooks()?.crSnap?.();
    return normalizeCreateSnapshot(snap ?? undefined);
  };

  function openCreateNow() {
    if (disposed) return;
    const api = hooks();
    if (!ready || !api?.cr) {
      pendingPanel = "create";
      return;
    }
    if (api.ed?.ED?.on && !api.ed.ED.kid) api.ed.exit?.();
    if (api.P?.title) api.crFromTitle?.();
    else if (!api.crSnap?.()?.open) api.cr.enter?.();
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
    if (api.P?.title) api.edFromTitle?.();
    else if (!api.ed.ED?.on) {
      if (api.ed.ED) api.ed.ED.kid = false;
      api.ed.enter?.();
    }
    poll();
  }

  // Native editor read (5A-U1 slice E): the runtime serves the same
  // snapshot from live state, so there is nothing left to scrape.
  const readEditor = (): EditorSnapshot => {
    const snap = hooks()?.edSnap?.();
    return normalizeEditorSnapshot(snap ?? undefined);
  };

  // Native customizer read (5A-U1 slice C): the runtime serves the same
  // snapshot from live state, so there is nothing left to scrape.
  const readCustomizer = (save: LegacySave): CustomizerSnapshot => {
    const snap = hooks()?.cuSnap?.();
    return normalizeCustomizerSnapshot({ ...snap, scrap: save.scrap });
  };

  function openCustomizerNow(mode: "build" | "forge" = "build") {
    if (disposed) return;
    const api = hooks();
    if (!ready || !api) {
      pendingCustomizer = mode;
      return;
    }
    bindHostSync();
    if (api.P?.title) api.start?.(true);
    else if (!api.cuSnap?.()?.open) api.open?.();
    if (mode === "forge" && !api.cuSnap?.()?.forge) api.cuAct?.("forge");
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
    bindHostSync();
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
      // Ignore wins recorded before this mount so reloads never re-award XP.
      lastWinAt = save.lastWin?.at ?? -1;
      if (lastFound.size > 0) {
        events.onEvent({
          type: "found",
          keys: [],
          total: lastFound.size,
          all: [...lastFound],
        });
      }
      if (lastMissionsDone.size > 0) {
        events.onEvent({
          type: "missionsDone",
          keys: [],
          total: lastMissionsDone.size,
          all: [...lastMissionsDone],
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
        else {
          if (pendingLevel != null) {
            api.edLoad?.(pendingLevel);
            pendingLevel = null;
          }
          openEditorNow();
        }
      }
    }
    if (typeof save.world === "string" && save.world !== lastWorld) {
      lastWorld = save.world;
      const fixed = WORLDS.some((w) => w.id === save.world);
      const name = fixed ? undefined : api.worldName?.(save.world);
      events.onEvent(name ? { type: "world", world: save.world, name } : { type: "world", world: save.world });
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
      events.onEvent({
        type: "found",
        keys: fresh,
        total: foundKeys.size,
        all: [...foundKeys],
      });
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
        all: [...mdoneKeys],
      });
    }
    lastMissionsDone = mdoneKeys;

    const win = save.lastWin;
    if (win && win.at !== lastWinAt) {
      lastWinAt = win.at;
      if (ready) {
        events.onEvent({
          type: "missionSolved",
          detail: {
            key: win.key,
            tier: win.tier === 2 || win.tier === 3 ? win.tier : 1,
            attempts: Math.max(1, Math.floor(win.attempts) || 1),
            error: typeof win.error === "number" ? win.error : 0,
            ...(Array.isArray(win.stats)
              ? {
                  stats: win.stats.filter(
                    (s): s is string => typeof s === "string",
                  ),
                }
              : {}),
          },
        });
      }
    }

    const host = doc();
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
    const toastEl = host?.querySelector<HTMLElement>("#toast");
    const toast =
      toastEl && toastEl.classList.contains("on") ? (toastEl.textContent ?? "").trim() : "";
    if (toast && toast !== lastToast) {
      events.onEvent({ type: "toast", text: toast });
    }
    lastToast = toast;

    const learnState = hooks()?.learnState?.();
    if (learnState) {
      const learnJson = JSON.stringify(learnState.run);
      if (learnJson !== lastLearnJson) {
        lastLearnJson = learnJson;
        events.onEvent({ type: "learn", learn: learnState.run });
      }
      if (learnState.finished !== lastLearnFinished) {
        lastLearnFinished = learnState.finished;
        if (ready) events.onEvent({ type: "learnFinished" });
      }
    }

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
  runtime = createWorldRuntime(hostEl, {
    contract: initial.contract,
    onNotify: schedulePoll,
    title: initial.title,
  });
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
    playSeed: (code, theme, opts) => {
      if (disposed) return null;
      return hooks()?.playSeed?.(code, theme, opts) ?? null;
    },
    buildSummary: () => (disposed ? null : (hooks()?.buildSummary?.() ?? null)),
    setLoanKeys: (active, known) => {
      if (!disposed) hooks()?.setLoanKeys?.(active, known);
    },
    partyDanceStart: (source) => (disposed ? false : (hooks()?.partyDanceStart?.(source) ?? false)),
    partyAddClips: (clips) => {
      if (!disposed) hooks()?.partyAddClips?.(clips);
    },
    partyDanceStop: () => {
      if (!disposed) hooks()?.partyDanceStop?.();
    },
    partyMusicDuck: (on) => {
      if (!disposed) hooks()?.partyMusicDuck?.(on);
    },
    portraitSig: () => (disposed ? null : (hooks()?.portraitSig?.() ?? null)),
    capturePortrait: (size = PORTRAIT_PX) =>
      disposed ? null : (hooks()?.capturePortrait?.(size) ?? null),
    setZoom: (target) => {
      hooks()?.setZoom?.(target);
      poll();
    },
    setPaused: (paused) => {
      hooks()?.setPaused?.(paused);
    },
    startLearnRun: (track, plan, kidMode) => {
      hooks()?.startLearnRun?.(track, plan, kidMode);
      poll();
    },
    stopLearnRun: () => {
      hooks()?.stopLearnRun?.();
      poll();
    },
    missionAction: (action) => {
      bindHostSync();
      hooks()?.mpAct?.(action);
      poll();
    },
    missionControl: (index) => {
      hooks()?.mpPress?.(index);
      poll();
    },
    setMissionTier: (tier) => {
      hooks()?.setTier?.(tier);
      poll();
    },
    openCustomizer: (mode = "build") => {
      openCustomizerNow(mode);
    },
    closeCustomizer: () => {
      closeCustomizerNow();
    },
    setToyType: (toyType) => {
      hooks()?.cuType?.(toyType);
      poll();
    },
    selectSlot: (slot) => {
      hooks()?.cuSlot?.(slot);
      poll();
    },
    selectPart: (partId) => {
      hooks()?.cuPart?.(partId);
      poll();
    },
    setPaintZone: (zone) => {
      hooks()?.cuZone?.(zone);
      poll();
    },
    setPaint: (color) => {
      hooks()?.cuPaint?.(color);
      poll();
    },
    onbStage: (op, hex) => {
      hooks()?.onbStage?.(op, hex);
    },
    factoryAction: (action) => {
      if (action === "done") {
        closeCustomizerNow();
        return;
      }
      hooks()?.cuAct?.(action);
      poll();
    },
    forgeTool: (toolId) => {
      hooks()?.cuForgeTool?.(toolId);
      poll();
    },
    printTool: (toolId) => {
      hooks()?.cuPrintTool?.(toolId);
      poll();
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
      hooks()?.crSetInput?.(text);
    },
    createMake: (text) => {
      if (disposed || !text.trim()) return;
      hooks()?.crSubmit?.(text);
      poll();
    },
    createAction: (action) => {
      const api = hooks();
      if (action === "undo") api?.crUndo?.();
      else if (action === "keep") api?.crKeep?.();
      else if (action === "play") api?.crPlay?.();
      else if (action === "code") api?.crCodeToggle?.();
      else if (action === "unlook") api?.crUnlook?.();
      else if (typeof action === "string" && action.startsWith("wish:")) api?.crWish?.(action.slice(5));
      else api?.crMicStart?.();
      poll();
    },
    openEditor: () => {
      openEditorNow();
    },
    openEditorWithLevel: (level) => {
      if (disposed) return false;
      const api = hooks();
      if (!ready || !api?.edLoad) {
        pendingLevel = level;
        pendingPanel = "editor";
        return true; // queued; edLoad validates on flush
      }
      const ok = api.edLoad(level);
      if (ok) openEditorNow();
      poll();
      return ok;
    },
    closeEditor: () => {
      if (disposed) return;
      pendingPanel = null;
      pendingLevel = null;
      hooks()?.ed?.exit?.();
      poll();
    },
    editorAction: (action) => {
      const api = hooks();
      if (action === "play") api?.ed?.play?.();
      else if (action === "back") api?.ed?.back?.();
      else if (action === "undo") api?.edUndo?.();
      else if (action === "redo") api?.edRedo?.();
      else if (action === "zoomIn") api?.edZoomBy?.(0.8);
      else if (action === "zoomOut") api?.edZoomBy?.(1.25);
      else if (action === "export") api?.edExport?.();
      else api?.edImport?.();
      poll();
    },
    setEditorName: (name) => {
      hooks()?.edSetName?.(name);
      poll();
    },
    setEditorTheme: (theme) => {
      hooks()?.edSetTheme?.(theme);
      poll();
    },
    editorNew: (value) => {
      if (value) {
        hooks()?.edNew?.(value);
        poll();
      }
    },
    setEditorTab: (tab) => {
      hooks()?.edSetTab?.(tab);
      poll();
    },
    editorPalette: (index) => {
      hooks()?.edArm?.(index);
      poll();
    },
    editorControl: (index) => {
      hooks()?.edControl?.(index);
      poll();
    },
    setEditorSelect: (index, value) => {
      if (index === 0) hooks()?.edSetHide?.(value);
      else hooks()?.edSetPart?.(value);
      poll();
    },
    setEditorIoText: (text) => {
      hooks()?.edSetIoText?.(text);
    },
    editorIoAction: (action) => {
      const api = hooks();
      if (action === "copy") api?.edIoCopy?.();
      else if (action === "load") api?.edIoLoad?.();
      else api?.edIoClose?.();
      poll();
    },
    start: () => {
      hooks()?.start?.(false);
    },
    goTitle: () => !disposed && hooks()?.goTitle?.() === true,
    isTitle: () => !disposed && Boolean(hooks()?.P?.title),
    muteSound: () => {
      hooks()?.mute?.();
    },
    seedDemoSave: () => {
      hooks()?.seedDemo?.();
      poll();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      hostCtrl.abort();
      runtime?.dispose();
      runtime = null;
    },
  };
}
