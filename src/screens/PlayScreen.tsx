import { useEffect, useMemo, useRef, useState } from "react";
import baseSetJson from "../../sets/base.json";
import { buildStats } from "../../shared/build";
import type { ToySet } from "../../shared/part";
import { toyContractFromBuild, toyWorldUrl } from "../../shared/toycontract";
import {
  runGame,
  type GameSnapshot,
  type GameStats,
} from "../features/game/engine/game";
import { colorOf } from "../features/builder/engine/render";
import { buildSignature } from "../../shared/reveal";
import { LivePlayPanel } from "../features/liveplay/LivePlayPanel";
import { useToybox } from "../state/toybox";
import { loadBuild } from "../lib/builds";

const partsById = new Map((baseSetJson as ToySet).parts.map((p) => [p.id, p]));

export function PlayScreen({ onBuild }: { onBuild?: () => void }) {
  const { selected: toy } = useToybox();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<ReturnType<typeof runGame> | null>(null);
  const [running, setRunning] = useState(false);
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [round, setRound] = useState(0);

  const placements = useMemo(() => (toy ? loadBuild(toy.id, partsById) : []), [toy, round]);
  const totals = useMemo(() => buildStats(placements, partsById).statTotals, [placements]);
  // The toy contract is what travels to ToyVentor World: the kid's toy,
  // the parts they placed, and the paint colors.
  const contract = useMemo(
    () => (toy ? toyContractFromBuild(toy, placements, partsById, colorOf) : null),
    [toy, placements],
  );
  const stats: GameStats = {
    speed: totals.speed ?? 0,
    spin: totals.spin ?? 0,
    glow: totals.glow ?? 0,
  };
  const leadPart = placements[0] ? partsById.get(placements[0].partId) : undefined;
  const toyColor = leadPart ? colorOf(leadPart) : "#e85d1f";

  const stopGame = () => {
    gameRef.current?.stop();
    gameRef.current = null;
  };

  const start = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    stopGame();
    setSnap(null);
    setRunning(true);
    gameRef.current = runGame(canvas, stats, toyColor, (s) => {
      setSnap(s);
      if (s.done) setRunning(false);
    });
  };

  useEffect(() => stopGame, []);

  // Arrow-key steering while a round runs.
  useEffect(() => {
    if (!running) return;
    const down = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") gameRef.current?.setSteer(-1);
      if (e.key === "ArrowRight") gameRef.current?.setSteer(1);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.startsWith("Arrow")) gameRef.current?.setSteer(0);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [running]);

  if (!toy) {
    return (
      <section>
        <h1>Play</h1>
        <p>Pick a toy in the Toybox first.</p>
      </section>
    );
  }

  const hold = (dir: number) => ({
    onPointerDown: () => gameRef.current?.setSteer(dir),
    onPointerUp: () => gameRef.current?.setSteer(0),
    onPointerLeave: () => gameRef.current?.setSteer(0),
    onPointerCancel: () => gameRef.current?.setSteer(0),
  });

  return (
    <section>
      <h1>Play {toy.name}</h1>
      <p className="fine-print" style={{ marginTop: 0 }}>
        {placements.length > 0 ? (
          <>
            Your build comes with you. ToyVentor World opens with{" "}
            {toy.name} already wearing the parts you placed.
          </>
        ) : (
          <>
            ToyVentor World opens with {toy.name}. Add parts in the builder
            and they come along too.
          </>
        )}
      </p>

      {contract && (
        <a
          className="cta"
          href={toyWorldUrl(contract)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Play in ToyVentor World
        </a>
      )}

      <p className="fine-print" style={{ marginTop: 0 }}>
        Quick round: thirty seconds, grab the stars. Your build drives the
        toy: speed {stats.speed}, spin {stats.spin}, glow {stats.glow}
        {placements.length === 0 ? " (no build yet, so it's stock)" : ""}.
      </p>

      <canvas
        ref={canvasRef}
        className="builder-canvas game-canvas"
        style={{ width: "100%", height: 360, touchAction: "none" }}
        aria-label="Mini game track"
      />

      <div className="builder-actions">
        {!running ? (
          <button type="button" onClick={() => { setRound(round + 1); start(); }}>
            {snap?.done ? "Play again" : "Start"}
          </button>
        ) : (
          <button type="button" onClick={() => { stopGame(); setRunning(false); }}>Stop</button>
        )}
        <button type="button" disabled={!running} {...hold(-1)}>◀ Left</button>
        <button type="button" disabled={!running} {...hold(1)}>Right ▶</button>
      </div>

      {snap && (
        <p>
          <strong>{snap.score} points</strong> · {Math.ceil(snap.timeLeft)}s left · {snap.distance} m
          {snap.done ? " · finished!" : ""}
        </p>
      )}
      {placements.length === 0 && onBuild && (
        <button type="button" className="cta cta-quiet" onClick={onBuild}>
          Build upgrades first (they make it faster)
        </button>
      )}

      <LivePlayPanel
        themeSignature={placements.length > 0 ? buildSignature(placements) : undefined}
      />
    </section>
  );
}
