import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ToyContract } from "../../../../shared/toycontract";
import { LivePlayPanel } from "../../liveplay/LivePlayPanel";
import {
  createEngine,
  createWorldStore,
  worldUrlFor,
  type EngineHandle,
} from "./engine";
import { ToyCustomizer } from "./ToyCustomizer";
import { MissionPanel } from "./MissionPanel";
import { CreatePanel } from "./CreatePanel";
import { EditorPanel } from "./EditorPanel";

export interface GameCanvasProps {
  contract: ToyContract | null;
  toyName?: string;
  toyColor?: string;
  statSummary?: string;
  themeSignature?: string;
  kipUrl?: string;
  onBuild?: () => void;
}

/**
 * Full-bleed React host for ToyVentor World.
 * The 3D Three.js engine runs full-height inside the stage while React owns
 * the studio dock above and the frosted-glass bottom sheets (Customizer,
 * Forge, Mission, Create, Editor, and Live Play Moods) overlaid on the stage.
 */
export function GameCanvas({
  contract,
  toyName,
  toyColor = "#52b7ff",
  statSummary,
  themeSignature,
  kipUrl,
  onBuild,
}: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const contractRef = useRef(contract);
  contractRef.current = contract;
  const [store] = useState(createWorldStore);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const toyUrl = useMemo(() => worldUrlFor(contract), [contract]);
  const firstToy = useRef(true);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [moodsOpen, setMoodsOpen] = useState(false);
  const [moodsActive, setMoodsActive] = useState(false);

  // Create the engine once per mount; dispose on unmount and on HMR.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const engine = createEngine(
      frame,
      { onEvent: (event) => store.apply(event) },
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

  // A new build means a new contract: reload the world wearing it.
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

  // Close the Moods drawer automatically if a game sheet opens.
  useEffect(() => {
    if (anyGameSheetOpen && moodsOpen) setMoodsOpen(false);
  }, [anyGameSheetOpen, moodsOpen]);

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

  const engine = () => engineRef.current;
  const label = toyName || contract?.name || "ToyVentor World";

  return (
    <div
      ref={hostRef}
      className={isFullscreen ? "tv-host tv-host-fullscreen" : "tv-host"}
    >
      <div className="tv-dock" role="toolbar" aria-label="ToyVentor World studio">
        <span className="tv-toy-badge" title={statSummary ? `${label} (${statSummary})` : label}>
          <span
            className="tv-toy-dot"
            aria-hidden="true"
            style={{ background: toyColor }}
          />
          <span>{label}</span>
          {statSummary && (
            <span style={{ color: "var(--gold)", fontSize: 12 }}>
              · {statSummary}
            </span>
          )}
        </span>

        <div className="tv-dock-scroll">
          {onBuild && (
            <button
              type="button"
              className="tv-ctl"
              onClick={onBuild}
              title="Snap parts onto your toy in the builder"
            >
              {statSummary ? "Edit build" : "+ Upgrades"}
            </button>
          )}
          {state.ready && (
            <>
              <button
                type="button"
                className="tv-ctl"
                aria-pressed={customizer.open && !customizer.forge}
                onClick={() => {
                  setMoodsOpen(false);
                  if (!customizer.open) engine()?.openCustomizer("build");
                  else if (customizer.forge) engine()?.factoryAction("forge");
                  else engine()?.closeCustomizer();
                }}
              >
                Customize
              </button>
              <button
                type="button"
                className="tv-ctl tv-ctl-gold-ring"
                aria-pressed={customizer.open && customizer.forge}
                onClick={() => {
                  setMoodsOpen(false);
                  if (!customizer.open) engine()?.openCustomizer("forge");
                  else if (!customizer.forge) engine()?.factoryAction("forge");
                  else engine()?.closeCustomizer();
                }}
              >
                Forge
              </button>
              <button
                type="button"
                className="tv-ctl tv-ctl-violet"
                aria-pressed={create.open}
                onClick={() => {
                  setMoodsOpen(false);
                  if (create.open) engine()?.closeCreate();
                  else engine()?.openCreate();
                }}
              >
                Create
              </button>
              <button
                type="button"
                className="tv-ctl"
                aria-pressed={editor.open}
                onClick={() => {
                  setMoodsOpen(false);
                  if (editor.open) engine()?.closeEditor();
                  else engine()?.openEditor();
                }}
              >
                Editor
              </button>
            </>
          )}
          <button
            type="button"
            className="tv-ctl"
            aria-pressed={moodsOpen}
            onClick={() => {
              if (!moodsOpen) {
                if (customizer.open) engine()?.closeCustomizer();
                if (create.open) engine()?.closeCreate();
                if (editor.open) engine()?.closeEditor();
              }
              setMoodsOpen((open) => !open);
            }}
          >
            {moodsActive && (
              <span
                className="tv-opt-dot"
                aria-hidden="true"
                style={{ background: "var(--gold)" }}
              />
            )}
            Moods
          </button>
          {kipUrl && (
            <a
              className="tv-ctl"
              href={kipUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Kip 3D
            </a>
          )}
          <button
            type="button"
            className="tv-ctl"
            aria-pressed={isFullscreen}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? "Exit" : "Full"}
          </button>
        </div>
      </div>

      <div className="tv-stage">
        <iframe
          ref={frameRef}
          className="tv-frame"
          title="ToyVentor World"
        />

        {editor.testing && !editor.open && !create.open && (
          <button
            type="button"
            className="tv-ctl tv-ctl-primary tv-ed-back"
            onClick={() => engine()?.editorAction("back")}
          >
            {editor.backLabel}
          </button>
        )}

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
            snapshot={customizer}
            onClose={() => engine()?.closeCustomizer()}
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
          aria-label="Live Play moods"
          hidden={!moodsOpen}
        >
          <LivePlayPanel
            themeSignature={themeSignature}
            onClose={() => setMoodsOpen(false)}
            onActiveChange={setMoodsActive}
          />
        </section>
      </div>
    </div>
  );
}
