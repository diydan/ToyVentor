import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { BANDS } from "../../../lib/age";
import type { LadderState } from "../../../lib/learn";
import {
  KIND_WORD,
  STOP_GLYPH,
  THEME_COLOR,
  type MapCard,
} from "../../../lib/mapCards";
import type { WorldId } from "./engine";
import { RungSheet } from "./RungSheet";

export interface MapCarouselProps {
  cards: MapCard[];
  ageBand: number | null;
  /** Live equipped-toy preview hovering over the suggested card. */
  guide?: ReactNode;
  guideName?: string;
  onClose: () => void;
  /** Ask card / age chip: open the grown-up gate. */
  onAskAge: () => void;
  /** World/lab card: switch the stage in place. */
  onGoWorld: (world: WorldId) => void;
  /** Start a Learn run (C2). Absent: Learn taps show the coming-soon notice. */
  onStartLearn?: (track: string, plan: number[]) => void;
  /** Plan for an explicit RungSheet pick. */
  planForRung?: (track: string, rung: number) => number[];
  /** Switch to the branching trail-map view of the same places. */
  onShowExplorer?: () => void;
  /** Open the Garage sheet (the always-open build place with the weekend drop). */
  onOpenGarage?: () => void;
}

const cardLabel = (card: MapCard): string =>
  card.kind === "ask"
    ? "Who is playing? A grown-up sets the age, to open the right levels"
    : card.kind === "garage"
      ? `Garage, a place to build new things${card.badge === "new" ? ". A new drop is waiting this weekend" : ""}${card.complete ? ". Done this weekend" : ""}`
      : `${card.label}, ${KIND_WORD[card.kind]}: ${card.done} of ${card.total}${card.complete ? ", done" : ""}`;

/**
 * The level carousel (carousel spec §7): one swipeable row over the
 * live stage. C1 ships the shell — World/Lab cards travel in place,
 * Learn cards explain with the right pips and a coming-soon notice.
 */
export function MapCarousel({
  cards,
  ageBand,
  guide,
  guideName,
  onClose,
  onAskAge,
  onGoWorld,
  onStartLearn,
  planForRung,
  onShowExplorer,
  onOpenGarage,
}: MapCarouselProps) {
  const trackRef = useRef<HTMLOListElement>(null);
  const [rungsOf, setRungsOf] = useState<LadderState | null>(null);
  const [notice, setNotice] = useState("");
  const suggested = cards.find((c) => c.suggested)?.id;

  // Open centred on the suggestion; scale/fade by distance from centre.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const items = Array.from(el.children) as HTMLElement[];
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = items.find((li) => li.dataset.id === suggested);
    if (start) el.scrollLeft = start.offsetLeft - (el.clientWidth - start.offsetWidth) / 2;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (reduce) return;
      const mid = el.scrollLeft + el.clientWidth / 2;
      for (const li of items) {
        const d = Math.min(
          1,
          Math.abs(mid - (li.offsetLeft + li.offsetWidth / 2)) / (li.offsetWidth * 1.1),
        );
        li.style.setProperty("--d", d.toFixed(3));
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    update();
    el.addEventListener("scroll", schedule, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", schedule);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", schedule);
    };
  }, [cards, suggested]);

  const soon = (label: string) =>
    setNotice(`${label} levels are coming soon. Worlds and Labs work today.`);

  const open = (card: MapCard) => {
    setNotice("");
    if (card.kind === "ask") return onAskAge();
    if (card.kind === "garage") return onOpenGarage?.();
    if (card.kind === "learn" && card.ladder) {
      if (card.ladder.choices > 1) return setRungsOf(card.ladder);
      if (onStartLearn) return onStartLearn(card.id, card.ladder.plan);
      return soon(card.label);
    }
    onGoWorld(card.id as WorldId);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const buttons = Array.from(
      trackRef.current?.querySelectorAll<HTMLButtonElement>(".tv-map-card-btn") ?? [],
    );
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[at + (e.key === "ArrowRight" ? 1 : -1)];
    if (at >= 0 && next) {
      e.preventDefault();
      next.focus();
    }
  };

  if (rungsOf) {
    return (
      <RungSheet
        state={rungsOf}
        onPick={(rung) => {
          const track = rungsOf.ladder.id;
          const label = rungsOf.ladder.label;
          setRungsOf(null);
          if (onStartLearn) onStartLearn(track, planForRung?.(track, rung) ?? [rung]);
          else soon(label);
        }}
        onClose={() => setRungsOf(null)}
      />
    );
  }

  return (
    <section className="tv-sheet tv-sheet-map" role="region" aria-label="Map">
      <div className="tv-sh-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="kicker-label kicker-gold">Places to play</span>
          <b className="tv-sh-title">Map</b>
        </div>
        {onShowExplorer ? (
          <button type="button" className="tv-ctl" onClick={onShowExplorer}>
            Trail map
          </button>
        ) : null}
        <button type="button" className="tv-ctl" onClick={onAskAge}>
          {ageBand === null ? "Age: ask a grown-up" : `Age ${BANDS[ageBand]?.label ?? ""}`}
        </button>
        <button type="button" className="tv-ctl" onClick={onClose}>
          Home
        </button>
      </div>
      <ol
        className="tv-map-track"
        ref={trackRef}
        onKeyDown={onKeyDown}
        aria-label="Places to play"
      >
        {cards.map((card) => (
          <li
            key={card.id}
            className={`tv-map-card${card.badge === "new" ? " tv-map-card-hot" : ""}`}
            data-id={card.id}
          >
            {card.badge === "new" ? <span className="tv-map-new">NEW</span> : null}
            {card.suggested && guide ? (
              <span className="tv-map-guide" aria-hidden="true">
                {guide}
                {guideName ? <span className="tv-map-guide-name">{guideName}</span> : null}
              </span>
            ) : null}
            <button
              type="button"
              className="tv-map-card-btn"
              style={{ "--accent": THEME_COLOR[card.theme] ?? "#52b7ff" } as CSSProperties}
              aria-label={cardLabel(card)}
              onClick={() => open(card)}
            >
              <span className="tv-map-scene" aria-hidden="true">
                <span className="tv-map-glyph">{STOP_GLYPH[card.id] ?? "◆"}</span>
                {card.complete ? <span className="tv-map-done">✓</span> : null}
              </span>
              <span className="tv-map-foot">
                <span className="tv-map-kind">{KIND_WORD[card.kind]}</span>
                <span className="tv-map-title">{card.label}</span>
                <span className="tv-map-pips" aria-hidden="true">
                  {card.pips.map((pip, i) => (
                    <i
                      key={i}
                      className={`tv-map-pip${pip.done ? " on" : ""}${pip.silhouette && !pip.done ? " sil" : ""}`}
                    >
                      {pip.done ? "✓" : pip.silhouette ? (pip.icon[0]?.toUpperCase() ?? "·") : "·"}
                    </i>
                  ))}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {notice ? (
        <p className="tv-moves" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
