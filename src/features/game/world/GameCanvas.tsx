import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ToyContract } from "../../../../shared/toycontract";
import {
  WORLDS,
  ZOOM_LEVELS,
  createEngine,
  createWorldStore,
  nextZoom,
  worldUrlFor,
  type EngineHandle,
} from "./engine";
import { ToyCustomizer } from "./ToyCustomizer";
import { MissionPanel } from "./MissionPanel";

/**
 * React host for ToyVentor World (port step 1). The legacy engine keeps
 * its own canvas and render loop inside the frame; React owns this HUD
 * around it and talks through createEngine. Mounting is StrictMode-safe:
 * the effect cleanup disposes the engine, and a remount creates a fresh
 * one on the same frame element.
 */
export function GameCanvas({ contract }: { contract: ToyContract | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const contractRef = useRef(contract);
  contractRef.current = contract;
  const [store] = useState(createWorldStore);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [height, setHeight] = useState(420);
  const toyUrl = useMemo(() => worldUrlFor(contract), [contract]);
  const firstToy = useRef(true);

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

  // Size from the container, not the window: keep a play-friendly aspect.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (!width) return;
      const next = Math.round(Math.max(340, Math.min(560, width * 0.62)));
      setHeight((prev) => (Math.abs(prev - next) >= 2 ? next : prev));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const engine = () => engineRef.current;
  const customizer = state.customizer;
  const missionPanel = state.missionPanel;
  const frameHeight = customizer.open || missionPanel.open ? Math.min(height, 360) : height;

  return (
    <div ref={hostRef}>
      <div className="builder-actions" role="group" aria-label="ToyVentor World">
        <button
          type="button"
          onClick={() =>
            customizer.open ? engine()?.closeCustomizer() : engine()?.start()
          }
        >
          Play
        </button>
        <button
          type="button"
          aria-pressed={customizer.open && !customizer.forge}
          className={customizer.open && !customizer.forge ? "mood-active" : undefined}
          onClick={() => {
            if (!customizer.open) engine()?.openCustomizer("build");
            else if (customizer.forge) engine()?.factoryAction("forge");
            else engine()?.closeCustomizer();
          }}
        >
          Customize
        </button>
        <button
          type="button"
          aria-pressed={customizer.open && customizer.forge}
          className={customizer.open && customizer.forge ? "mood-active" : undefined}
          onClick={() => {
            if (!customizer.open) engine()?.openCustomizer("forge");
            else if (!customizer.forge) engine()?.factoryAction("forge");
          }}
        >
          Forge
        </button>
        <button
          type="button"
          onClick={() => engine()?.setZoom(nextZoom(state.zoom))}
          aria-label={`Zoom: ${ZOOM_LEVELS[state.zoom]}. Tap to change`}
        >
          Zoom: {ZOOM_LEVELS[state.zoom]}
        </button>
        {WORLDS.map((world) => (
          <button
            key={world.id}
            type="button"
            aria-pressed={state.world === world.id}
            className={state.world === world.id ? "mood-active" : undefined}
            onClick={() => engine()?.goWorld(world.id)}
          >
            {world.label}
          </button>
        ))}
      </div>

      {missionPanel.open && (
        <MissionPanel
          snapshot={missionPanel}
          onAction={(action) => engine()?.missionAction(action)}
          onControl={(index) => engine()?.missionControl(index)}
        />
      )}

      <p className="fine-print" style={{ marginTop: 0 }} aria-live="polite">
        {state.ready
          ? `${state.foundTotal} hidden parts found${state.toast ? ` · ${state.toast}` : ""}`
          : "Loading ToyVentor World…"}
      </p>

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

      <iframe
        ref={frameRef}
        title="ToyVentor World"
        style={{
          width: "100%",
          height: frameHeight,
          border: 0,
          display: "block",
          background: "#080f2b",
        }}
      />
    </div>
  );
}
