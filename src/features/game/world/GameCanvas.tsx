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
import { BANDS } from "../../../lib/age";
import { readProfile, type PlayerProfile } from "../../../lib/newPlayer";
import { forgetPlayer } from "../../../lib/returningPlayer";
import { PROFILE_CHANGED_EVENT, signinTokenFromSearch, withoutSignin } from "../../../lib/accountsClient";
import { SignInLanding } from "./AccountPanel";
import {
  completeGarage,
  completeGarageHousehold,
  completeGarageReal,
  GARAGE_DAYS_DEFAULT,
  GARAGE_DROPS,
  GARAGE_GRACE_MS,
  garageGraceLeftMs,
  garageStatus,
  garageTrophyCounts,
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
  CHORE_QUEST_XP,
  completeRealLifeChore,
  dailyQuestsForDay,
  toggleChoreEnabled,
} from "../../../lib/dailyQuests";
import { loadDemoMode, saveDemoMode } from "../../../lib/demoMode";
import {
  effectiveParentSnapshot,
  parentControlsBanner,
  parentControlsSource,
  readParentControlsInputs,
  setParentControlsSession,
} from "../../../lib/parentControls";
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
import { noteGesture, ctx as gameAudioCtx } from "./runtime/audio";
import { createDanceLibrary } from "./runtime/gameDances";
import { createGameParty, type GameParty } from "./runtime/gameParty";
import { deviceId } from "../../../lib/sync";
import { SongStudioSheet } from "./SongStudioSheet";
import { ThemeSongCard } from "./ThemeSongCard";
import { createThemeSongFlow, levelDescription, readKeptSongs, type FlowState, type KeptSong, type SongQuota, type ThemeSongFlow } from "./themeSongFlow";
import {
  createEngine,
  createWorldStore,
  worldUrlFor,
  WORLDS,
  type EngineHandle,
} from "./engine";
import { GarageGoalChip } from "./GarageGoalChip";
import { GarageSheet } from "./GarageSheet";
import { HouseholdConfirm, useHouseholdPictures } from "./HouseholdWeekend";
import { householdDropForWeekend } from "../../../lib/garageHouseholdData";
import { GrownUpsSheet } from "./GrownUpsSheet";
import { composeRoomPhotoLevel } from "./runtime/roomPhoto";
import { buildExplorerGraph } from "../../../lib/explorerMap";
import { planFor } from "../../../lib/learn";
import { buildMapCards } from "../../../lib/mapCards";
import { ExplorerMap } from "./ExplorerMap";
import { MissionPanel } from "./MissionPanel";
import { MyToySheet } from "./MyToySheet";
import { isPackClaimedToday, PackOverlay } from "./PackOverlay";
import { RevealOverlay } from "./RevealOverlay";
import { SleepCurtain } from "./SleepCurtain";
import { bedtimeModeFor } from "../../../lib/bedtimeMode";
import { WorkshopLauncher } from "./WorkshopLauncher";
import { ROTATE_GATE_QUERY, rotateGateShowing } from "./rotateGate";
import "../../../game-hud.css";
import { NavStrip } from "./NavStrip";
import { ToyCustomizer } from "./ToyCustomizer";
import { ToyMiniIcon } from "./ToyMiniIcon";
import { ScavengerCamera } from "./ScavengerCamera";
import { SCAVENGER_QUESTS, type ScavengerQuest } from "../../../lib/scavenger";
import { TitleMenu } from "./TitleMenu";
import { OnboardingSheet } from "./OnboardingSheet";
import { shouldShowTitle, type TitleChoice } from "./titleEntries";

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
  // The main menu (titleEntries.ts): the world boots on its title, the toy on the turntable, and waits for Play, Build or Create. `?title=0` goes straight in.
  const wantTitleRef = useRef(shouldShowTitle(typeof window === "undefined" ? "" : window.location.search));
  const [titleOpen, setTitleOpen] = useState(wantTitleRef.current);
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
  // The new-player setup (OnboardingSheet.tsx, docs/specs/accounts-and-new-user-spec.md): opt-in, from the title screen, the Grown-Ups sheet, or ?onboarding=1.
  const [onboardOpen, setOnboardOpen] = useState(() => { try { return /[?&]onboarding=1(&|$)/.test(window.location.search); } catch { return false; } });
  // The saved player (src/lib/returningPlayer.ts): the title greets them by name and offers a different player instead of the first-run setup; a grown-up can forget them in the Grown-Ups sheet.
  const [player, setPlayer] = useState<PlayerProfile | null>(() => { try { return readProfile(window.localStorage); } catch { return null; } });
  // "Play as Mia" in Grown-Ups > Account writes this device's player: the title and the sheet read it again when it says so (AccountPanel.tsx).
  useEffect(() => {
    const reread = () => { try { setPlayer(readProfile(window.localStorage)); } catch { setPlayer(null); } };
    window.addEventListener(PROFILE_CHANGED_EVENT, reread);
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, reread);
  }, []);
  // Opened from the emailed sign-in link (?signin=...): the token leaves the address bar at once (not kept in the history), and a card trades it for a session (AccountPanel.tsx SignInLanding).
  const [signinToken, setSigninToken] = useState<string | null>(() => { try { return signinTokenFromSearch(window.location.search); } catch { return null; } });
  useEffect(() => {
    try { if (signinTokenFromSearch(window.location.search)) window.history.replaceState(null, "", window.location.pathname + withoutSignin(window.location.search) + window.location.hash); } catch { /* an address that cannot be changed: the token stays, the card still works */ }
  }, []);
  const forgetThisPlayer = useCallback(() => {
    try { forgetPlayer(window.localStorage); } catch { /* blocked storage: nothing was saved to forget */ }
    setPlayer(null);
  }, []);
  const propLang = usePropLang();
  const [liveStatus, setLiveStatus] = useState<LivePlayStatus>({
    playing: false,
    listening: false,
  });
  const [moreOpen, setMoreOpen] = useState(false);
  // The one menu button's drawer (the old top bar's buttons, the Map and the world list live in it), and the "turn your phone sideways" gate (rotateGate.ts).
  const [menuOpen, setMenuOpen] = useState(false);
  const [uprightGate, setUprightGate] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(ROTATE_GATE_QUERY);
    const sync = () => setUprightGate(rotateGateShowing(window.location.search, mq.matches));
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const [mapOpen, setMapOpen] = useState(false);
  const [worldsOpen, setWorldsOpen] = useState(false);
  const [demoMode, setDemoMode] = useState<boolean>(() => loadDemoMode());
  const [skinTick, setSkinTick] = useState(0);
  // "Find a Wheel": the scavenger chore whose camera is open, or null.
  const [scavenge, setScavenge] = useState<ScavengerQuest | null>(null);
  const [grownUpsOpen, setGrownUpsOpen] = useState(initialOverlay === "parent");
  const [grownUpsHoldSatisfied, setGrownUpsHoldSatisfied] = useState(false);
  const [gearHoldPct, setGearHoldPct] = useState(0);
  const gearHoldRafRef = useRef<number | null>(null);
  const gearHoldTimerRef = useRef<number | null>(null);
  const gearHoldStartRef = useRef(0);
  const gearHoldingRef = useRef(false);
  const gearLongPressFiredRef = useRef(false);
  const [rawParentSnapshot, setParentSnapshot] = useState<ParentSnapshot>(() =>
    getLocalParentSnapshot(),
  );
  // The grown-up checks and limits master switch (docs/specs/parent-controls-off-spec.md). Default on. Off only by the build flag, or by this tab's Demo Mode toggle.
  const [controlsInputs, setControlsInputs] = useState(() => readParentControlsInputs(demoMode));
  const controlsSource = parentControlsSource({ ...controlsInputs, demoMode });
  const controlsMode = controlsSource === "default" ? "on" : "off";
  const controlsOffRef = useRef(false);
  controlsOffRef.current = controlsMode === "off";
  // Every consumer below reads this one: off, the status never says locked (saved settings and today's ledger are untouched, only what is read is overridden).
  const parentSnapshot = useMemo(
    () => effectiveParentSnapshot(rawParentSnapshot, controlsMode),
    [rawParentSnapshot, controlsMode],
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

  // The end-of-level song and the dance party after it: a win offers "Make a song about it", the song is named and sung (themeSongFlow.ts, the app's own
  // /api/theme-song route), and when it is ready the character dances to it IN the game (runtime/gameParty.ts). Quiet when the route is off.
  const [songOffer, setSongOffer] = useState<string | null>(null); // the sentence about the level just finished, or null: nothing is offered
  const [songFlow, setSongFlow] = useState<FlowState | null>(null);
  const songOfferTimerRef = useRef<number | null>(null);
  const songRef = useRef<{ flow: ThemeSongFlow; party: GameParty } | null>(null);
  /** The new-player setup holds the dance until the player picks up the headphones (themeSongFlow `holdParty`). */
  const onboardHoldRef = useRef(false);
  const getSong = useCallback(() => {
    if (!songRef.current) {
      // the dances the character knows: the Samba, and the baked Mixamo dances loaded the first time a party needs them
      const dances = createDanceLibrary({ fetchImpl: (...args) => fetch(...args), addClips: (clips) => engineRef.current?.partyAddClips(clips) });
      const party = createGameParty({
        ctx: () => gameAudioCtx(),
        prepare: () => dances.prepare(),
        dances: () => { const all = dances.list(), baked = all.filter((d) => d.id !== "dance"); return baked.length ? baked : all; }, // the Samba (a limb-direction clip) has no foot grounding and hovers up to half a unit; the baked dances keep the sole within 2 mm of the floor (measured 2026-11-04). The Samba stays as the fallback.
        ensureDances: (ids) => dances.ensure(ids),
        startDance: (source) => engineRef.current?.partyDanceStart(source) ?? false,
        stopDance: () => engineRef.current?.partyDanceStop(),
        duckMusic: (on) => engineRef.current?.partyMusicDuck(on),
        onEnd: (reason) => songRef.current?.flow.partyEnded(reason),
      });
      const flow = createThemeSongFlow({
        holdParty: () => onboardHoldRef.current,
        fetchImpl: (...args) => fetch(...args),
        // the device and the family's clock go with every song request: the weekly limit is per device and turns on the family's own Monday
        headers: () => ({ "x-device-id": deviceId(), "x-client-timezone": (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })() }),
        decode: async (bytes) => {
          const Offline = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
          if (!Offline) throw new Error("no audio decoder");
          const buf = await new Offline(2, 1, 44100).decodeAudioData(bytes);
          return { channels: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), sampleRate: buf.sampleRate };
        },
        startParty: (song) => party.start(song),
        pauseParty: () => party.pause(),
        resumeParty: () => party.resume(),
        onState: setSongFlow,
        storage: (() => { try { return window.localStorage; } catch { return null; } })(),
      });
      songRef.current = { flow, party };
    }
    return songRef.current;
  }, []);
  const offerSongRef = useRef<(missionType: string) => void>(() => {});
  offerSongRef.current = (missionType: string) => {
    const s = getSong();
    const phase = s.flow.state().phase;
    if (phase === "writing" || phase === "making" || phase === "ready" || phase === "dancing") return; // a song is already on its way, or a party is on
    void s.flow.canMake().then((on) => { // the route is on, a grown-up has not switched songs off, and a song is left this week
      if (!on) return;
      void s.flow.warm(); // the offer is up: wake our own model while the child decides
      if (phase === "over" || phase === "failed") s.flow.cancel(); // the old card gives way to the new offer
      setSongOffer(levelDescription(missionType));
      if (songOfferTimerRef.current !== null) window.clearTimeout(songOfferTimerRef.current);
      songOfferTimerRef.current = window.setTimeout(() => setSongOffer(null), 25000);
    });
  };
  const makeSong = useCallback(() => {
    noteGesture(); // this tap is what lets the song play later: the browser starts sound only from a tap
    const description = songOffer;
    setSongOffer(null);
    if (songOfferTimerRef.current !== null) window.clearTimeout(songOfferTimerRef.current);
    if (description) void getSong().flow.start(description, "level");
  }, [songOffer, getSong]);
  // The Map's Songs sheet: make a song from an idea, or dance to one already made. Either closes the Map and hands over to the card and the party above.
  const [songsOpen, setSongsOpen] = useState(false);
  const [songsAvailable, setSongsAvailable] = useState<boolean | null>(null); // null until the route has answered: the sheet says "checking", never "resting", while it waits
  const [songsQuota, setSongsQuota] = useState<SongQuota | null>(null);
  const [keptSongs, setKeptSongs] = useState<KeptSong[]>([]);
  const localStore = () => { try { return window.localStorage; } catch { return null; } };
  const openSongs = useCallback(() => {
    setKeptSongs(readKeptSongs(localStore()));
    setSongsAvailable(null);
    setSongsQuota(null);
    setSongsOpen(true);
    void getSong().flow.probe(true).then((p) => { setSongsAvailable(p.enabled); setSongsQuota(p.quota); });
    void getSong().flow.warm(); // a song is likely coming: wake our own model now (a no-op unless it is ours)
  }, [getSong]);
  const startFromSheet = useCallback((begin: () => void) => {
    noteGesture(); // this tap is what lets the song play later
    setSongOffer(null);
    setSongsOpen(false);
    setMapOpen(false);
    begin();
  }, []);
  const stopSongParty = useCallback(() => { songRef.current?.party.stop("stopped"); }, []);
  const pauseSong = useCallback(() => { songRef.current?.flow.pause(); }, []);
  const resumeSong = useCallback(() => { noteGesture(); songRef.current?.flow.resume(); }, []);
  /** Where the listener is in the song (seconds, counting on across loops, still while paused): the karaoke reads this a few times a second. */
  const songPlayhead = useCallback(() => songRef.current?.party.state().songTime ?? 0, []);
  const danceAgain = useCallback(() => { noteGesture(); void songRef.current?.flow.again(); }, []);
  const newWords = useCallback(() => { noteGesture(); songRef.current?.party.stop("stopped"); void songRef.current?.flow.redo(); }, []); // new words = a fresh song; this tap is the audio gesture for it
  const closeSong = useCallback(() => {
    songRef.current?.party.stop("stopped");
    songRef.current?.flow.cancel();
  }, []);
  useEffect(() => () => {
    songRef.current?.party.stop("stopped");
    songRef.current?.flow.cancel();
    if (songOfferTimerRef.current !== null) window.clearTimeout(songOfferTimerRef.current);
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
  // True while the picture is still being waited for (the rig loads after the first frame): the Kip button shows a spinner then, not the plain icon, and the icon only
  // comes back if the picture cannot be taken (a scanned toy, or the rig never loaded).
  const [portraitTrying, setPortraitTrying] = useState(true);
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
  // the drawer always opens with More folded (its five lesser rows are one tap away)
  useEffect(() => {
    if (!menuOpen) setMoreOpen(false);
  }, [menuOpen]);
  // ...and opening More scrolls the drawer down so the rows it just revealed are in view (the drawer is only ~390 px tall on a phone held sideways)
  useEffect(() => {
    if (!moreOpen || !menuOpen) return;
    const id = window.requestAnimationFrame(() => {
      const dock = document.getElementById("tv-drawer");
      dock?.scrollTo({ top: dock.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [moreOpen, menuOpen]);
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

  // The Menu button and the Toy Box wear the same little picture of the toy as the Map's
  // token. It is taken once the 3D rig has loaded (polled, the rig loads after the first
  // frame) and again when the toy, its outfit or a sheet changes, so a new hat is a new
  // picture. Until then, and for a scanned toy, the plain icon shows.
  useEffect(() => {
    if (titleOpen) return;
    setPortraitTrying(isBuiltInToy(toyRef.current)); // a scanned toy has no 3D picture to wait for
    refreshPortrait();
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      if (engineRef.current?.portraitSig() || tries > 40) {
        refreshPortrait();
        setPortraitTrying(false);
        window.clearInterval(id);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [refreshPortrait, titleOpen, toy.id, skinTick, menuOpen, toySheetOpen]);

  // The Map is one screen: the trail map with the card strip (a mini carousel
  // with a screenshot of every level) along the bottom, so a child can walk
  // the trail or just tap a card, at any age and in either orientation.
  const openMap = useCallback(() => {
    songRef.current?.party.stop("stopped"); // a party does not follow the child onto the Map
    setSongsOpen(false); // the Map always opens on its places, not on a Songs sheet left open
    refreshPortrait();
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
            offerSongRef.current(type);
          }
        },
      },
      { contract: contractRef.current, title: wantTitleRef.current },
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
      // Controls off: refresh what is shown, but do not count play time, so a demo does not spend the child's real day.
      if (grownUpsOpen || cur.status.locked || controlsOffRef.current) {
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

  // The Garage's state for today (drop days, the drop switch, done or not).
  const garage = garageStatus({
    dayKey: localDay(Date.now(), parentSnapshot.settings.timezone),
    ageBand: progression.ageBand ?? null,
    done: progression.garageDone,
    dropEnabled: progression.garageDrop,
    days: progression.garageDays,
    preview: demoMode && garagePreview,
    found: progression.garageFound,
    householdDrop: householdDropForWeekend,
  });
  const garageRef = useRef(garage);
  garageRef.current = garage;
  // The household weekends' pictures, loaded the first time the Garage sheet or the Grown-Ups sheet is open on one.
  const housePictures = useHouseholdPictures((garageOpen || grownUpsOpen) && garage.kind === "household");
  // The roof stars: gold for a build weekend or a household weekend that was found, hollow for one that was skipped.
  const garageTrophies = garageTrophyCounts(progression.garageDone, progression.garageFound, progression.garageSkipped);

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

  // Bedtime (Dan, 2026-11-05: "Kip going to bed by himself at quiet hours"): in the last minute before play stops for the night or for the day he goes to bed (his own bed, or he lies down where he is),
  // and once the curtain is up he is asleep; when play is back he wakes. A sitting limit is a break, not a night, so he stays up for it. Read from the effective snapshot, so a demo never does it.
  const bedtimeMode = bedtimeModeFor(parentSnapshot.status, sleepActive);
  useEffect(() => {
    if (state.ready) engine()?.setBedtime(bedtimeMode);
  }, [bedtimeMode, state.ready]);

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
      setMenuOpen(false); // the grown-ups' card replaces the drawer (the Settings button is in it, and its tap does not close the drawer by itself)
    },
    [closeEngineSheets, closeReactOverlays],
  );

  // Home: back to the main menu from wherever the child is (the drawer's Home). Whatever is open closes first, a Learn run ends (as "Free world" does) and a song
  // party stops. The world says no (and stays put) only while something is mid-way: the editor's play-test, a driven mission.
  const goHome = useCallback(() => {
    songRef.current?.party.stop("stopped");
    setSongsOpen(false);
    if (state.learn) engine()?.stopLearnRun();
    closeEngineSheets();
    closeReactOverlays();
    if (engine()?.goTitle()) setTitleOpen(true);
  }, [closeEngineSheets, closeReactOverlays, state.learn]);

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
    if (!next) {
      // Leaving Demo Mode ends the checks-off bypass for good: clear it, so turning Demo Mode on again later in this tab does not bring it back.
      setParentControlsSession(false);
      setControlsInputs(readParentControlsInputs(false));
    }
  }, []);

  /** The Demo Mode toggle for the grown-up checks and limits. Returns false when the tab's storage refused (then nothing changed). */
  const handleToggleParentControls = useCallback((off: boolean) => {
    const stored = setParentControlsSession(off);
    setControlsInputs(readParentControlsInputs(true));
    return stored;
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

  // The menu is up only while the world is on its title. Play, Build and Create below leave it; so does anything else that opens a panel (a deep link to Create, the
  // editor), because the engine ends the title state when it opens one. This notices that, so the menu never stays over a world that is already playing.
  useEffect(() => {
    if (!titleOpen || !state.ready) return;
    const id = window.setInterval(() => {
      if (!engineRef.current?.isTitle()) setTitleOpen(false);
    }, 120);
    return () => window.clearInterval(id);
  }, [titleOpen, state.ready]);

  const chooseTitle = useCallback(
    (choice: TitleChoice) => {
      if (choice === "play") {
        engineRef.current?.start();
      } else if (choice === "build") {
        openBuildSheet();
      } else {
        closeReactOverlays();
        engineRef.current?.openCreate();
      }
      setTitleOpen(false);
    },
    [closeReactOverlays, openBuildSheet],
  );

  const openOnboarding = useCallback(() => {
    closeReactOverlays();
    setGrownUpsOpen(false);
    setOnboardOpen(true);
  }, [closeReactOverlays]);
  /** The intro begins: leave the title screen so the world, and Kip dancing to his song, show behind it. */
  const onboardIntroStart = useCallback(() => { if (titleOpen) chooseTitle("play"); }, [titleOpen, chooseTitle]);
  /** The "meet Kip" scene: `enter` leaves the title screen and goes to the Toy Room; `pile` paints the shirt and lays Kip out as a pile of bricks; `build` carries them to their seats; `end` puts Kip back. */
  const onboardStage = useCallback((op: "enter" | "dress" | "pile" | "build" | "abort" | "end" | "phonesShow", hex?: string): boolean => {
    if (!engineRef.current) return false; // no game to show it in: the setup keeps its plain-blocks preview
    if (op === "enter") { engineRef.current.onbStage("hide"); if (titleOpen) chooseTitle("play"); engineRef.current.goWorld("room"); return true; } // Kip is hidden from the first frame: no Kip is seen before the Dress step shows him on purpose
    engineRef.current.onbStage(op, hex);
    return true;
  }, [titleOpen, chooseTitle]);
  const onboardHold = useCallback((on: boolean) => { onboardHoldRef.current = on; }, []);
  /** The player picks up the headphones: Kip puts them on, and the song, held until now, starts the dance. */
  const onboardPickUp = useCallback(() => {
    noteGesture(); // this tap is what lets the song play
    onboardHoldRef.current = false;
    engineRef.current?.onbStage("phones");
    void getSong().flow.again();
  }, [getSong]);
  // the headphones go when the song is over
  useEffect(() => { if (songFlow?.phase === "over") engineRef.current?.onbStage("phonesOff"); }, [songFlow?.phase]);
  const onboardSong = useCallback((idea: string) => startFromSheet(() => void getSong().flow.start(idea, "prompt")), [startFromSheet, getSong]);

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

  // A household weekend finished by playing "Who's that shape?": XP and the stamp, no play time. Preview weekend saves nothing.
  const finishHouseholdSkip = useCallback((): string => {
    const { weekendKey, preview } = garageRef.current;
    if (preview) return "Preview only. Nothing is saved.";
    const dayKey = localDay(Date.now(), getLocalParentSnapshot().settings.timezone);
    const res = completeGarageHousehold(progressionRef.current, weekendKey, dayKey, "skipped");
    if (res.awarded <= 0) return "Done already. There is nothing more to earn this weekend.";
    saveProgression(res.next);
    setProgression(res.next);
    void pushProgression(res.next);
    const rankNote = res.rankAfter.rank > res.rankBefore.rank ? ` · Rank ${res.rankAfter.rank}: ${res.rankAfter.title}` : "";
    return `+${res.awarded} XP · skipping earns no play time${rankNote}`;
  }, []);

  // The grown-up's "We found it": XP, the stamp and the play-time minutes. Preview weekend saves nothing.
  const confirmHouseholdFound = useCallback((): string | Promise<string> => {
    const { weekendKey, preview, done } = garageRef.current;
    if (preview) return "Preview only. Nothing is saved.";
    const dayKey = localDay(Date.now(), parentSnapshot.settings.timezone);
    const res = completeGarageHousehold(progressionRef.current, weekendKey, dayKey, "found");
    if (res.next === progressionRef.current) {
      return done ? "This weekend is already finished." : "Nothing to confirm: “We found it” is switched off with the real-life leg.";
    }
    saveProgression(res.next);
    setProgression(res.next);
    void pushProgression(res.next);
    const rankNote = res.rankAfter.rank > res.rankBefore.rank ? ` · Rank ${res.rankAfter.rank}: ${res.rankAfter.title}` : "";
    const say = (minutes: number) => `Found it! +${res.awarded} XP${minutes > 0 ? ` · +${minutes} min play time` : ""}${rankNote}`;
    if (!res.stemMissionId) return say(0);
    return recordPlayProgress({ completedMissionIds: [res.stemMissionId] })
      .then(({ snapshot, awardedMinutes }) => {
        setParentSnapshot(snapshot);
        return say(awardedMinutes);
      })
      .catch(() => say(0));
  }, [parentSnapshot.settings.timezone]);

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
  }, [garageMission, garageDoneNow, state.ready]);

  // Weekend loaner parts: open to try on drop days, taken back after.
  useEffect(() => {
    if (!state.ready) return;
    engineRef.current?.setLoanKeys(
      garage.isWeekend && garage.dropEnabled ? loanKeys(garage.drop) : [],
      KNOWN_LOANERS,
    );
  }, [state.ready, garage.isWeekend, garage.dropEnabled, garage.drop]);

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

  // The Map's cards: the trail map's places and the strip along its bottom are the same list.
  const mapCards = mapOpen
    ? buildMapCards({
        ageBand: progression.ageBand ?? null,
        prog: progression,
        found: new Set(state.foundKeys),
        missionsDone: new Set(state.missionsDoneKeys),
        garage: { weekend: garage.isWeekend && garage.dropEnabled, done: garage.done, trophies: garageTrophies.gold, hollow: garageTrophies.hollow, household: garage.kind === "household" },
      })
    : [];

  // A real-life chore done: pay it once a day (the shared +25 XP ceiling is in completeRealLifeChore) and say so. The Toy Box's "I did it!" and the scavenger camera both come here.
  const completeChore = (choreId: string) => {
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
  };

  return (
    <div
      ref={hostRef}
      className={`${isFullscreen ? "tv-host tv-host-fullscreen" : "tv-host"}${titleOpen ? " tv-host--titled" : ""}`}
    >
      {uprightGate && (
        <div className="tv-rotate-gate" role="alert" aria-live="assertive">
          <div className="tv-rotate-phone" aria-hidden="true" />
          <p className="tv-rotate-title">Turn your phone sideways</p>
          <p className="tv-rotate-sub">ToyVentor World plays best wide.</p>
        </div>
      )}
      {!titleOpen && !sleepActive && !mapOpen && (
        <button
          type="button"
          className="tv-kip-fab"
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="tv-drawer"
          onClick={() => {
            setMenuOpen((open) => !open);
            setMoreOpen(false);
          }}
        >
          {portrait ? (
            <img className="tv-kip-fab-portrait" src={portrait} alt="" draggable={false} />
          ) : portraitTrying ? (
            <span className="tv-kip-fab-loader" role="status" aria-label="Getting your toy ready" />
          ) : (
            <ToyMiniIcon toy={toy} accentColor={toyColor} skinVersion={skinTick} size="tile" />
          )}
          {(!packClaimed || liveStatus.listening || liveStatus.playing) && <span className="tv-kip-fab-dot" aria-hidden="true" />}
        </button>
      )}
      {menuOpen && <div className="tv-drawer-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
      <div
        id="tv-drawer"
        className="tv-dock"
        role="toolbar"
        aria-label="ToyVentor World studio"
        data-open={menuOpen ? "true" : "false"}
        onClickCapture={(e) => {
          // any button or link in the drawer does its job and the drawer gets out of the way (the cards it opens slide in from the same edge)
          const t = (e.target as HTMLElement).closest("button, a");
          if (t && !t.classList.contains("tv-ctl-gear") && !t.classList.contains("tv-ctl-more")) window.setTimeout(() => setMenuOpen(false), 0);
        }}
      >
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
          <span className="tv-menu-ico" aria-hidden="true">
            🧸
          </span>
          <span className="tv-toy-pill-name">Toy Box</span>
          {portrait ? (
            <span className="tv-toy-mini-icon" aria-hidden="true">
              <img className="tv-toy-mini-img" src={portrait} alt="" draggable={false} />
            </span>
          ) : (
            <ToyMiniIcon
              toy={toy}
              accentColor={toyColor}
              skinVersion={skinTick}
            />
          )}
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

        <NavStrip
          disabled={sleepActive}
          onHome={goHome}
          onMap={() => {
            closeEngineSheets();
            closeReactOverlays();
            openMap();
          }}
          settings={
            <button
              type="button"
              className="tv-ctl tv-ctl-gear tv-navstrip-btn"
              data-nav="settings"
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
              <span className="tv-navstrip-glyph" aria-hidden="true">
                ⚙️
              </span>
              <span>Settings</span>
            </button>
          }
        />

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
            <span className="tv-menu-ico" aria-hidden="true">
              🧱
            </span>
            <span>Build</span>
          </button>

          <WorkshopLauncher engine={engineRef} disabled={sleepActive} downloads={controlsMode === "off"} />

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
            <span className="tv-menu-ico" aria-hidden="true">
              ✨
            </span>
            <span>Create</span>
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
            <span className="tv-menu-ico" aria-hidden="true">
              🎁
            </span>
            <span>Pack</span>
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
              <span className="tv-menu-ico" aria-hidden="true">
                ⋯
              </span>
              <span className="tv-more-label">More</span>
              <span className="tv-more-caret" aria-hidden="true">
                {moreOpen ? "▴" : "▾"}
              </span>
            </button>

            {(moreOpen || menuOpen) && (
              <div
                className="tv-more-menu"
                role="menu"
                aria-label="More studio tools"
                data-open={moreOpen ? "true" : "false"}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="tv-menu-item tv-menu-worlds"
                  disabled={sleepActive}
                  onClick={() => {
                    closeEngineSheets();
                    closeReactOverlays();
                    setWorldsOpen(true);
                  }}
                >
                  <span className="tv-menu-ico" aria-hidden="true">
                    🌍
                  </span>
                  <span className="tv-menu-label">Worlds</span>
                  <span className="tv-menu-meta">{currentWorldEntry.label}</span>
                </button>
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
                    <span className="tv-menu-ico" aria-hidden="true">
                      🧭
                    </span>
                    <span className="tv-menu-label">Free world</span>
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
                    setMoodsOpen(true);
                  }}
                >
                  <span className="tv-menu-ico" aria-hidden="true">
                    🎤
                  </span>
                  <span className="tv-menu-label">Story Moods &amp; Mic</span>
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
                  <span className="tv-menu-ico" aria-hidden="true">
                    🗣️
                  </span>
                  <span className="tv-menu-label">Words &amp; Language</span>
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
                  <span className="tv-menu-ico" aria-hidden="true">
                    📇
                  </span>
                  <span className="tv-menu-label">Character Card</span>
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
                    <span className="tv-menu-ico" aria-hidden="true">
                      📐
                    </span>
                    <span className="tv-menu-label">Level Editor</span>
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
                    <span className="tv-menu-ico" aria-hidden="true">
                      🤖
                    </span>
                    <span className="tv-menu-label">Kip 3D Rig</span>
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
                  <span className="tv-menu-ico" aria-hidden="true">
                    📺
                  </span>
                  <span className="tv-menu-label">{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
                  <span className="tv-menu-meta">
                    {isFullscreen ? "Exit" : "Full"}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {(() => {
        const banner = parentControlsBanner(controlsSource);
        if (!banner) return null;
        return (
          <div
            role="status"
            data-testid="parent-controls-banner"
            style={{
              flex: "0 0 auto",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "4px 12px",
              background: "#b4321a",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            <span>{banner.text}</span>
            {banner.canTurnOn && (
              <button
                type="button"
                className="tv-ctl"
                style={{ minHeight: 26, padding: "2px 10px", fontSize: 12 }}
                onClick={() => handleToggleParentControls(false)}
              >
                {banner.button}
              </button>
            )}
          </div>
        );
      })()}

      <div className="tv-stage">
        <div ref={stageHostRef} className="tv-stage-canvas-host" />
        {titleOpen && <TitleMenu toyName={label} ready={state.ready} onChoose={chooseTitle} onNewPlayer={openOnboarding} songKey={songFlow?.phase} musicHold={onboardOpen || songFlow?.phase === "dancing"} playerName={player?.kidName} />}
        {signinToken && <SignInLanding token={signinToken} onDone={() => setSigninToken(null)} />}
        {onboardOpen && <OnboardingSheet onClose={() => { setOnboardOpen(false); try { setPlayer(readProfile(window.localStorage)); } catch { /* keep what we had */ } }} onStage={onboardStage} onHold={onboardHold} onPickUp={onboardPickUp} onIntroStart={onboardIntroStart} onSong={onboardSong} song={songFlow} />}
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

        {!mapOpen && ( // the card gives way to the Map (a song being made carries on underneath) and comes back when the Map closes
          <ThemeSongCard
            offer={songOffer !== null}
            flow={onboardOpen && songFlow && songFlow.phase !== "dancing" && songFlow.phase !== "over" ? null : songFlow} // the setup shows the song's progress itself; the dock takes over when the dance starts
            onMake={makeSong}
            onDismissOffer={() => setSongOffer(null)}
            onStopParty={stopSongParty}
            onPause={pauseSong}
            onResume={resumeSong}
            playhead={songPlayhead}
            onAgain={danceAgain}
            onNewWords={newWords}
            onClose={closeSong}
          />
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
          onScavenge={(choreId: string) => {
            setScavenge(SCAVENGER_QUESTS.find((q) => q.id === choreId) ?? null);
          }}
          onCompleteChore={completeChore}
        />

        {scavenge && (
          <ScavengerCamera
            key={scavenge.id}
            quest={scavenge}
            xp={CHORE_QUEST_XP}
            onFound={completeChore}
            onClose={() => setScavenge(null)}
          />
        )}

        {!missionPanel.open && missionPanel.hint && (
          <button
            type="button"
            className="tv-mission-chip"
            data-testid="mission-chip"
            aria-label={`${missionPanel.hint.title}: ${missionPanel.hint.done ? "play it again" : "tap to start"}`}
            onClick={() => engine()?.missionAction("open")}
          >
            <span className="tv-mission-chip-glyph" aria-hidden="true">
              {missionPanel.hint.done ? "✓" : "★"}
            </span>
            <span className="tv-mission-chip-text">
              <b>{missionPanel.hint.title}</b>
              <small>{missionPanel.hint.done ? "Play again" : "Tap to start"}</small>
            </span>
          </button>
        )}

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
            loanerKeys={
              new Set(
                garage.isWeekend && garage.dropEnabled ? loanKeys(garage.drop) : [],
              )
            }
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

        {mapOpen && !sleepActive && !songsOpen && (
          <ExplorerMap
            graph={buildExplorerGraph({
              cards: mapCards,
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
            cards={mapCards}
            guideName={label}
            ageLabel={progression.ageBand == null ? "Age: ask a grown-up" : `Age ${BANDS[progression.ageBand]?.label ?? ""}`}
            onOpenSongs={openSongs}
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

        {mapOpen && !sleepActive && songsOpen && (
          <SongStudioSheet
            songs={keptSongs}
            available={songsAvailable}
            quota={songsQuota}
            onMake={(idea) => startFromSheet(() => void getSong().flow.start(idea, "prompt"))}
            onDance={(song) => startFromSheet(() => void getSong().flow.playKept(song))}
            onClose={() => setSongsOpen(false)}
          />
        )}

        {garageOpen && !sleepActive && (
          <GarageSheet
            status={garage}
            onStart={startGarageMission}
            onFreeBuild={freeBuildFromGarage}
            onClose={() => setGarageOpen(false)}
            realLifeOn={progression.garageRealLife !== false}
            buildRealUrl={kipUrl ?? null}
            household={
              garage.kind === "household"
                ? { pictures: housePictures, ageBand: progression.ageBand ?? null, onSkipFinished: finishHouseholdSkip }
                : undefined
            }
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
          parentControlsSource={controlsSource}
          onToggleParentControls={handleToggleParentControls}
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
          garageSummary={{ title: garage.variant.title, done: garage.done }}
          garageDropOn={progression.garageDrop !== false}
          garageDays={progression.garageDays}
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
          onNewPlayer={openOnboarding}
          playerName={player?.kidName}
          onForgetPlayer={forgetThisPlayer}
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
          garageRealLifeOn={progression.garageRealLife !== false}
          garageRealDone={(progression.garageRealByDay?.[localDay(Date.now(), parentSnapshot.settings.timezone)] ?? []).includes(garage.weekendKey)}
          onSetGarageDrop={(on: boolean) => {
            const next = { ...progressionRef.current, garageDrop: on };
            saveProgression(next);
            setProgression(next);
            void pushProgression(next);
          }}
          onToggleGarageDay={(dow: number) => {
            const current = progressionRef.current.garageDays ?? [...GARAGE_DAYS_DEFAULT];
            const nextDays = current.includes(dow)
              ? current.filter((d) => d !== dow)
              : [...current, dow];
            // The last day stays: an emptied list would silently mean "every day".
            if (nextDays.length === 0) return;
            const next = { ...progressionRef.current, garageDays: nextDays };
            saveProgression(next);
            setProgression(next);
            void pushProgression(next);
          }}
          onSetGarageRealLife={(on: boolean) => {
            const next = { ...progressionRef.current, garageRealLife: on };
            saveProgression(next);
            setProgression(next);
            void pushProgression(next);
          }}
          garageHousehold={
            garage.kind === "household" ? (
              <HouseholdConfirm
                status={garage}
                pictures={housePictures}
                realLifeOn={progression.garageRealLife !== false}
                onConfirm={confirmHouseholdFound}
              />
            ) : null
          }
          onConfirmGarageReal={() => {
            const dayKey = localDay(Date.now(), parentSnapshot.settings.timezone);
            const res = completeGarageReal(progressionRef.current, garageRef.current.weekendKey, dayKey);
            if (res.next === progressionRef.current) return "Nothing to confirm yet: finish this weekend's drop in the app first.";
            saveProgression(res.next);
            setProgression(res.next);
            void pushProgression(res.next);
            const rankNote =
              res.rankAfter.rank > res.rankBefore.rank
                ? ` · Rank ${res.rankAfter.rank}: ${res.rankAfter.title}`
                : "";
            return res.awarded > 0
              ? `Built it for real! +${res.awarded} XP${rankNote}`
              : `Built it for real! The day's real-life XP was already earned.${rankNote}`;
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
