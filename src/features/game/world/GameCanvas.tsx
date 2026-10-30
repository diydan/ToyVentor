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
import type { Toy } from "../../../../shared/toy";
import type { ToyContract } from "../../../../shared/toycontract";
import { revealForBuild } from "../../../state/reveals";
import { buildStats } from "../../../../shared/build";
import { localDay } from "../../../../shared/parent-time";
import { partsById } from "../../../lib/catalog";
import {
  getLocalParentSnapshot,
  pullParentTime,
  recordPlayProgress,
  type ParentSnapshot,
} from "../../../lib/parentTime";
import {
  applySolve,
  grandfatherToyIds,
  loadProgression,
  mergeProgression,
  MISSION_STAT,
  missionTypeOf,
  nextRankProgress,
  pullProgression,
  pushProgression,
  resetProgression,
  saveProgression,
  type MissionType,
  type ProgressionState,
} from "../../../lib/progression";
import { LivePlayPanel, type LivePlayStatus } from "../../liveplay/LivePlayPanel";
import { CreatePanel } from "./CreatePanel";
import { EditorPanel } from "./EditorPanel";
import {
  createEngine,
  createWorldStore,
  worldUrlFor,
  WORLDS,
  type EngineHandle,
} from "./engine";
import { GrownUpsSheet } from "./GrownUpsSheet";
import { MissionPanel } from "./MissionPanel";
import { MyToySheet } from "./MyToySheet";
import { isPackClaimedToday, PackOverlay } from "./PackOverlay";
import { RevealOverlay } from "./RevealOverlay";
import { SleepCurtain } from "./SleepCurtain";
import { ToyCustomizer } from "./ToyCustomizer";

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
  const [liveStatus, setLiveStatus] = useState<LivePlayStatus>({
    playing: false,
    listening: false,
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [grownUpsOpen, setGrownUpsOpen] = useState(initialOverlay === "parent");
  const [parentSnapshot, setParentSnapshot] = useState<ParentSnapshot>(() =>
    getLocalParentSnapshot(),
  );
  const [missionGraceUntil, setMissionGraceUntil] = useState(0);
  const prevLockedRef = useRef(parentSnapshot.status.locked);
  const [progression, setProgression] = useState<ProgressionState>(() =>
    loadProgression(),
  );
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
          if (event.type === "missionSolved") {
            const { key, attempts, error, stats } = event.detail;
            const type = missionTypeOf(key) as MissionType;
            const stat = MISSION_STAT[type];
            const totals = buildStats(placementsRef.current, partsById).statTotals;
            const stageHasStat = Boolean(stat && stats?.includes(stat));
            const partMatch = stat
              ? (totals[stat] ?? 0) > 0 || stageHasStat
              : false;
            const timezone = getLocalParentSnapshot().settings.timezone;
            const result = applySolve(progressionRef.current, {
              missionId: key,
              tier: 1,
              attempts,
              clean: error === 0,
              partMatch,
              day: localDay(Date.now(), timezone),
            });
            saveProgression(result.next);
            setProgression(result.next);
            void pushProgression(result.next);
            if (result.awarded > 0) {
              showXpToast(
                `+${result.awarded} XP · ${"★".repeat(result.stars)}${"☆".repeat(3 - result.stars)}`,
              );
            } else if (result.stars > 0) {
              showXpToast(`${"★".repeat(result.stars)}${"☆".repeat(3 - result.stars)}`);
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
  }, [store]);

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

  // Honor queued Build/Create/Editor open once the World iframe reports ready.
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
  const sleepActive = parentSnapshot.status.locked && !missionGraceActive;

  // Close `⋯` popover on outside pointerdown or Escape.
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        moreWrapRef.current &&
        !moreWrapRef.current.contains(e.target as Node)
      ) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const engine = () => engineRef.current;

  const closeEngineSheets = useCallback(() => {
    if (customizer.open) engine()?.closeCustomizer();
    if (create.open) engine()?.closeCreate();
    if (editor.open) engine()?.closeEditor();
    if (missionPanel.open) engine()?.missionAction("later");
  }, [customizer.open, create.open, editor.open, missionPanel.open]);

  const closeReactOverlays = useCallback(() => {
    setToySheetOpen(false);
    setPackOpen(false);
    setRevealState(null);
    setMoodsOpen(false);
    setMoreOpen(false);
    setGrownUpsOpen(false);
  }, []);

  const openGrownUps = useCallback(() => {
    closeEngineSheets();
    closeReactOverlays();
    setParentSnapshot(getLocalParentSnapshot());
    setGrownUpsOpen(true);
  }, [closeEngineSheets, closeReactOverlays]);

  // Calmly wind down audio, mic, and open kid sheets when the Sleep Curtain activates.
  useEffect(() => {
    if (!sleepActive) return;
    closeEngineSheets();
    setToySheetOpen(false);
    setPackOpen(false);
    setRevealState(null);
    setMoodsOpen(false);
    setMoreOpen(false);
    setLiveStatus({ playing: false, listening: false });
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
  const hasSavedCard = Boolean(
    themeSignature && revealForBuild(toy.id, themeSignature),
  );

  const moreAriaLabel = liveStatus.listening
    ? "More (microphone listening)"
    : liveStatus.playing
      ? "More (story music playing)"
      : "More";

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
          <span
            className="tv-toy-dot"
            aria-hidden="true"
            style={{ background: toyColor }}
          />
          <span className="tv-toy-pill-name">{label}</span>
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
                editor.open ||
                grownUpsOpen ||
                Boolean(revealState)
              }
              onClick={() => setMoreOpen((open) => !open)}
            >
              {liveStatus.listening ? (
                <span className="tv-mic-dot" aria-hidden="true" />
              ) : liveStatus.playing ? (
                <span className="tv-badge-dot" aria-hidden="true" />
              ) : null}
              ⋯
            </button>

            {moreOpen && (
              <div
                className="tv-more-menu"
                role="menu"
                aria-label="More studio tools"
              >
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
                    setRevealState({ first: false });
                  }}
                >
                  <span>Character Card</span>
                  <span className="tv-menu-meta">
                    {placements.length > 0 ? "Share" : "Build"}
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="tv-menu-item"
                  disabled={sleepActive}
                  onClick={() => {
                    closeReactOverlays();
                    if (customizer.open) engine()?.closeCustomizer();
                    if (create.open) engine()?.closeCreate();
                    if (editor.open) engine()?.closeEditor();
                    else if (state.ready) engine()?.openEditor();
                    else pendingEngineOpenRef.current = "editor";
                  }}
                >
                  <span>Level Editor</span>
                  <span className="tv-menu-meta">
                    {editor.open ? "Open" : "Grid"}
                  </span>
                </button>

                {kipUrl && !sleepActive && (
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
                  onClick={openGrownUps}
                >
                  <span>Grown-ups</span>
                  <span className="tv-menu-meta">
                    {parentSnapshot.settings.enabled ? "On" : "Time"}
                  </span>
                </button>

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
        </div>
      </div>

      <div className="tv-stage">
        <div ref={stageHostRef} className="tv-stage-canvas-host" />
        {!sleepActive && (
          <div className="tv-worlds" role="tablist" aria-label="Worlds">
            {WORLDS.map((w) => (
              <button key={w.id} type="button" role="tab" aria-selected={state.world === w.id}
                className={state.world === w.id ? "tv-world tv-world-on" : "tv-world"}
                onClick={() => engine()?.goWorld(w.id)}>{w.label}</button>
            ))}
          </div>
        )}

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
          onClose={() => setToySheetOpen(false)}
          onSkinChange={onSkinChange}
          onOpenGrownUps={openGrownUps}
        />

        {missionPanel.open && (
          <MissionPanel
            snapshot={missionPanel}
            onAction={(action) => engine()?.missionAction(action)}
            onControl={(index) => engine()?.missionControl(index)}
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
              setRevealState({ first: false });
            }}
            snapshot={customizer}
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

        <PackOverlay
          open={packOpen}
          toy={toy}
          onClose={() => setPackOpen(false)}
          onClaimed={() => setPackClaimed(true)}
          onEquipped={(next) => onPlacementsChange(next)}
        />

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
          onOpenGrownUps={openGrownUps}
        />

        <GrownUpsSheet
          open={grownUpsOpen}
          snapshot={parentSnapshot}
          progression={progression}
          onResetXp={() => {
            const next = resetProgression(progressionRef.current);
            saveProgression(next);
            setProgression(next);
            void pushProgression(next);
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
          onSnapshotChange={setParentSnapshot}
          onClose={() => setGrownUpsOpen(false)}
        />
      </div>
    </div>
  );
}
