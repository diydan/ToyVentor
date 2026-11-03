import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Placement } from "../../../../shared/build";
import { buildSignature } from "../../../../shared/reveal";
import { isBuiltInToy, type Toy } from "../../../../shared/toy";
import { loadToyPortrait, PORTRAIT_PX, saveToyPortrait } from "../../../lib/toyPortrait";
import {
  completeGarage,
  GARAGE_DROPS,
  GARAGE_GRACE_MS,
  garageGraceLeftMs,
  garageStatus,
  loanKeys,
  missionDone,
  missionParts,
  type BuildSummary,
  type GarageGoal,
  type GoalPart,
} from "../../../lib/garage";
import {
  loadGaragePreview,
  loadGraceUsedMs,
  saveGaragePreview,
  saveGraceUsedMs,
} from "../../../lib/garageDevice";
import {
  loadTimeOfDayMode,
  saveTimeOfDayMode,
  timeOfDayFor,
  type TimeOfDayMode,
} from "../../../lib/timeOfDay";
import type { ToyContract } from "../../../../shared/toycontract";
import { revealForBuild } from "../../../state/reveals";
import { buildStats } from "../../../../shared/build";
import { localDay } from "../../../../shared/parent-time";
import { partsById } from "../../../lib/catalog";
import {
  applyDailyQuestProgress,
  completeRealLifeChore,
  dailyQuestsForDay,
  toggleChoreEnabled,
} from "../../../lib/dailyQuests";
import { loadDemoMode, saveDemoMode } from "../../../lib/demoMode";
import {
  getLocalParentSnapshot,
  pullParentTime,
  recordPlayProgress,
  type ParentSnapshot,
} from "../../../lib/parentTime";
import {
  labWorldForEntry,
  type LockedVehicleCard,
} from "../../../lib/vehicleReadiness";
import {
  applySolve,
  familyStars,
  grandfatherToyIds,
  loadProgression,
  markExplorerSeen,
  markExplorerVisited,
  mergeProgression,
  MISSION_STAT,
  missionTypeOf,
  nextRankProgress,
  pullProgression,
  pushProgression,
  resetProgression,
  runCarouselImportOnce,
  saveProgression,
  type MissionType,
  type ProgressionState,
  type Tier,
} from "../../../lib/progression";
import { LivePlayPanel, type LivePlayStatus } from "../../liveplay/LivePlayPanel";
import { propLangLabel } from "../../../lib/propSpeech";
import { LanguageSheet, usePropLang } from "./LanguageSheet";
import { CreatePanel } from "./CreatePanel";
import { EditorPanel } from "./EditorPanel";
import {
  createEngine,
  createWorldStore,
  worldUrlFor,
  WORLDS,
  type EngineHandle,
} from "./engine";
import { GarageGoalChip } from "./GarageGoalChip";
import { GarageSheet } from "./GarageSheet";
import { GrownUpsSheet } from "./GrownUpsSheet";
import { composeRoomPhotoLevel } from "./runtime/roomPhoto";
import { buildExplorerGraph, defaultMapView } from "../../../lib/explorerMap";
import { planFor } from "../../../lib/learn";
import { buildMapCards } from "../../../lib/mapCards";
import { ExplorerMap } from "./ExplorerMap";
import { MapCarousel } from "./MapCarousel";
import { MissionPanel } from "./MissionPanel";
import { MyToySheet } from "./MyToySheet";
import { isPackClaimedToday, PackOverlay } from "./PackOverlay";
import { RevealOverlay } from "./RevealOverlay";
import { SleepCurtain } from "./SleepCurtain";
import { ToyCustomizer } from "./ToyCustomizer";
import { ToyMiniIcon } from "./ToyMiniIcon";

/** Every part any drop ever loans, so a part from a past weekend is taken back on Monday. */
const KNOWN_LOANERS: string[] = GARAGE_DROPS.flatMap(loanKeys);

/** A Garage mission in progress: what to do, and the build it started from. */
interface GarageMission {
  weekendKey: string;
  title: string;
  brief: string;
  goal: GarageGoal;
  baseline: BuildSummary;
  /** Demo Mode's Preview weekend: the flow runs, but nothing is saved or paid. */
  preview: boolean;
}

export type InitialOverlay =
  | "toy"
  | "scan"
  | "build"
  | "pack"
  | "reveal"
  | "parent"
  | null;

export interface GameCanvasProps {
  toy: Toy;
  toyIds?: readonly string[];
  placements: Placement[];
  onPlacementsChange: (next: Placement[]) => void;
  onSkinChange?: () => void;
  contract: ToyContract | null;
  toyName?: string;
  toyColor?: string;
  statSummary?: string;
  themeSignature?: string;
  kipUrl?: string;
  initialOverlay?: InitialOverlay;
}

/**
 * Full-bleed single-stage host for ToyVentor World.
 * The 3D Three.js stage runs full-height underneath a 390 px non-scrolling
 * top dock ([Toy ▾], Build, Create, Pack, ⋯) and at most one active sheet/modal.
 */
export function GameCanvas({
  toy,
  toyIds,
  placements,
  onPlacementsChange,
  onSkinChange,
  contract,
  toyName,
  toyColor = "#52b7ff",
  statSummary,
  themeSignature,
  kipUrl,
  initialOverlay = null,
}: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageHostRef = useRef<HTMLDivElement>(null);
  const moreWrapRef = useRef<HTMLDivElement>(null);
  const worldsWrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const contractRef = useRef(contract);
  contractRef.current = contract;
  const [store] = useState(createWorldStore);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const toyUrl = useMemo(() => worldUrlFor(contract), [contract]);
  const firstToy = useRef(true);
  const pendingEngineOpenRef = useRef<"build" | "create" | "editor" | null>(
    initialOverlay === "build" ? "build" : null,
  );

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toySheetOpen, setToySheetOpen] = useState(
    initialOverlay === "toy" || initialOverlay === "scan",
  );
  const [toySheetStep, setToySheetStep] = useState<"shelf" | "scan">(
    initialOverlay === "scan" ? "scan" : "shelf",
  );
  const [packOpen, setPackOpen] = useState(initialOverlay === "pack");
  const [packClaimed, setPackClaimed] = useState(() => isPackClaimedToday());
  const [revealState, setRevealState] = useState<{ first: boolean } | null>(
    initialOverlay === "reveal" ? { first: false } : null,
  );
  const [moodsOpen, setMoodsOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const propLang = usePropLang();
  const [liveStatus, setLiveStatus] = useState<LivePlayStatus>({
    playing: false,
    listening: false,
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapView, setMapView] = useState<"cards" | "trail">("cards");
  const [worldsOpen, setWorldsOpen] = useState(false);
  const [demoMode, setDemoMode] = useState<boolean>(() => loadDemoMode());
  const [skinTick, setSkinTick] = useState(0);
  const [grownUpsOpen, setGrownUpsOpen] = useState(initialOverlay === "parent");
  const [grownUpsHoldSatisfied, setGrownUpsHoldSatisfied] = useState(false);
  const [gearHoldPct, setGearHoldPct] = useState(0);
  const gearHoldRafRef = useRef<number | null>(null);
  const gearHoldTimerRef = useRef<number | null>(null);
  const gearHoldStartRef = useRef(0);
  const gearHoldingRef = useRef(false);
  const gearLongPressFiredRef = useRef(false);
  const [parentSnapshot, setParentSnapshot] = useState<ParentSnapshot>(() =>
    getLocalParentSnapshot(),
  );
  const [missionGraceUntil, setMissionGraceUntil] = useState(0);
  const prevLockedRef = useRef(parentSnapshot.status.locked);
  const [progression, setProgression] = useState<ProgressionState>(() => {
    const loaded = loadProgression();
    const imported = runCarouselImportOnce(loaded);
    if (imported !== loaded) saveProgression(imported);
    return imported;
  });
  const progressionRef = useRef(progression);
  progressionRef.current = progression;
  const placementsRef = useRef(placements);
  placementsRef.current = placements;
  const [xpToast, setXpToast] = useState<string | null>(null);
  const xpToastTimerRef = useRef<number | null>(null);

  const showXpToast = useCallback((text: string) => {
    setXpToast(text);
    if (xpToastTimerRef.current !== null) {
      window.clearTimeout(xpToastTimerRef.current);
    }
    xpToastTimerRef.current = window.setTimeout(() => setXpToast(null), 4000);
  }, []);

  // Walking to a trail-map node reveals it (gentle fog) for next time.
  const visitExplorerNode = useCallback((nodeId: string) => {
    const { next, changed } = markExplorerVisited(
      progressionRef.current,
      nodeId,
    );
    if (!changed) return;
    saveProgression(next);
    setProgression(next);
    void pushProgression(next);
  }, []);

  // The trail map records what it showed, so the next open animates only
  // what is new since then.
  const recordExplorerSeen = useCallback((entries: string[]) => {
    const { next, changed } = markExplorerSeen(progressionRef.current, entries);
    if (!changed) return;
    saveProgression(next);
    setProgression(next);
    void pushProgression(next);
  }, []);

  // The map's character token is a picture of the toy as it is dressed right
  // now, taken from the live 3D rig and kept on the device per outfit. Built-in
  // toys only: a scanned toy keeps its own photo cut-out, because the rig in the
  // world is not that toy. Until the rig has loaded (or when it cannot be taken)
  // the token falls back to the toy's plain icon.
  const [portrait, setPortrait] = useState<string | null>(null);
  // The map follows the clock (day or night) unless a grown-up pinned a look.
  const [todMode, setTodMode] = useState<TimeOfDayMode>(() => loadTimeOfDayMode());
  // The Garage: its sheet, the mission in progress (if any) and how it is going.
  const [garageOpen, setGarageOpen] = useState(false);
  const [garagePreview, setGaragePreview] = useState<boolean>(() => loadGaragePreview());
  const [garageMission, setGarageMission] = useState<GarageMission | null>(null);
  const [garageParts, setGarageParts] = useState<GoalPart[]>([]);
  const [garageDoneNow, setGarageDoneNow] = useState(false);
  const [garageReward, setGarageReward] = useState<string | null>(null);
  const [garageGraceUsed, setGarageGraceUsed] = useState(0);
  const garageCompletingRef = useRef(false);
  const garageMissionRef = useRef<GarageMission | null>(null);
  garageMissionRef.current = garageMission;
  const toyRef = useRef(toy);
  toyRef.current = toy;
  const refreshPortrait = useCallback(() => {
    const api = engineRef.current;
    const t = toyRef.current;
    const sig = api?.portraitSig() ?? null;
    if (!api || !sig || !isBuiltInToy(t)) {
      setPortrait(null);
      return;
    }
    const kept = loadToyPortrait(t.id, sig);
    if (kept) {
      setPortrait(kept);
      return;
    }
    const shot = api.capturePortrait(PORTRAIT_PX);
    if (shot && shot.toyId === t.id) {
      saveToyPortrait(shot);
      setPortrait(shot.url);
    } else {
      setPortrait(null);
    }
  }, []);

  // The Map opens in the view that suits the player's age: the carousel for
  // the youngest (and an unset age), the trail map from the 7-9 band up.
  // Each is one tap from the other.
  const openMap = useCallback(() => {
    refreshPortrait();
    setMapView(defaultMapView(progressionRef.current.ageBand));
    setMapOpen(true);
  }, [refreshPortrait]);

  // Sync Play Time settings + today's ledger on boot.
  useEffect(() => {
    void pullParentTime().then(setParentSnapshot);
  }, []);

  // Grandfather every currently selectable toy into the permanent unlock set
  // (Decision 6). Single writer in GameCanvas avoids clobbering XP state.
  useEffect(() => {
    if (!toyIds || toyIds.length === 0) return;
    const { next, changed } = grandfatherToyIds(progressionRef.current, toyIds);
    if (changed) {
      saveProgression(next);
      setProgression(next);
      void pushProgression(next);
    }
  }, [toyIds]);

  // Pull synced progression once on boot and merge without losing stars.
  useEffect(() => {
    void (async () => {
      const remote = await pullProgression();
      if (!remote) return;
      const merged = mergeProgression(progressionRef.current, remote);
      saveProgression(merged);
      setProgression(merged);
    })();
  }, []);

  // Create the engine once per mount; dispose on unmount and on HMR.
  useEffect(() => {
    const host = stageHostRef.current;
    if (!host) return;
    const engine = createEngine(
      host,
      {
        onEvent: (event) => {
          store.apply(event);
          if (event.type === "missionsDone" && event.keys.length > 0) {
            void recordPlayProgress({ completedMissionIds: event.keys }).then(
              ({ snapshot }) => setParentSnapshot(snapshot),
            );
          }
          if (event.type === "learnFinished") {
            openMap();
          }
          if (event.type === "missionSolved") {
            const { key, attempts, error, stats, tier: solvedTier } =
              event.detail;
            const type = missionTypeOf(key) as MissionType;
            const stat = MISSION_STAT[type];
            const totals = buildStats(placementsRef.current, partsById).statTotals;
            const stageHasStat = Boolean(stat && stats?.includes(stat));
            const partMatch = stat
              ? (totals[stat] ?? 0) > 0 || stageHasStat
              : false;
            const timezone = getLocalParentSnapshot().settings.timezone;
            const solveInput = {
              missionId: key,
              tier: (solvedTier === 2 || solvedTier === 3 ? solvedTier : 1) as Tier,
              attempts,
              clean: error === 0,
              partMatch,
              day: localDay(Date.now(), timezone),
            };
            const prevProg = progressionRef.current;
            const result = applySolve(prevProg, solveInput);
            const questEval = applyDailyQuestProgress(
              prevProg,
              result.next,
              solveInput,
              result.stars,
            );
            saveProgression(questEval.next);
            setProgression(questEval.next);
            void pushProgression(questEval.next);
            const totalGain = result.awarded + questEval.questXpAwarded;
            const starsStr = `${"★".repeat(result.stars)}${"☆".repeat(3 - result.stars)}`;
            const notes: string[] = [];
            if (questEval.completedQuests.length > 0) {
              notes.push(
                questEval.completedQuests.length === 1
                  ? "Daily Job"
                  : `${questEval.completedQuests.length} Daily Jobs`,
              );
            }
            if (questEval.upgradedBadges[0]) {
              notes.push(
                `${questEval.upgradedBadges[0].shortLabel} ${questEval.upgradedBadges[0].tierLabel}`,
              );
            }
            const suffix = notes.length > 0 ? ` · ${notes.join(" · ")}` : "";
            if (totalGain > 0) {
              showXpToast(`+${totalGain} XP · ${starsStr}${suffix}`);
            } else if (result.stars > 0) {
              showXpToast(`${starsStr}${suffix}`);
            }
          }
        },
      },
      { contract: contractRef.current },
    );
    engineRef.current = engine;
    if (import.meta.hot) {
      import.meta.hot.dispose(() => engine.dispose());
    }
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [store, openMap]);

  // Active-play 5-second heartbeat (paused while backgrounded, locked, or in Grown-ups).
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const cur = getLocalParentSnapshot();
      if (grownUpsOpen || cur.status.locked) {
        setParentSnapshot(cur);
        return;
      }
      void recordPlayProgress({ activeSecondsDelta: 5 }).then(({ snapshot }) =>
        setParentSnapshot(snapshot),
      );
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [grownUpsOpen]);

  // Honor queued Build/Create/Editor open once the stage reports ready.
  useEffect(() => {
    if (!state.ready || !pendingEngineOpenRef.current) return;
    const target = pendingEngineOpenRef.current;
    pendingEngineOpenRef.current = null;
    if (target === "build") engineRef.current?.openCustomizer("build");
    else if (target === "create") engineRef.current?.openCreate();
    else if (target === "editor") engineRef.current?.openEditor();
  }, [state.ready]);

  // Reload the 3D world toy whenever the ToyContract changes.
  useEffect(() => {
    if (firstToy.current) {
      firstToy.current = false;
      return;
    }
    engineRef.current?.setToy(contract);
  }, [toyUrl, contract]);

  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === hostRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const customizer = state.customizer;
  const missionPanel = state.missionPanel;
  const create = state.create;
  const editor = state.editor;
  const anyGameSheetOpen =
    customizer.open || missionPanel.open || create.open || editor.open;

  // Enforce at most one active overlay at a time when an engine sheet opens.
  useEffect(() => {
    if (!anyGameSheetOpen) return;
    setToySheetOpen(false);
    setPackOpen(false);
    setRevealState(null);
    setMoodsOpen(false);
    setMoreOpen(false);
    setGrownUpsOpen(false);
    setGarageOpen(false);
  }, [anyGameSheetOpen]);

  // Grant up to 25s of calm mid-mission grace if time runs out mid-lab/bridge/lift.
  useEffect(() => {
    const wasLocked = prevLockedRef.current;
    const nowLocked = parentSnapshot.status.locked;
    prevLockedRef.current = nowLocked;

    if (
      !wasLocked &&
      nowLocked &&
      missionPanel.open &&
      parentSnapshot.status.reason !== "quiet_hours"
    ) {
      setMissionGraceUntil(Date.now() + 25_000);
    } else if (!nowLocked || !missionPanel.open) {
      setMissionGraceUntil(0);
    }
  }, [
    missionPanel.open,
    parentSnapshot.status.locked,
    parentSnapshot.status.reason,
  ]);

  useEffect(() => {
    if (missionGraceUntil <= 0) return;
    const ms = Math.max(50, missionGraceUntil - Date.now() + 25);
    const id = window.setTimeout(() => setMissionGraceUntil(0), ms);
    return () => window.clearTimeout(id);
  }, [missionGraceUntil]);

  const missionGraceActive =
    missionGraceUntil > Date.now() &&
    missionPanel.open &&
    parentSnapshot.status.reason !== "quiet_hours";

  // The Garage's state for today (weekend or not, this weekend's drop, done or not).
  const garage = garageStatus({
    dayKey: localDay(Date.now(), parentSnapshot.settings.timezone),
    ageBand: progression.ageBand ?? null,
    done: progression.garageDone,
    preview: demoMode && garagePreview,
  });
  const garageRef = useRef(garage);
  garageRef.current = garage;

  // Garage grace: a mission underway when today's limit runs out may finish,
  // for up to 10 minutes a weekend, never in quiet hours. Spent only while the
  // mission is unfinished and the limit is what has locked the toy.
  const garageLive = garageMission !== null && !garageDoneNow;
  const garageGraceTicking =
    garageLive &&
    parentSnapshot.status.locked &&
    parentSnapshot.status.reason !== "quiet_hours";
  const garageGraceActive = garageGraceTicking && garageGraceLeftMs(garageGraceUsed) > 0;
  const sleepActive = parentSnapshot.status.locked && !missionGraceActive && !garageGraceActive;

  useEffect(() => {
    setGarageGraceUsed(loadGraceUsedMs(garage.weekendKey));
  }, [garage.weekendKey]);

  useEffect(() => {
    if (!garageGraceTicking) return;
    const key = garageRef.current.weekendKey;
    let used = loadGraceUsedMs(key);
    const id = window.setInterval(() => {
      used = Math.min(used + 1000, GARAGE_GRACE_MS);
      saveGraceUsedMs(key, used);
      setGarageGraceUsed(used);
    }, 1000);
    return () => window.clearInterval(id);
  }, [garageGraceTicking]);

  // Close `⋯` or compact `Worlds` popover on outside pointerdown or Escape.
  useEffect(() => {
    if (!moreOpen && !worldsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (moreOpen && moreWrapRef.current && !moreWrapRef.current.contains(target)) {
        setMoreOpen(false);
      }
      if (worldsOpen && worldsWrapRef.current && !worldsWrapRef.current.contains(target)) {
        setWorldsOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        setWorldsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen, worldsOpen]);

  const engine = () => engineRef.current;

  const closeEngineSheets = useCallback(() => {
    if (customizer.open) engine()?.closeCustomizer();
    if (create.open) engine()?.closeCreate();
    if (editor.open) engine()?.closeEditor();
    if (missionPanel.open) engine()?.missionAction("later");
  }, [customizer.open, create.open, editor.open, missionPanel.open]);

  const closeReactOverlays = useCallback(() => {
    setMapOpen(false);
    setGarageOpen(false);
    setToySheetOpen(false);
    setPackOpen(false);
    setRevealState(null);
    setMoodsOpen(false);
    setLangOpen(false);
    setMoreOpen(false);
    setWorldsOpen(false);
    setGrownUpsOpen(false);
  }, []);

  const openGrownUps = useCallback(
    (holdDone = false) => {
      closeEngineSheets();
      closeReactOverlays();
      setParentSnapshot(getLocalParentSnapshot());
      setGrownUpsHoldSatisfied(holdDone);
      setGrownUpsOpen(true);
    },
    [closeEngineSheets, closeReactOverlays],
  );

  const cancelGearHold = useCallback(() => {
    gearHoldingRef.current = false;
    if (gearHoldRafRef.current !== null) {
      window.cancelAnimationFrame(gearHoldRafRef.current);
      gearHoldRafRef.current = null;
    }
    if (gearHoldTimerRef.current !== null) {
      window.clearTimeout(gearHoldTimerRef.current);
      gearHoldTimerRef.current = null;
    }
    setGearHoldPct(0);
  }, []);

  const startGearHold = useCallback(() => {
    if (gearHoldingRef.current) return;
    gearHoldingRef.current = true;
    gearLongPressFiredRef.current = false;
    gearHoldStartRef.current = performance.now();

    const completeHold = () => {
      if (!gearHoldingRef.current) return;
      cancelGearHold();
      gearLongPressFiredRef.current = true;
      openGrownUps(true);
    };

    gearHoldTimerRef.current = window.setTimeout(completeHold, 1200);

    const tick = (now: number) => {
      if (!gearHoldingRef.current) return;
      const pct = Math.min(1, (now - gearHoldStartRef.current) / 1200);
      setGearHoldPct(pct);
      if (pct >= 1) {
        completeHold();
        return;
      }
      gearHoldRafRef.current = window.requestAnimationFrame(tick);
    };
    gearHoldRafRef.current = window.requestAnimationFrame(tick);
  }, [cancelGearHold, openGrownUps]);

  useEffect(() => () => cancelGearHold(), [cancelGearHold]);

  const openEditorSheet = useCallback(() => {
    closeReactOverlays();
    if (customizer.open) engine()?.closeCustomizer();
    if (create.open) engine()?.closeCreate();
    if (editor.open) engine()?.closeEditor();
    else if (state.ready) engine()?.openEditor();
    else pendingEngineOpenRef.current = "editor";
  }, [closeReactOverlays, create.open, customizer.open, editor.open, state.ready]);

  const handleToggleDemoMode = useCallback((next: boolean) => {
    setDemoMode(next);
    saveDemoMode(next);
  }, []);

  // Calmly wind down audio, mic, and open kid sheets when the Sleep Curtain activates.
  useEffect(() => {
    if (!sleepActive) return;
    closeEngineSheets();
    setToySheetOpen(false);
    setPackOpen(false);
    setRevealState(null);
    setMoodsOpen(false);
    setMoreOpen(false);
    setWorldsOpen(false);
    setLiveStatus({ playing: false, listening: false });
    setMapOpen(false);
    setGarageOpen(false);
    setGarageMission(null);
    engine()?.stopLearnRun();
    engine()?.muteSound();
  }, [sleepActive, closeEngineSheets]);

  const openBuildSheet = useCallback(() => {
    closeReactOverlays();
    if (create.open) engine()?.closeCreate();
    if (editor.open) engine()?.closeEditor();
    if (state.ready) {
      engine()?.openCustomizer("build");
    } else {
      pendingEngineOpenRef.current = "build";
    }
  }, [closeReactOverlays, create.open, editor.open, state.ready]);

  const handleCloseBuild = useCallback(() => {
    engine()?.closeCustomizer();
    if (placements.length > 0) {
      const sig = buildSignature(placements);
      if (!revealForBuild(toy.id, sig)) {
        setRevealState({ first: true });
      }
    }
  }, [placements, toy.id]);

  const openGarage = useCallback(() => {
    closeEngineSheets();
    closeReactOverlays();
    setGarageOpen(true);
  }, [closeEngineSheets, closeReactOverlays]);

  const endGarageMission = useCallback(() => {
    setGarageMission(null);
    setGarageParts([]);
    setGarageDoneNow(false);
    setGarageReward(null);
    garageCompletingRef.current = false;
  }, []);

  // Start this weekend's drop: remember the build it starts from, open Build.
  const startGarageMission = useCallback(() => {
    const baseline = engineRef.current?.buildSummary() ?? null;
    if (!baseline) return;
    const { variant, weekendKey, preview } = garageRef.current;
    endGarageMission();
    setGarageMission({
      weekendKey,
      title: variant.title,
      brief: variant.brief,
      goal: variant.goal,
      baseline,
      preview,
    });
    setGarageParts(missionParts(variant.goal, baseline, baseline));
    closeEngineSheets();
    closeReactOverlays();
    engineRef.current?.openCustomizer("build");
  }, [closeEngineSheets, closeReactOverlays, endGarageMission]);

  const freeBuildFromGarage = useCallback(() => {
    endGarageMission();
    openBuildSheet();
  }, [endGarageMission, openBuildSheet]);

  // While a mission is on, look at the build a few times a second. A change of
  // toy type starts the mission over from the new toy. When the goal holds and
  // the child has changed something, pay out once.
  useEffect(() => {
    if (!garageMission || garageDoneNow || !state.ready) return;
    const id = window.setInterval(() => {
      const mission = garageMissionRef.current;
      const api = engineRef.current;
      if (!mission || !api || garageCompletingRef.current) return;
      const now = api.buildSummary();
      if (!now) return;
      if (now.type !== mission.baseline.type) {
        setGarageMission({ ...mission, baseline: now });
        return;
      }
      const parts = missionParts(mission.goal, now, mission.baseline);
      setGarageParts((prev) =>
        prev.length === parts.length && prev.every((p, i) => p.ok === parts[i]!.ok && p.label === parts[i]!.label)
          ? prev
          : parts,
      );
      if (!missionDone(mission.goal, now, mission.baseline)) return;

      garageCompletingRef.current = true;
      if (mission.preview) {
        // The preview weekend is a pretend weekend: it must not mark the real
        // one done, pay XP or credit play time.
        setGarageReward("Preview only. Nothing is saved.");
        setGarageDoneNow(true);
        return;
      }
      const dayKey = localDay(Date.now(), getLocalParentSnapshot().settings.timezone);
      const res = completeGarage(progressionRef.current, mission.weekendKey, dayKey);
      if (res.awarded <= 0) {
        // A replay (the weekend was already done): just for fun, nothing paid.
        setGarageDoneNow(true);
        return;
      }
      saveProgression(res.next);
      setProgression(res.next);
      void pushProgression(res.next);
      const rankNote =
        res.rankAfter.rank > res.rankBefore.rank
          ? ` · Rank ${res.rankAfter.rank}: ${res.rankAfter.title}`
          : "";
      // Credit the STEM mission first, so any minutes it earns land before the
      // chip flips to Done (a locked toy would otherwise flash the sleep curtain).
      const finish = (minutes: number) => {
        const minuteNote = minutes > 0 ? ` · +${minutes} min play time` : "";
        setGarageReward(`+${res.awarded} XP${minuteNote}${rankNote}`);
        setGarageDoneNow(true);
        showXpToast(`+${res.awarded} XP · Garage${minuteNote}${rankNote}`);
      };
      if (res.stemMissionId) {
        void recordPlayProgress({ completedMissionIds: [res.stemMissionId] })
          .then(({ snapshot, awardedMinutes }) => {
            setParentSnapshot(snapshot);
            finish(awardedMinutes);
          })
          .catch(() => finish(0));
      } else {
        finish(0);
      }
    }, 400);
    return () => window.clearInterval(id);
  }, [garageMission, garageDoneNow, state.ready, showXpToast]);

  // Weekend loaner parts: open to try on Friday to Sunday, taken back after.
  useEffect(() => {
    if (!state.ready) return;
    engineRef.current?.setLoanKeys(garage.isWeekend ? loanKeys(garage.drop) : [], KNOWN_LOANERS);
  }, [state.ready, garage.isWeekend, garage.drop]);

  const toggleFullscreen = () => {
    const host = hostRef.current as
      | (HTMLDivElement & {
          webkitRequestFullscreen?: () => Promise<void> | void;
        })
      | null;
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else if (host?.requestFullscreen) void host.requestFullscreen();
      else host?.webkitRequestFullscreen?.();
    } catch {
      // Fullscreen can be refused by browser policy; keep playing.
    }
  };

  const label = toyName || contract?.name || toy.name;
  const currentWorldEntry = WORLDS.find((w) => w.id === state.world) ?? {
    ...WORLDS[0],
    label: state.worldName ?? WORLDS[0].label,
  };
  const hasSavedCard = Boolean(
    themeSignature && revealForBuild(toy.id, themeSignature),
  );
  // Opening the Character Card for a build that has never had its Reveal is that build's one Reveal: the overlay saves the
  // card on mount, so without this it would be consumed silently with no entrance theme ("plays once, then saves").
  const characterCardIsFirst = () =>
    placements.length > 0 &&
    !revealForBuild(toy.id, buildSignature(placements));

  const moreAriaLabel = liveStatus.listening
    ? "More (microphone listening)"
    : liveStatus.playing
      ? "More (story music playing)"
      : "More";

  const gearAriaLabel = parentSnapshot.settings.enabled
    ? "Grown-up settings (Play Time active, hold 1.2s)"
    : demoMode
      ? "Grown-up settings (Demo Mode active, hold 1.2s)"
      : "Grown-up settings (hold 1.2s)";

  return (
    <div
      ref={hostRef}
      className={isFullscreen ? "tv-host tv-host-fullscreen" : "tv-host"}
    >
      <div className="tv-dock" role="toolbar" aria-label="ToyVentor World studio">
        <button
          type="button"
          className="tv-toy-pill"
          disabled={sleepActive}
          aria-label={`Toy Box: ${label} active`}
          aria-pressed={toySheetOpen}
          title={statSummary ? `${label} (${statSummary})` : label}
          onClick={() => {
            if (toySheetOpen) {
              setToySheetOpen(false);
              return;
            }
            closeEngineSheets();
            closeReactOverlays();
            setToySheetStep("shelf");
            setToySheetOpen(true);
          }}
        >
          <ToyMiniIcon
            toy={toy}
            accentColor={toyColor}
            skinVersion={skinTick}
          />
          <span className="tv-toy-pill-name">Toy Box</span>
          <span
            className="tv-rank-pip"
            title={nextRankProgress(progression.totalXp).rank.title}
            aria-label={`Rank ${nextRankProgress(progression.totalXp).rank.rank}: ${nextRankProgress(progression.totalXp).rank.title}`}
          >
            ★{nextRankProgress(progression.totalXp).rank.rank}
          </span>
          <span className="tv-toy-pill-caret" aria-hidden="true">
            ▾
          </span>
        </button>

        <div className="tv-dock-right">
          <button
            type="button"
            className="tv-ctl"
            disabled={sleepActive}
            aria-pressed={customizer.open}
            onClick={() => {
              if (customizer.open) {
                handleCloseBuild();
              } else {
                openBuildSheet();
              }
            }}
          >
            Build
          </button>

          <button
            type="button"
            className="tv-ctl tv-ctl-violet"
            disabled={sleepActive}
            aria-pressed={create.open}
            onClick={() => {
              if (create.open) {
                engine()?.closeCreate();
                return;
              }
              closeReactOverlays();
              if (customizer.open) engine()?.closeCustomizer();
              if (editor.open) engine()?.closeEditor();
              if (state.ready) engine()?.openCreate();
              else pendingEngineOpenRef.current = "create";
            }}
          >
            Create
          </button>

          <button
            type="button"
            className="tv-ctl"
            disabled={sleepActive}
            aria-pressed={packOpen}
            onClick={() => {
              if (packOpen) {
                setPackOpen(false);
                return;
              }
              closeEngineSheets();
              closeReactOverlays();
              setPackOpen(true);
            }}
          >
            Pack
            {!packClaimed && (
              <span className="tv-badge-dot" aria-hidden="true" />
            )}
          </button>

          <div ref={moreWrapRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="tv-ctl tv-ctl-more"
              aria-label={moreAriaLabel}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-pressed={
                moreOpen ||
                moodsOpen ||
                langOpen ||
                editor.open ||
                Boolean(revealState)
              }
              onClick={() => setMoreOpen((open) => !open)}
            >
              {liveStatus.listening ? (
                <span className="tv-mic-dot" aria-hidden="true" />
              ) : liveStatus.playing ? (
                <span className="tv-music-dot" aria-hidden="true" />
              ) : null}
              ⋯
            </button>

            {moreOpen && (
              <div
                className="tv-more-menu"
                role="menu"
                aria-label="More studio tools"
              >
                {state.learn && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tv-menu-item"
                    disabled={sleepActive}
                    onClick={() => {
                      setMoreOpen(false);
                      engine()?.stopLearnRun();
                    }}
                  >
                    <span>Free world</span>
                    <span className="tv-menu-meta">
                      Learn {state.learn.step} of {state.learn.total}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  role="menuitem"
                  className="tv-menu-item"
                  disabled={sleepActive}
                  onClick={() => {
                    closeEngineSheets();
                    closeReactOverlays();
                    openMap();
                  }}
                >
                  <span>Map</span>
                  <span className="tv-menu-meta">Play</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="tv-menu-item"
                  disabled={sleepActive}
                  onClick={() => {
                    closeEngineSheets();
                    closeReactOverlays();
                    setMoodsOpen(true);
                  }}
                >
                  <span>Story Moods &amp; Mic</span>
                  <span className="tv-menu-meta">
                    {liveStatus.listening
                      ? "Mic on"
                      : liveStatus.playing
                        ? "Playing"
                        : "Voice"}
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="tv-menu-item"
                  disabled={sleepActive}
                  onClick={() => {
                    closeEngineSheets();
                    closeReactOverlays();
                    setLangOpen(true);
                  }}
                >
                  <span>Words &amp; Language</span>
                  <span className="tv-menu-meta">{propLangLabel(propLang)}</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="tv-menu-item"
                  disabled={sleepActive}
                  onClick={() => {
                    closeEngineSheets();
                    closeReactOverlays();
                    setRevealState({ first: characterCardIsFirst() });
                  }}
                >
                  <span>Character Card</span>
                  <span className="tv-menu-meta">
                    {placements.length > 0 ? "Share" : "Build"}
                  </span>
                </button>

                {demoMode && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tv-menu-item"
                    disabled={sleepActive}
                    onClick={openEditorSheet}
                  >
                    <span>Level Editor</span>
                    <span className="tv-menu-meta">
                      {editor.open ? "Open" : "Grid"}
                    </span>
                  </button>
                )}

                {demoMode && kipUrl && !sleepActive && (
                  <a
                    role="menuitem"
                    className="tv-menu-item"
                    href={kipUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMoreOpen(false)}
                  >
                    <span>Kip 3D Rig</span>
                    <span className="tv-menu-meta">Open</span>
                  </a>
                )}

                <button
                  type="button"
                  role="menuitem"
                  className="tv-menu-item"
                  onClick={() => {
                    setMoreOpen(false);
                    toggleFullscreen();
                  }}
                >
                  <span>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
                  <span className="tv-menu-meta">
                    {isFullscreen ? "Exit" : "Full"}
                  </span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="tv-ctl tv-ctl-gear"
            aria-label={gearAriaLabel}
            aria-pressed={grownUpsOpen}
            title="Hold 1.2s for Grown-up settings"
            onPointerDown={startGearHold}
            onPointerUp={cancelGearHold}
            onPointerLeave={cancelGearHold}
            onPointerCancel={cancelGearHold}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                startGearHold();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                const fired = gearLongPressFiredRef.current;
                cancelGearHold();
                if (!fired) {
                  if (grownUpsOpen) setGrownUpsOpen(false);
                  else openGrownUps(false);
                }
                gearLongPressFiredRef.current = false;
              }
            }}
            onClick={() => {
              if (gearLongPressFiredRef.current) {
                gearLongPressFiredRef.current = false;
                return;
              }
              if (grownUpsOpen) {
                setGrownUpsOpen(false);
                return;
              }
              openGrownUps(false);
            }}
          >
            {gearHoldPct > 0 && (
              <span
                className="tv-gear-hold-fill"
                style={{ width: `${Math.round(gearHoldPct * 100)}%` }}
                aria-hidden="true"
              />
            )}
            {(parentSnapshot.settings.enabled || demoMode) && (
              <span className="tv-parent-dot" aria-hidden="true" />
            )}
            <span aria-hidden="true">⚙️</span>
          </button>
        </div>
      </div>

      <div className="tv-stage">
        <div ref={stageHostRef} className="tv-stage-canvas-host" />
        {!sleepActive &&
          (demoMode ? (
            <div className="tv-worlds" role="tablist" aria-label="Worlds">
              {WORLDS.map((w) => {
                const labStars = w.lab ? familyStars(progression, w.id) : 0;
                return (
                  <button
                    key={w.id}
                    type="button"
                    role="tab"
                    aria-selected={state.world === w.id}
                    className={
                      state.world === w.id ? "tv-world tv-world-on" : "tv-world"
                    }
                    onClick={() => engine()?.goWorld(w.id)}
                  >
                    {w.label}
                    {labStars > 0 && (
                      <span
                        className="tv-world-stars"
                        aria-label={`${labStars} mastery stars earned`}
                      >
                        {" "}
                        ★{labStars}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div ref={worldsWrapRef} className="tv-worlds-compact">
              <button
                type="button"
                className="tv-worlds-btn"
                aria-label={`Worlds: ${currentWorldEntry.label} active`}
                aria-haspopup="dialog"
                aria-expanded={worldsOpen}
                aria-pressed={worldsOpen}
                onClick={() => setWorldsOpen((open) => !open)}
              >
                <span>{currentWorldEntry.label}</span>
                <span className="tv-toy-pill-caret" aria-hidden="true">
                  ▾
                </span>
              </button>
              {worldsOpen && (
                <div
                  className="tv-worlds-popover"
                  role="dialog"
                  aria-label="Worlds"
                >
                  {(() => {
                    const dayKey = localDay(
                      Date.now(),
                      parentSnapshot.settings.timezone,
                    );
                    const jobs = dailyQuestsForDay(dayKey, progression);
                    return (
                      <>
                        <span className="tv-worlds-group-k">
                          Today&apos;s Jobs (
                          {jobs.filter((q) => q.completed).length}/{jobs.length})
                        </span>
                        <div className="tv-worlds-grid">
                          {jobs.map((job) => {
                            const target = WORLDS.find(
                              (w) => w.id === job.worldId,
                            );
                            if (!target) return null;
                            return (
                              <button
                                key={job.id}
                                type="button"
                                className={
                                  job.completed
                                    ? "tv-world tv-world-on"
                                    : "tv-world"
                                }
                                title={`${job.title}: ${job.goal}`}
                                onClick={() => {
                                  engine()?.goWorld(target.id);
                                  setWorldsOpen(false);
                                }}
                              >
                                {job.completed ? "✓ " : ""}
                                {job.title}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                  <span className="tv-worlds-group-k">Worlds</span>
                  <div className="tv-worlds-grid">
                    {WORLDS.filter((w) => !w.lab).map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className={
                          state.world === w.id
                            ? "tv-world tv-world-on"
                            : "tv-world"
                        }
                        aria-pressed={state.world === w.id}
                        onClick={() => {
                          engine()?.goWorld(w.id);
                          setWorldsOpen(false);
                        }}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={
                      state.world.startsWith("seed-")
                        ? "tv-world tv-world-on tv-world-surprise"
                        : "tv-world tv-world-surprise"
                    }
                    aria-label="Surprise world: build a new level from the kit"
                    onClick={() => {
                      engine()?.playSeed();
                      setWorldsOpen(false);
                    }}
                  >
                    {"\u{1F3B2}"} Surprise world
                  </button>
                  <span className="tv-worlds-group-k">STEM Labs</span>
                  <div className="tv-worlds-grid">
                    {WORLDS.filter((w) => w.lab).map((w) => {
                      const labStars = familyStars(progression, w.id);
                      return (
                        <button
                          key={w.id}
                          type="button"
                          className={
                            state.world === w.id
                              ? "tv-world tv-world-on"
                              : "tv-world"
                          }
                          aria-pressed={state.world === w.id}
                          onClick={() => {
                            engine()?.goWorld(w.id);
                            setWorldsOpen(false);
                          }}
                        >
                          {w.label}
                          {labStars > 0 && (
                            <span
                              className="tv-world-stars"
                              aria-label={`${labStars} mastery stars earned`}
                            >
                              {" "}
                              ★{labStars}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}

        {editor.testing && !editor.open && !create.open && (
          <button
            type="button"
            className="tv-ctl tv-ctl-primary tv-ed-back"
            onClick={() => engine()?.editorAction("back")}
          >
            {editor.backLabel}
          </button>
        )}

        {xpToast && (
          <div className="tv-xp-toast" role="status">
            {xpToast}
          </div>
        )}

        <MyToySheet
          open={toySheetOpen}
          initialStep={toySheetStep}
          progression={progression}
          localDayKey={localDay(Date.now(), parentSnapshot.settings.timezone)}
          missionsDoneCount={state.missionsDoneTotal}
          skinVersion={skinTick}
          onClose={() => setToySheetOpen(false)}
          onSkinChange={() => {
            setSkinTick((n) => n + 1);
            onSkinChange?.();
          }}
          onOpenBuild={openBuildSheet}
          onPlayLab={(card: LockedVehicleCard) => {
            const target = WORLDS.find(
              (w) => w.id === labWorldForEntry(card.entry),
            );
            setToySheetOpen(false);
            if (target) engine()?.goWorld(target.id);
          }}
          onJumpToWorld={(worldId: string) => {
            const target = WORLDS.find((w) => w.id === worldId);
            setToySheetOpen(false);
            if (target) engine()?.goWorld(target.id);
          }}
          onOpenCharacterCard={() => {
            closeEngineSheets();
            closeReactOverlays();
            setRevealState({ first: characterCardIsFirst() });
          }}
          onCompleteChore={(choreId: string) => {
            const dayKey = localDay(
              Date.now(),
              parentSnapshot.settings.timezone,
            );
            const res = completeRealLifeChore(
              progressionRef.current,
              choreId,
              dayKey,
            );
            if (res.awarded <= 0) return;
            saveProgression(res.next);
            setProgression(res.next);
            void pushProgression(res.next);
            const rankNote =
              res.rankAfter.rank > res.rankBefore.rank
                ? ` · Rank ${res.rankAfter.rank}: ${res.rankAfter.title}`
                : "";
            showXpToast(
              `+${res.awarded} XP · ${res.chore?.title ?? "Routine"}${rankNote}`,
            );
          }}
        />

        {missionPanel.open && (
          <MissionPanel
            key={missionPanel.missionId ?? "mission"}
            snapshot={missionPanel}
            missionId={missionPanel.missionId}
            progression={progression}
            onAction={(action) => engine()?.missionAction(action)}
            onControl={(index) => engine()?.missionControl(index)}
            onSelectTier={
              state.learn
                ? undefined
                : (tier: Tier) => engine()?.setMissionTier(tier)
            }
          />
        )}

        {create.open && (
          <CreatePanel
            snapshot={create}
            onClose={() => engine()?.closeCreate()}
            onMake={(text) => engine()?.createMake(text)}
            onAction={(action) => engine()?.createAction(action)}
          />
        )}

        {editor.open && (
          <EditorPanel
            snapshot={editor}
            onClose={() => engine()?.closeEditor()}
            onAction={(action) => engine()?.editorAction(action)}
            onName={(name) => engine()?.setEditorName(name)}
            onTheme={(theme) => engine()?.setEditorTheme(theme)}
            onNew={(value) => engine()?.editorNew(value)}
            onTab={(tab) => engine()?.setEditorTab(tab)}
            onPalette={(index) => engine()?.editorPalette(index)}
            onControl={(index) => engine()?.editorControl(index)}
            onSelect={(index, value) => engine()?.setEditorSelect(index, value)}
            onIoText={(text) => engine()?.setEditorIoText(text)}
            onIoAction={(action) => engine()?.editorIoAction(action)}
          />
        )}

        {customizer.open && (
          <ToyCustomizer
            toy={toy}
            placements={placements}
            onPlacementsChange={onPlacementsChange}
            hasCharacterCard={hasSavedCard}
            onOpenCharacterCard={() => {
              engine()?.closeCustomizer();
              setRevealState({ first: characterCardIsFirst() });
            }}
            snapshot={customizer}
            progression={progression}
            onClose={handleCloseBuild}
            onSetToyType={(toyType) => engine()?.setToyType(toyType)}
            onSelectSlot={(slot) => engine()?.selectSlot(slot)}
            onSelectPart={(partId) => engine()?.selectPart(partId)}
            onSetPaintZone={(zone) => engine()?.setPaintZone(zone)}
            onSetPaint={(color) => engine()?.setPaint(color)}
            onFactoryAction={(action) => engine()?.factoryAction(action)}
            onForgeTool={(toolId) => engine()?.forgeTool(toolId)}
            onPrintTool={(toolId) => engine()?.printTool(toolId)}
          />
        )}

        <section
          className="tv-sheet"
          role="dialog"
          aria-label="Story Moods and Voice"
          hidden={!moodsOpen}
        >
          <LivePlayPanel
            key={sleepActive ? "sleep" : "live"}
            themeSignature={themeSignature}
            onClose={() => setMoodsOpen(false)}
            onStatusChange={setLiveStatus}
          />
        </section>
        <section
          className="tv-sheet"
          role="dialog"
          aria-label="Words and Language"
          hidden={!langOpen}
        >
          {langOpen && <LanguageSheet onClose={() => setLangOpen(false)} />}
        </section>

        <PackOverlay
          open={packOpen}
          toy={toy}
          onClose={() => setPackOpen(false)}
          onClaimed={() => setPackClaimed(true)}
          onEquipped={(next) => onPlacementsChange(next)}
        />

        {mapOpen && !sleepActive && mapView === "trail" && (
          <ExplorerMap
            graph={buildExplorerGraph({
              cards: buildMapCards({
                ageBand: progression.ageBand ?? null,
                prog: progression,
                found: new Set(state.foundKeys),
                missionsDone: new Set(state.missionsDoneKeys),
                garage: { weekend: garage.isWeekend, done: garage.done },
              }),
              visited: new Set(progression.explorerVisited ?? []),
              currentId: state.world,
              openAll: progression.sandboxUnlockAll,
              ageBand: progression.ageBand ?? null,
            })}
            currentId={state.world}
            darkness={
              timeOfDayFor(Date.now(), undefined, todMode) === "night"
                ? 1
                : 0
            }
            lastVisitedId={progression.explorerVisited?.at(-1) ?? null}
            seen={progression.explorerSeen ?? null}
            onSeen={recordExplorerSeen}
            guide={
              portrait ? (
                <span className="tv-toy-roster-thumb" aria-hidden="true">
                  <img src={portrait} alt="" className="tv-toy-mini-img" />
                </span>
              ) : (
                <ToyMiniIcon
                  toy={toy}
                  accentColor={toyColor}
                  skinVersion={skinTick}
                  size="tile"
                />
              )
            }
            onClose={() => setMapOpen(false)}
            onShowCards={() => setMapView("cards")}
            onOpenGarage={openGarage}
            onAskAge={() => openGrownUps(false)}
            onGoWorld={(worldId) => {
              visitExplorerNode(worldId);
              setMapOpen(false);
              engine()?.goWorld(worldId);
            }}
            onGoFrontier={(node) => {
              // playSeed returns null when the level cannot start (player
              // busy, showcase, editor). Reveal and close only when it began.
              if (!node.seedCode) return false;
              const started = engine()?.playSeed(node.seedCode, node.theme, {
                tier: node.tier,
                mood: node.mood,
              });
              if (!started) return false;
              visitExplorerNode(node.id);
              setMapOpen(false);
              return true;
            }}
            onStartLearn={(track, plan) => {
              visitExplorerNode(track);
              closeEngineSheets();
              closeReactOverlays();
              engine()?.startLearnRun(
                track,
                plan,
                (progressionRef.current.ageBand ?? 99) <= 1,
              );
            }}
            planForRung={(track, rung) =>
              planFor(
                track,
                progressionRef.current.ageBand ?? null,
                progressionRef.current,
                rung,
              ) ?? [rung]
            }
          />
        )}

        {mapOpen && !sleepActive && mapView === "cards" && (
          <MapCarousel
            cards={buildMapCards({
              ageBand: progression.ageBand ?? null,
              prog: progression,
              found: new Set(state.foundKeys),
              missionsDone: new Set(state.missionsDoneKeys),
              garage: { weekend: garage.isWeekend, done: garage.done },
            })}
            ageBand={progression.ageBand ?? null}
            guide={
              <ToyMiniIcon toy={toy} accentColor={toyColor} skinVersion={skinTick} />
            }
            guideName={label}
            onClose={() => setMapOpen(false)}
            onAskAge={() => openGrownUps(false)}
            onGoWorld={(worldId) => {
              setMapOpen(false);
              engine()?.goWorld(worldId);
            }}
            onStartLearn={(track, plan) => {
              closeEngineSheets();
              closeReactOverlays();
              engine()?.startLearnRun(
                track,
                plan,
                (progressionRef.current.ageBand ?? 99) <= 1,
              );
            }}
            planForRung={(track, rung) =>
              planFor(
                track,
                progressionRef.current.ageBand ?? null,
                progressionRef.current,
                rung,
              ) ?? [rung]
            }
            onShowExplorer={() => setMapView("trail")}
            onOpenGarage={openGarage}
          />
        )}

        {garageOpen && !sleepActive && (
          <GarageSheet
            status={garage}
            onStart={startGarageMission}
            onFreeBuild={freeBuildFromGarage}
            onClose={() => setGarageOpen(false)}
          />
        )}

        {garageMission &&
          !sleepActive &&
          !mapOpen &&
          !garageOpen &&
          !grownUpsOpen &&
          !toySheetOpen &&
          !packOpen &&
          !revealState &&
          !missionPanel.open &&
          !create.open &&
          !editor.open && (
            <GarageGoalChip
              title={garageMission.title}
              brief={garageMission.brief}
              parts={garageParts}
              done={garageDoneNow}
              reward={garageReward}
              buildOpen={customizer.open}
              onOpenBuild={openBuildSheet}
              onStop={endGarageMission}
            />
          )}

        <RevealOverlay
          open={Boolean(revealState)}
          firstReveal={Boolean(revealState?.first)}
          toy={toy}
          placements={placements}
          contract={contract}
          onClose={() => setRevealState(null)}
          onOpenBuild={openBuildSheet}
        />

        <SleepCurtain
          status={parentSnapshot.status}
          quietEnd={parentSnapshot.settings.quietHours.end}
          toyName={label}
          missionGraceActive={missionGraceActive}
          onOpenGrownUps={() => openGrownUps(false)}
        />

        <GrownUpsSheet
          open={grownUpsOpen}
          holdSatisfied={grownUpsHoldSatisfied}
          snapshot={parentSnapshot}
          progression={progression}
          localDayKey={localDay(Date.now(), parentSnapshot.settings.timezone)}
          demoMode={demoMode}
          onToggleDemoMode={handleToggleDemoMode}
          onSeedDemoSave={() => engine()?.seedDemoSave?.()}
          onOpenEditor={openEditorSheet}
          onRoomPhoto={(segments) => {
            const seed = (Date.now() % 0xffffff) + 1;
            const result = composeRoomPhotoLevel({ seed, segments });
            const opened = engine()?.openEditorWithLevel(result.level) ?? false;
            if (!opened) return "That level could not be opened. Try the photo again.";
            setGrownUpsOpen(false);
            const found = result.mapped;
            return result.fallback
              ? "Made a starter room level in the editor. The photo props are yours to place."
              : `Made “${result.level.name}” in the editor from ${found} spotted prop${found === 1 ? "" : "s"}. Press Play to try it.`;
          }}
          onJumpWorld={(worldId) => engine()?.goWorld(worldId)}
          currentWorld={state.world}
          kipUrl={kipUrl}
          onResetXp={() => {
            const next = resetProgression(progressionRef.current);
            saveProgression(next);
            setProgression(next);
            void pushProgression(next);
          }}
          garagePreview={garagePreview}
          onToggleGaragePreview={() => {
            const next = !garagePreview;
            saveGaragePreview(next);
            setGaragePreview(next);
          }}
          timeOfDayMode={todMode}
          onSetTimeOfDayMode={(mode) => {
            saveTimeOfDayMode(mode);
            setTodMode(mode);
          }}
          onToggleSandbox={() => {
            const next = {
              ...progressionRef.current,
              sandboxUnlockAll: !progressionRef.current.sandboxUnlockAll,
            };
            saveProgression(next);
            setProgression(next);
            void pushProgression(next);
          }}
          onSetAgeBand={(band: number | null) => {
            const next = { ...progressionRef.current };
            if (band !== null) next.ageBand = band;
            else delete next.ageBand;
            saveProgression(next);
            setProgression(next);
            void pushProgression(next);
          }}
          onOpenMap={() => {
            setGrownUpsOpen(false);
            closeEngineSheets();
            closeReactOverlays();
            openMap();
          }}
          onToggleChore={(choreId: string) => {
            const next = toggleChoreEnabled(progressionRef.current, choreId);
            saveProgression(next);
            setProgression(next);
            void pushProgression(next);
          }}
          onSnapshotChange={setParentSnapshot}
          onClose={() => {
            setGrownUpsHoldSatisfied(false);
            setGrownUpsOpen(false);
          }}
        />
      </div>
    </div>
  );
}
