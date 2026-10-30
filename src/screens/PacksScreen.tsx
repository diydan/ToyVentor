import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import {
  RARITY_PIPS,
  dailyPack,
  rarityForPart,
  sortPackForReveal,
  type PackRarity,
} from "../../shared/pack";
import { PartCard } from "../components/PartCard";
import { CardBackStarSvg, FoilPackSvg, PartCardArt } from "../features/packs/PartArt";
import { createPackAudio, vibrate, type PackAudio } from "../features/packs/packAudio";
import { allParts, stlFileFor } from "../lib/catalog";
import { useToybox } from "../state/toybox";

const KEY = "toyforge:pack-claimed";
const RING_CIRCUMFERENCE = 704;

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
type HintState = "idle" | "holding" | "shaking";

type MotionWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readInitialReducedMotion(): boolean {
  try {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

export function PacksScreen({
  onBuild,
  onPlay,
}: {
  onBuild?: () => void;
  onPlay?: () => void;
}) {
  const { selected: toy } = useToybox();
  const today = todayISO();

  // Seeded daily drop, ordered lowest-to-highest rarity so card 3 is the climax.
  const cards = useMemo(
    () => sortPackForReveal(dailyPack(allParts, today)),
    [today],
  );

  const initiallyClaimed = useMemo(() => {
    try {
      return localStorage.getItem(KEY) === today;
    } catch {
      return false;
    }
  }, [today]);

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

  // Interactive controls ported from drafts/ToyVentor-PackRip-ToyWorld.html
  const [soundOn, setSoundOn] = useState(true);
  const [slowMo, setSlowMo] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(readInitialReducedMotion);
  const [shakeOn, setShakeOn] = useState(false);
  const [showTryShake, setShowTryShake] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Refs for 60fps imperative hold/shake updates and leak-free teardown
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
  const slowRef = useRef(slowMo);
  slowRef.current = slowMo;
  const reduceRef = useRef(reducedMotion);
  reduceRef.current = reducedMotion;
  const shakeOnRef = useRef(shakeOn);
  shakeOnRef.current = shakeOn;

  const progressRef = useRef(0);
  const shakeProgressRef = useRef(0);
  const holdingRef = useRef(false);
  const autoRef = useRef(false);
  const tearingLockRef = useRef(false);
  const downAtRef = useRef(0);
  const lastPeakRef = useRef(0);
  const kickAtRef = useRef(0);
  const kickVecRef = useRef<[number, number]>([0, 0]);
  const lastMotionRef = useRef<[number, number, number] | null>(null);
  const sensorSeenRef = useRef(false);
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

  const showToast = useCallback(
    (msg: string) => {
      setToast(msg);
      scheduleTimeout(() => {
        setToast((cur) => (cur === msg ? null : cur));
      }, 2400);
    },
    [scheduleTimeout],
  );

  // Audio lifecycle: created once per mount, closed on unmount.
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
      const k = slowRef.current ? 2 : 1;
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
        scheduleTimeout(() => dot.remove(), 1000 * k);
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
        // Finale card always gets the fanfare + double burst
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
      localStorage.setItem(KEY, today);
    } catch {
      /* ignore quota/privacy errors */
    }
  }, [today]);

  const waitScaled = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const k = slowRef.current ? 2 : 1;
        scheduleTimeout(resolve, ms * k);
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

    await waitScaled(400);
    if (id !== runIdRef.current) return;

    setPhase("out");
    phaseRef.current = "out";
    audioRef.current?.whoosh();

    await waitScaled(100);
    if (id !== runIdRef.current) return;

    setPhase("reveal");
    phaseRef.current = "reveal";
    const k = slowRef.current ? 2 : 1;
    [0, 1, 2].forEach((i) => {
      scheduleTimeout(() => {
        audioRef.current?.pop(i);
        vibrate(12);
      }, 120 * i * k);
    });

    await waitScaled(650);
    if (id !== runIdRef.current) return;
    flipCard(0);

    await waitScaled(1050);
    if (id !== runIdRef.current) return;
    flipCard(1);

    await waitScaled(1050);
    if (id !== runIdRef.current) return;
    if (!flippedRef.current[2]) {
      setVigOn(true);
      const [cx, cy] = cardCenter(2);
      spawnBurst(cx, cy, "#ffd24d", 10, 60);
      await waitScaled(380);
      if (id !== runIdRef.current) return;
      flipCard(2);
    }

    await waitScaled(900);
    if (id !== runIdRef.current) return;
    setSettled(true);
    setPhase("done");
    phaseRef.current = "done";
  }, [cardCenter, flipCard, persistClaim, scheduleTimeout, spawnBurst, waitScaled]);

  // 60fps hold & shake loop while idle; stops cleanly on unmount.
  useEffect(() => {
    let rafId = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(250, Math.max(0, now - last));
      last = now;

      if (phaseRef.current === "idle") {
        const k = slowRef.current ? 2 : 1;
        const active = holdingRef.current || autoRef.current;
        progressRef.current = active
          ? Math.min(1, progressRef.current + dt / (1000 * k))
          : Math.max(0, progressRef.current - dt / (300 * k));

        if (now - lastPeakRef.current > 350) {
          shakeProgressRef.current = Math.max(0, shakeProgressRef.current - dt / 1200);
        }

        const pp = Math.max(progressRef.current, shakeProgressRef.current);
        const amp = reduceRef.current ? 0 : 1 + 9 * pp;
        let kx = 0;
        let ky = 0;
        const kd = now - kickAtRef.current;
        if (!reduceRef.current && kd < 160) {
          const kf = 1 - kd / 160;
          kx = kickVecRef.current[0] * kf;
          ky = kickVecRef.current[1] * kf;
        }

        if (packShakeRef.current) {
          const tx = (Math.random() - 0.5) * 2 * amp + kx;
          const ty = (Math.random() - 0.5) * 2 * amp + ky;
          const rot = (Math.random() - 0.5) * amp * 0.35;
          const sc = 1 + 0.05 * pp;
          packShakeRef.current.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
        }
        if (stageRef.current) {
          stageRef.current.style.setProperty("--p", pp.toFixed(3));
        }
        if (ringRef.current) {
          ringRef.current.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - pp)).toFixed(1);
        }

        const nextHint: HintState =
          pp > 0.05 && (active || shakeProgressRef.current > 0.05)
            ? shakeProgressRef.current > progressRef.current
              ? "shaking"
              : "holding"
            : "idle";
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
    const vibTimer = window.setInterval(() => {
      if (phaseRef.current === "idle" && holdingRef.current && progressRef.current > 0.05) {
        vibrate(Math.round(8 + progressRef.current * 30));
      }
    }, 100);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearInterval(vibTimer);
      clearAllTimers();
      runIdRef.current++;
    };
  }, [clearAllTimers, runRip]);

  const jolt = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    const now = performance.now();
    lastPeakRef.current = now;
    shakeProgressRef.current = Math.min(1, shakeProgressRef.current + 0.26);
    kickAtRef.current = now;
    kickVecRef.current = [(Math.random() - 0.5) * 34, (Math.random() - 0.5) * 34];
    audioRef.current?.unlock();
    audioRef.current?.tick(shakeProgressRef.current);
    vibrate(Math.round(12 + shakeProgressRef.current * 30));
  }, []);

  // Optional device-motion shake listener, cleaned up when turned off or unmounted.
  useEffect(() => {
    if (!shakeOn) {
      shakeProgressRef.current = 0;
      lastMotionRef.current = null;
      return;
    }
    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      sensorSeenRef.current = true;
      const x = a.x || 0;
      const y = a.y || 0;
      const z = a.z || 0;
      const prev = lastMotionRef.current;
      if (prev && shakeOnRef.current && phaseRef.current === "idle" && !document.hidden) {
        const dx = x - prev[0];
        const dy = y - prev[1];
        const dz = z - prev[2];
        const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (delta > 12 && performance.now() - lastPeakRef.current > 110) {
          jolt();
        }
      }
      lastMotionRef.current = [x, y, z];
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [jolt, shakeOn]);

  const toggleShake = async () => {
    if (shakeOn) {
      setShakeOn(false);
      setShowTryShake(false);
      return;
    }
    let perm = "";
    try {
      const Motion =
        typeof DeviceMotionEvent !== "undefined"
          ? (DeviceMotionEvent as MotionWithPermission)
          : undefined;
      if (typeof Motion?.requestPermission === "function") {
        perm = await Motion.requestPermission();
      }
    } catch {
      perm = "error";
    }
    sensorSeenRef.current = false;
    lastMotionRef.current = null;
    setShakeOn(true);
    scheduleTimeout(() => {
      if (!shakeOnRef.current || sensorSeenRef.current) return;
      const prefix =
        perm === "denied" || perm === "error"
          ? "Motion access was not allowed. "
          : "No motion sensor found here. ";
      showToast(`${prefix}Hold or tap still works, and Try a shake previews it.`);
      setShowTryShake(true);
    }, 1500);
  };

  const holdStart = () => {
    if (phaseRef.current !== "idle") return;
    downAtRef.current = performance.now();
    holdingRef.current = true;
    audioRef.current?.unlock();
    audioRef.current?.riser(slowRef.current ? 2 : 1);
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
    // Pointer taps/holds are handled by pointerdown/pointerup; click with
    // detail === 0 covers keyboard and assistive-tech activation.
    if (event.detail !== 0) return;
    if (phaseRef.current !== "idle" || autoRef.current || holdingRef.current) return;
    audioRef.current?.unlock();
    audioRef.current?.riser(slowRef.current ? 2 : 1);
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
    shakeProgressRef.current = 0;
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
    if (ringRef.current) ringRef.current.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
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

  const hintPrimary =
    hintState === "shaking"
      ? "Keep shaking"
      : hintState === "holding"
        ? "Keep holding"
        : shakeOn
          ? "Hold or shake to rip"
          : "Hold to rip";

  return (
    <section>
      <header className="screen-head">
        <h1 className="screen-title">Daily Pack</h1>
        <span className="kicker-label kicker-gold" style={{ margin: 0 }}>
          {today}
        </span>
      </header>

      <div
        ref={stageRef}
        className={stageClasses}
        style={{ "--k": slowMo ? 2 : 1 } as CSSProperties}
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

        {/* Floating crimped foil pack */}
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

        {/* Hold progress ring */}
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

        {/* Tear burst rays, shockwave, vignette & flash */}
        {burstKey > 0 && (
          <div key={burstKey} aria-hidden="true">
            <div className="pack-rays pack-go" />
            <div className="pack-shock pack-go" />
            <div className="pack-flash pack-go" />
          </div>
        )}

        {/* Three fanned 3D reveal cards */}
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

        {/* Idle prompt & Hold-to-rip CTA */}
        <div className="pack-hint" aria-live="polite">
          <span>{hintPrimary}</span>
          <small>{shakeOn ? "Or shake your phone" : "Or tap the button once"}</small>
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

        <button type="button" className="pack-skip-btn" onClick={skipToResult}>
          Skip
        </button>

        {toast && (
          <div className="pack-toast on" role="status">
            {toast}
          </div>
        )}
      </div>

      {/* Tactile & accessibility controls from the pack-rip prototype */}
      <div className="pack-controls" role="group" aria-label="Pack rip controls">
        {phase === "done" && (
          <button type="button" className="tv-ctl" onClick={replayRip}>
            Replay rip
          </button>
        )}
        <button
          type="button"
          className="tv-ctl"
          aria-pressed={soundOn}
          onClick={() => setSoundOn((v) => !v)}
        >
          {soundOn ? "Sound on" : "Sound off"}
        </button>
        <button
          type="button"
          className="tv-ctl"
          aria-pressed={slowMo}
          onClick={() => setSlowMo((v) => !v)}
        >
          Slow motion
        </button>
        <button
          type="button"
          className="tv-ctl"
          aria-pressed={reducedMotion}
          onClick={() => setReducedMotion((v) => !v)}
        >
          Reduced motion
        </button>
        {phase === "idle" && (
          <button
            type="button"
            className="tv-ctl"
            aria-pressed={shakeOn}
            onClick={() => void toggleShake()}
          >
            Shake to rip: {shakeOn ? "on" : "off"}
          </button>
        )}
        {phase === "idle" && showTryShake && (
          <button type="button" className="tv-ctl" onClick={jolt}>
            Try a shake
          </button>
        )}
      </div>

      {phase === "idle" && (
        <p className="fine-print" style={{ marginTop: 8, textAlign: "center" }}>
          Three parts inside, at least one 3D printable. Seeded by date — same
          drop for everyone today.
        </p>
      )}

      {/* Result sheet & fit inspector once revealed */}
      {phase === "done" && activePart && (
        <div className="pack-result-panel">
          <div className="pack-result-head">
            <div>
              <span className="kicker-label kicker-gold" style={{ marginBottom: 2 }}>
                Card {selectedIndex + 1} of {cards.length} · Tap any card above
              </span>
              <h2 className="pack-result-title">
                What next for {activePart.name}?
              </h2>
            </div>
          </div>

          {toy ? (
            <PartCard
              part={activePart}
              toy={toy}
              rarity={rarityForPart(activePart)}
            />
          ) : (
            <div className="glass-card" style={{ marginBottom: 12 }}>
              <strong>{activePart.name}</strong> · {activePart.stat.name} +
              {activePart.stat.value}
            </div>
          )}

          {activePart.printable && stlFileFor(activePart) ? (
            <>
              <a
                className="cta cta-violet"
                style={{ flexDirection: "column" }}
                href={`/parts-stl/${stlFileFor(activePart)}`}
                download
              >
                <span>3D print at home · {activePart.name}</span>
                <span className="cta-sub">
                  Download support-free 12.5 mm TU STL for your 3D printer
                </span>
              </a>
              {activePart.smallPartWarning && (
                <p className="fine-print" role="note" style={{ marginTop: 4, marginBottom: 12 }}>
                  Ages 3+ · Choking hazard (small parts — 16 CFR § 1500.19).
                </p>
              )}
            </>
          ) : (
            <p className="fine-print" style={{ marginTop: 4, marginBottom: 12 }}>
              Only physical parts can be printed. Skins stay in AR and the game.
            </p>
          )}

          {onBuild && toy && (
            <button
              type="button"
              className="cta"
              style={{ flexDirection: "column" }}
              onClick={onBuild}
            >
              <span>Build with today's parts</span>
              <span className="cta-sub">
                Snap onto {toy.name} and preview in AR
              </span>
            </button>
          )}

          {onPlay && (
            <button
              type="button"
              className="cta cta-quiet"
              onClick={onPlay}
            >
              Open ToyVentor World with {toy ? toy.name : "these parts"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
