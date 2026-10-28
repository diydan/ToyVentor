// Mini game core: pure step logic (testable) plus a canvas runner.
// The frame loop lives here, never in React state — the host screen gets
// a coarse snapshot a few times a second (docs/decisions/0001).
export interface GameStats {
  speed: number;
  spin: number;
  glow: number;
}

export interface Star { lane: number; ahead: number; taken: boolean }

export interface GameState {
  /** -1..1 across the track */
  x: number;
  distance: number;
  score: number;
  timeLeft: number;
  done: boolean;
  stars: Star[];
  stats: GameStats;
}

export const GAME_SECONDS = 30;
const STAR_EVERY = 26; // metres between stars

function seededLane(i: number): number {
  // Deterministic pseudo-random lane in [-0.75, 0.75].
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return (v - Math.floor(v)) * 1.5 - 0.75;
}

export function createGame(stats: GameStats): GameState {
  const stars: Star[] = [];
  for (let i = 0; i < 40; i++) stars.push({ lane: seededLane(i + 1), ahead: (i + 1) * STAR_EVERY, taken: false });
  return { x: 0, distance: 0, score: 0, timeLeft: GAME_SECONDS, done: false, stars, stats };
}

/** Advance the game. steer is -1, 0 or 1. Pure: same inputs, same result. */
export function stepGame(state: GameState, dtSeconds: number, steer: number): GameState {
  if (state.done || dtSeconds <= 0) return state;
  const speed = 9 + state.stats.speed * 2.2; // m/s, build stats matter
  const steerRate = 1.4 + state.stats.spin * 0.25;
  const x = Math.max(-0.92, Math.min(0.92, state.x + steer * steerRate * dtSeconds));
  const distance = state.distance + speed * dtSeconds;
  const starValue = 10 + state.stats.glow * 2;
  let score = state.score;
  const stars = state.stars.map((s) => {
    if (!s.taken && Math.abs(s.ahead - distance) < 2.2 && Math.abs(s.lane - x) < 0.28) {
      score += starValue;
      return { ...s, taken: true };
    }
    return s;
  });
  const timeLeft = Math.max(0, state.timeLeft - dtSeconds);
  return { ...state, x, distance, score, stars, timeLeft, done: timeLeft <= 0 };
}

export interface GameSnapshot { score: number; timeLeft: number; done: boolean; distance: number }

export function runGame(
  canvas: HTMLCanvasElement,
  stats: GameStats,
  toyColor: string,
  onSnapshot: (s: GameSnapshot) => void,
): { stop: () => void; setSteer: (dir: number) => void } {
  const ctx = canvas.getContext("2d")!;
  let state = createGame(stats);
  let steer = 0;
  let raf = 0;
  let last = performance.now();
  let sinceSnapshot = 1;

  const draw = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Track
    ctx.fillStyle = "#2f3a33";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#46534b";
    const roadW = w * 0.62, roadX = (w - roadW) / 2;
    ctx.fillRect(roadX, 0, roadW, h);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 22]);
    ctx.lineDashOffset = (state.distance * 14) % 40;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    ctx.setLineDash([]);
    // Stars
    for (const s of state.stars) {
      if (s.taken) continue;
      const aheadM = s.ahead - state.distance;
      if (aheadM < -2 || aheadM > 70) continue;
      const sy = h * 0.78 - aheadM * (h / 70);
      const sx = w / 2 + s.lane * roadW * 0.5;
      ctx.fillStyle = "#f5c542";
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7a5b00";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("★", sx, sy + 4);
    }
    // Toy (top-down block with a spoiler stripe)
    const tx = w / 2 + state.x * roadW * 0.5;
    const ty = h * 0.78;
    ctx.fillStyle = toyColor;
    ctx.beginPath();
    ctx.roundRect(tx - 22, ty - 34, 44, 68, 9);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(tx - 22, ty + 18, 44, 9);
    // Score/time HUD lives in the React snapshot line, not duplicated here.
    if (state.done) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Finished! ${state.score} points`, w / 2, h / 2);
    }
  };

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state = stepGame(state, dt, steer);
    draw();
    sinceSnapshot += dt;
    if (sinceSnapshot > 0.25 || state.done) {
      sinceSnapshot = 0;
      onSnapshot({ score: state.score, timeLeft: state.timeLeft, done: state.done, distance: Math.round(state.distance) });
    }
    if (!state.done) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    stop: () => cancelAnimationFrame(raf),
    setSteer: (dir) => { steer = dir; },
  };
}
