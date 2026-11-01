import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { allPass, runChecks } from "../../../../shared/checks";
import {
  RARITY_PIPS,
  dailyPack,
  rarityForPart,
  sortPackForReveal,
  type PackRarity,
} from "../../../../shared/pack";
import type { Placement } from "../../../../shared/build";
import type { Toy } from "../../../../shared/toy";
import { equipPartOnBuild } from "../../../../shared/world-parts";
import { CheckList } from "../../../components/CheckList";
import { loadBuild, saveBuild } from "../../../lib/builds";
import { allParts, partsById, stlFileFor } from "../../../lib/catalog";
import { formatShortPrintTag } from "../../../lib/printRecipe";
import {
  CardBackStarSvg,
  FoilPackSvg,
  PartCardArt,
} from "../../packs/PartArt";
import { createPackAudio, vibrate, type PackAudio } from "../../packs/packAudio";

export const PACK_CLAIMED_KEY = "toyforge:pack-claimed";
const RING_CIRCUMFERENCE = 704;

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isPackClaimedToday(today = todayISO()): boolean {
  try {
    return localStorage.getItem(PACK_CLAIMED_KEY) === today;
  } catch {
    return false;
  }
}

const RARITY_STYLE: Record<
  PackRarity,
  { color: string; glowBg: string; badgeBg: string; burst: string; glowClass: string }
> = {
  common: {
    color: "#b7c2ee",
    glowBg: "rgba(183, 194, 238, 0.42)",
    badgeBg: "rgba(183, 194, 238, 0.16)",
    burst: "#dbe3ff",
    glowClass: "pack-glow-common",
  },
  uncommon: {
    color: "#5af0b0",
    glowBg: "rgba(90, 240, 176, 0.48)",
    badgeBg: "rgba(90, 240, 176, 0.16)",
    burst: "#5af0b0",
    glowClass: "pack-glow-uncommon",
  },
  rare: {
    color: "#52b7ff",
    glowBg: "rgba(82, 183, 255, 0.55)",
    badgeBg: "rgba(82, 183, 255, 0.18)",
    burst: "#52b7ff",
    glowClass: "pack-glow-rare",
  },
};

const STARS: ReadonlyArray<{ left: string; top: string; delay: string }> = [
  { left: "82%", top: "35%", delay: "-2.2s" },
  { left: "91%", top: "70%", delay: "-0.1s" },
  { left: "62%", top: "34%", delay: "-1.9s" },
  { left: "23%", top: "17%", delay: "-1.1s" },
  { left: "34%", top: "51%", delay: "-1.6s" },
  { left: "76%", top: "22%", delay: "-0.4s" },
  { left: "30%", top: "65%", delay: "-0.8s" },
  { left: "52%", top: "16%", delay: "-2.3s" },
  { left: "12%", top: "24%", delay: "-1.9s" },
  { left: "8%", top: "46%", delay: "-2.5s" },
  { left: "88%", top: "26%", delay: "-2.9s" },
  { left: "48%", top: "78%", delay: "-1.3s" },
];

type RipPhase = "idle" | "tearing" | "out" | "reveal" | "done";
type HintState = "idle" | "holding";

function readReducedMotion(): boolean {
  try {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

export function PackOverlay({
  open,
  toy,
  onClose,
  onClaimed,
  onEquipped,
}: {
  open: boolean;
  toy: Toy;
  onClose: () => void;
  onClaimed?: () => void;
  onEquipped: (placements: Placement[]) => void;
}) {
  if (!open) return null;
  return (
    <PackOverlayInner
      toy={toy}
      onClose={onClose}
      onClaimed={onClaimed}
      onEquipped={onEquipped}
    />
  );
}

function PackOverlayInner({
  toy,
  onClose,
  onClaimed,
  onEquipped,
}: {
  toy: Toy;
  onClose: () => void;
  onClaimed?: () => void;
  onEquipped: (placements: Placement[]) => void;
}) {
  const today = todayISO();
  const cards = useMemo(
    () => sortPackForReveal(dailyPack(allParts, today)),
    [today],
  );
  const initiallyClaimed = useMemo(() => isPackClaimedToday(today), [today]);

  const [phase, setPhase] = useState<RipPhase>(() =>
    initiallyClaimed ? "done" : "idle",
  );
  const [flipped, setFlipped] = useState<[boolean, boolean, boolean]>(() =>
    initiallyClaimed ? [true, true, true] : [false, false, false],
  );
  const [settled, setSettled] = useState<boolean>(initiallyClaimed);
  const [vigOn, setVigOn] = useState(false);
  const [burstKey, setBurstKey] = useState(0);
  const [hintState, setHintState] = useState<HintState>("idle");
  const [selectedIndex, setSelectedIndex] = useState<number>(() =>
    Math.max(0, cards.length - 1),
  );
  const [soundOn, setSoundOn] = useState(true);
  const [reducedMotion] = useState(readReducedMotion);

  const stageRef = useRef<HTMLDivElement>(null);
  const packShakeRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const cardsWrapRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<PackAudio | null>(null);

  const phaseRef = useRef<RipPhase>(phase);
  phaseRef.current = phase;
  const flippedRef = useRef(flipped);
  flippedRef.current = flipped;
  const reduceRef = useRef(reducedMotion);
  reduceRef.current = reducedMotion;

  const progressRef = useRef(0);
  const holdingRef = useRef(false);
  const autoRef = useRef(false);
  const tearingLockRef = useRef(false);
  const downAtRef = useRef(0);
  const hintRef = useRef<HintState>("idle");
  const runIdRef = useRef(0);
  const timersRef = useRef<Set<number>>(new Set());

  const scheduleTimeout = useCallback((fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  const clearAllTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    const audio = createPackAudio(true);
    audioRef.current = audio;
    return () => {
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioRef.current?.setEnabled(soundOn);
  }, [soundOn]);

  const spawnBurst = useCallback(
    (x: number, y: number, color: string, count: number, spread: number) => {
      if (reduceRef.current) return;
      const layer = particlesRef.current;
      if (!layer) return;
      for (let i = 0; i < count; i++) {
        const dot = document.createElement("span");
        dot.className = "pack-particle";
        const angle = Math.random() * Math.PI * 2;
        const dist = spread * (0.4 + Math.random() * 0.8);
        const size = 5 + Math.random() * 7;
        dot.style.left = `${x}px`;
        dot.style.top = `${y}px`;
        dot.style.width = `${size}px`;
        dot.style.height = `${size}px`;
        dot.style.background = color;
        dot.style.setProperty("--dx", `${(Math.cos(angle) * dist).toFixed(1)}px`);
        dot.style.setProperty("--dy", `${(Math.sin(angle) * dist).toFixed(1)}px`);
        layer.appendChild(dot);
        scheduleTimeout(() => dot.remove(), 1000);
      }
    },
    [scheduleTimeout],
  );

  const cardCenter = useCallback((index: number): [number, number] => {
    const stage = stageRef.current;
    const cardEl = cardsWrapRef.current?.children[index] as HTMLElement | undefined;
    if (!stage || !cardEl) return [180, 170];
    const cr = cardEl.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    return [cr.left - sr.left + cr.width / 2, cr.top - sr.top + cr.height / 2];
  }, []);

  const flipCard = useCallback(
    (index: number) => {
      if (flippedRef.current[index]) return;
      const next: [boolean, boolean, boolean] = [...flippedRef.current];
      next[index] = true;
      flippedRef.current = next;
      setFlipped(next);

      const part = cards[index];
      const rarity = part ? rarityForPart(part) : "common";
      const meta = RARITY_STYLE[rarity];
      const [cx, cy] = cardCenter(index);

      audioRef.current?.flip();
      audioRef.current?.chime(index);

      if (index === 0) {
        if (rarity !== "common") spawnBurst(cx, cy, meta.burst, 10, 75);
        vibrate(15);
      } else if (index === 1) {
        spawnBurst(cx, cy, meta.burst, 14, 90);
        vibrate(25);
      } else {
        audioRef.current?.fan();
        spawnBurst(cx, cy, "#ffd24d", 26, 130);
        spawnBurst(cx, cy, meta.burst, 14, 95);
        vibrate([40, 40, 60]);
        setVigOn(false);
      }
    },
    [cardCenter, cards, spawnBurst],
  );

  const persistClaim = useCallback(() => {
    try {
      localStorage.setItem(PACK_CLAIMED_KEY, today);
    } catch {
      /* ignore quota/privacy errors */
    }
    onClaimed?.();
  }, [today, onClaimed]);

  const waitMs = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        scheduleTimeout(resolve, ms);
      }),
    [scheduleTimeout],
  );

  const runRip = useCallback(async () => {
    const id = ++runIdRef.current;
    persistClaim();
    setPhase("tearing");
    phaseRef.current = "tearing";

    if (packShakeRef.current) {
      packShakeRef.current.style.transform = "none";
    }
    audioRef.current?.tear();
    vibrate(45);
    setBurstKey((n) => n + 1);

    const stage = stageRef.current;
    if (stage) {
      spawnBurst(stage.clientWidth / 2, stage.clientHeight * 0.36, "#ffe9a0", 18, 120);
    }

    await waitMs(400);
    if (id !== runIdRef.current) return;

    setPhase("out");
    phaseRef.current = "out";
    audioRef.current?.whoosh();

    await waitMs(100);
    if (id !== runIdRef.current) return;

    setPhase("reveal");
    phaseRef.current = "reveal";
    [0, 1, 2].forEach((i) => {
      scheduleTimeout(() => {
        audioRef.current?.pop(i);
        vibrate(12);
      }, 120 * i);
    });

    await waitMs(650);
    if (id !== runIdRef.current) return;
    flipCard(0);

    await waitMs(1050);
    if (id !== runIdRef.current) return;
    flipCard(1);

    await waitMs(1050);
    if (id !== runIdRef.current) return;
    if (!flippedRef.current[2]) {
      setVigOn(true);
      const [cx, cy] = cardCenter(2);
      spawnBurst(cx, cy, "#ffd24d", 10, 60);
      await waitMs(380);
      if (id !== runIdRef.current) return;
      flipCard(2);
    }

    await waitMs(900);
    if (id !== runIdRef.current) return;
    setSettled(true);
    setPhase("done");
    phaseRef.current = "done";
  }, [cardCenter, flipCard, persistClaim, scheduleTimeout, spawnBurst, waitMs]);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(250, Math.max(0, now - last));
      last = now;

      if (phaseRef.current === "idle") {
        const active = holdingRef.current || autoRef.current;
        progressRef.current = active
          ? Math.min(1, progressRef.current + dt / 1000)
          : Math.max(0, progressRef.current - dt / 300);

        const pp = progressRef.current;
        const amp = reduceRef.current ? 0 : 1 + 9 * pp;

        if (packShakeRef.current) {
          const tx = (Math.random() - 0.5) * 2 * amp;
          const ty = (Math.random() - 0.5) * 2 * amp;
          const rot = (Math.random() - 0.5) * amp * 0.35;
          const sc = 1 + 0.05 * pp;
          packShakeRef.current.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
        }
        if (stageRef.current) {
          stageRef.current.style.setProperty("--p", pp.toFixed(3));
        }
        if (ringRef.current) {
          ringRef.current.style.strokeDashoffset = (
            RING_CIRCUMFERENCE *
            (1 - pp)
          ).toFixed(1);
        }

        const nextHint: HintState = pp > 0.05 && active ? "holding" : "idle";
        if (nextHint !== hintRef.current) {
          hintRef.current = nextHint;
          setHintState(nextHint);
        }

        if (pp >= 1 && !tearingLockRef.current) {
          tearingLockRef.current = true;
          void runRip();
        }
      }

      rafId = window.requestAnimationFrame(frame);
    };

    rafId = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(rafId);
      clearAllTimers();
      runIdRef.current++;
    };
  }, [clearAllTimers, runRip]);

  const holdStart = () => {
    if (phaseRef.current !== "idle") return;
    downAtRef.current = performance.now();
    holdingRef.current = true;
    audioRef.current?.unlock();
    audioRef.current?.riser(1);
    vibrate(10);
  };

  const holdEnd = () => {
    if (phaseRef.current !== "idle") return;
    const heldMs = performance.now() - downAtRef.current;
    holdingRef.current = false;
    if (heldMs < 240 && progressRef.current < 0.9) {
      autoRef.current = true;
    }
  };

  const handleRipClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) return;
    if (phaseRef.current !== "idle" || autoRef.current || holdingRef.current) return;
    audioRef.current?.unlock();
    audioRef.current?.riser(1);
    autoRef.current = true;
  };

  const skipToResult = () => {
    runIdRef.current++;
    clearAllTimers();
    persistClaim();
    [0, 1, 2].forEach((i) => flipCard(i));
    setVigOn(false);
    setSettled(true);
    setPhase("done");
    phaseRef.current = "done";
  };

  const replayRip = () => {
    runIdRef.current++;
    clearAllTimers();
    progressRef.current = 0;
    holdingRef.current = false;
    autoRef.current = false;
    tearingLockRef.current = false;
    flippedRef.current = [false, false, false];
    hintRef.current = "idle";
    setHintState("idle");
    setFlipped([false, false, false]);
    setSettled(false);
    setVigOn(false);
    setPhase("idle");
    phaseRef.current = "idle";
    setSelectedIndex(Math.max(0, cards.length - 1));
    if (particlesRef.current) particlesRef.current.innerHTML = "";
    if (packShakeRef.current) packShakeRef.current.style.transform = "none";
    if (stageRef.current) stageRef.current.style.setProperty("--p", "0");
    if (ringRef.current) {
      ringRef.current.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
    }
  };

  const handleCardClick = (index: number) => {
    audioRef.current?.unlock();
    if (phase === "reveal" || phase === "tearing" || phase === "out") {
      const wasAllFlipped = flippedRef.current.every(Boolean);
      flipCard(index);
      setSelectedIndex(index);
      if (!wasAllFlipped && flippedRef.current.every(Boolean)) {
        runIdRef.current++;
        clearAllTimers();
        setVigOn(false);
        scheduleTimeout(() => {
          setSettled(true);
          setPhase("done");
          phaseRef.current = "done";
        }, 450);
      }
      return;
    }
    if (phase === "done") {
      audioRef.current?.pop(index);
      setSelectedIndex(index);
    }
  };

  const activePart = cards[selectedIndex] ?? cards[cards.length - 1] ?? cards[0];
  const checks = useMemo(
    () => (activePart ? runChecks(activePart, toy) : []),
    [activePart, toy],
  );
  const checksPass = checks.length > 0 && allPass(checks);
  const stlFile = stlFileFor(activePart);
  const canDownloadStl = Boolean(
    activePart?.printable && stlFile && checksPass,
  );

  const equipPulledPart = () => {
    if (!activePart) return;
    const current = loadBuild(toy.id, partsById);
    const res = equipPartOnBuild(toy, activePart, current, partsById);
    if (!res.ok) return;
    saveBuild(toy.id, res.placements);
    onEquipped(res.placements);
    onClose();
  };

  const stageClasses = [
    "pack-stage",
    reducedMotion ? "pack-reduce" : "",
    phase === "tearing" ? "pack-torn" : "",
    phase === "out" || phase === "reveal" || phase === "done" ? "pack-out" : "",
    phase === "reveal" || phase === "done" ? "pack-fan" : "",
    phase === "done" ? "pack-done" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="tv-modal" role="dialog" aria-modal="true" aria-label="Daily Pack">
      <div className="tv-sh-top">
        <div>
          <span className="kicker-label kicker-gold" style={{ margin: 0 }}>
            Daily Drop · {today}
          </span>
          <b className="tv-sh-title">
            {phase === "done" ? "Pack Opened!" : "Daily Pack"}
          </b>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {phase === "done" && (
            <button type="button" className="tv-ctl" onClick={replayRip}>
              Replay
            </button>
          )}
          <button
            type="button"
            className="tv-ctl"
            aria-pressed={!soundOn}
            onClick={() => setSoundOn((s) => !s)}
          >
            {soundOn ? "Sound" : "Muted"}
          </button>
          <button
            type="button"
            className="tv-ctl"
            aria-label="Close Daily Pack"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={stageClasses}
        style={{ "--k": 1 } as CSSProperties}
        role="region"
        aria-label="Daily pack rip stage"
      >
        <div className="pack-stage-bg" aria-hidden="true" />
        <div className="pack-starfield" aria-hidden="true">
          {STARS.map((star, idx) => (
            <i
              key={idx}
              style={{ left: star.left, top: star.top, animationDelay: star.delay }}
            />
          ))}
        </div>
        <div className="pack-glow-behind" aria-hidden="true" />

        <div
          className="pack-float"
          onPointerDown={holdStart}
          onPointerUp={holdEnd}
          onPointerLeave={() => {
            if (holdingRef.current && phaseRef.current === "idle") {
              holdingRef.current = false;
            }
          }}
          onPointerCancel={() => {
            holdingRef.current = false;
          }}
        >
          <div ref={packShakeRef} className="pack-shake">
            <FoilPackSvg />
          </div>
        </div>

        <div className="pack-ring-wrap" aria-hidden="true">
          <svg viewBox="0 0 240 240">
            <circle className="pack-ring-bg" cx="120" cy="120" r="112" />
            <circle
              ref={ringRef}
              className="pack-ring-fg"
              cx="120"
              cy="120"
              r="112"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE}
            />
          </svg>
        </div>

        {burstKey > 0 && (
          <div key={burstKey} aria-hidden="true">
            <div className="pack-rays pack-go" />
            <div className="pack-shock pack-go" />
            <div className="pack-flash pack-go" />
          </div>
        )}

        <div ref={cardsWrapRef} className="pack-fan-cards">
          {cards.map((part, idx) => {
            const rarity = rarityForPart(part);
            const meta = RARITY_STYLE[rarity];
            const isFlipped = Boolean(flipped[idx]);
            const isSelected = phase === "done" && idx === selectedIndex;
            const filledPips = RARITY_PIPS[rarity];
            const cardClasses = [
              "pack-fan-card",
              `pack-c${idx}`,
              isFlipped ? `pack-flipped ${meta.glowClass}` : "",
              settled ? "pack-settled" : "",
              settled && idx === 2 ? "pack-pulse" : "",
              isSelected ? "pack-fan-selected" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={part.id}
                type="button"
                className={cardClasses}
                aria-pressed={phase === "done" ? isSelected : undefined}
                aria-label={
                  isFlipped
                    ? `${part.name}, ${rarity}, ${part.stat.name} +${part.stat.value}`
                    : `${rarity} card ${idx + 1}, tap to flip`
                }
                style={
                  {
                    "--c": meta.color,
                    "--cg": meta.glowBg,
                    "--cg2": meta.badgeBg,
                  } as CSSProperties
                }
                onClick={() => handleCardClick(idx)}
              >
                <div className="pack-fan-inner">
                  <div className="pack-face pack-face-back">
                    <CardBackStarSvg />
                  </div>
                  <div className="pack-face pack-face-front">
                    <div className="pack-fan-art">
                      <PartCardArt part={part} />
                    </div>
                    <div className="pack-fan-name">{part.name}</div>
                    <div className="pack-fan-rar">{rarity}</div>
                    <div className="pack-fan-pips" aria-hidden="true">
                      {[0, 1, 2, 3, 4].map((pip) => (
                        <i
                          key={pip}
                          className={pip < filledPips ? undefined : "off"}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className={vigOn ? "pack-vig on" : "pack-vig"} aria-hidden="true" />
        <div ref={particlesRef} className="pack-particles" aria-hidden="true" />

        <div className="pack-hint" aria-live="polite">
          <span>{hintState === "holding" ? "Keep holding" : "Hold to rip"}</span>
          <small>Or tap the button once</small>
        </div>

        <button
          type="button"
          className="pack-rip-btn"
          aria-label="Hold to rip today's pack, or tap once to rip automatically"
          onPointerDown={holdStart}
          onPointerUp={holdEnd}
          onPointerLeave={() => {
            if (holdingRef.current && phaseRef.current === "idle") {
              holdingRef.current = false;
            }
          }}
          onPointerCancel={() => {
            holdingRef.current = false;
          }}
          onClick={handleRipClick}
        >
          Hold to rip
        </button>

        {(phase === "tearing" || phase === "out" || phase === "reveal") && (
          <button
            type="button"
            className="pack-skip-btn"
            style={{ opacity: 1, pointerEvents: "auto" }}
            onClick={skipToResult}
          >
            Skip
          </button>
        )}
      </div>

      {phase === "done" && activePart && (
        <div className="tv-pack-summary">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div>
              <strong style={{ fontFamily: "var(--font-display)", fontSize: 16 }}>
                {activePart.name}
              </strong>
              <span
                style={{
                  color: "var(--sky-300)",
                  fontSize: 13,
                  marginLeft: 8,
                  fontWeight: 700,
                }}
              >
                {activePart.stat.name} +{activePart.stat.value}
              </span>
            </div>
            <span className={checksPass ? "tv-ok-pill" : "tv-warn-pill"}>
              {checksPass
                ? `Fits ${toy.name}`
                : `${activePart.sizeClass} toy part`}
            </span>
          </div>

          {activePart.smallPartWarning && (
            <p className="tv-small-part-warn" style={{ margin: 0 }} role="note">
              Ages 3+ · Choking hazard (small parts, ASTM F963 / 16 CFR § 1500.19).
            </p>
          )}

          <button
            type="button"
            className="cta"
            style={{ margin: 0, minHeight: 48, fontSize: 16 }}
            disabled={!checksPass}
            onClick={equipPulledPart}
          >
            {checksPass
              ? `Equip ${activePart.name} on ${toy.name}`
              : `Fits ${activePart.sizeClass} toys (${toy.name} is ${toy.sizeClass})`}
          </button>

          {canDownloadStl && (
            <a
              className="cta cta-quiet"
              style={{ margin: 0, minHeight: 38, fontSize: 13 }}
              href={`/parts-stl/${stlFile}`}
              download={stlFile}
            >
              Download {activePart.name}.stl ({formatShortPrintTag(activePart)} · Prototype)
            </a>
          )}

          <details className="tv-disclosure" style={{ padding: "6px 10px" }}>
            <summary>
              <span>Fit &amp; print check</span>
              <span className="tv-disclosure-meta">
                {activePart.printable ? formatShortPrintTag(activePart) : "Digital skin"}
              </span>
            </summary>
            <div style={{ marginTop: 8 }}>
              <CheckList results={checks} />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
