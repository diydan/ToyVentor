import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  cardShotUrl,
  KIND_WORD,
  STOP_GLYPH,
  THEME_COLOR,
  type MapCard,
} from "../../../lib/mapCards";

export interface MapCardStripProps {
  cards: MapCard[];
  /** Live equipped-toy preview hovering over the suggested card. */
  guide?: ReactNode;
  guideName?: string;
  /** Tap on a card: go there, start it, or open it. */
  onOpen: (card: MapCard) => void;
}

const cardLabel = (card: MapCard): string =>
  card.kind === "ask"
    ? "Who is playing? A grown-up sets the age, to open the right levels"
    : card.kind === "garage"
      ? `Garage, a place to build new things${card.badge === "new" ? ". A new drop is waiting this weekend" : ""}${card.complete ? ". Done this weekend" : ""}`
      : `${card.label}, ${KIND_WORD[card.kind]}: ${card.done} of ${card.total}${card.complete ? ", done" : ""}`;

/**
 * The mini carousel along the bottom of the trail map: one swipeable row of
 * the same places, each with a screenshot of its level. It starts at the left
 * edge, with the suggested card scrolled to the front, so there is never an
 * empty gap before the first card.
 */
export function MapCardStrip({ cards, guide, guideName, onOpen }: MapCardStripProps) {
  const trackRef = useRef<HTMLOListElement>(null);
  const suggested = cards.find((c) => c.suggested)?.id;

  // Open with the suggested card at the left edge (the first card when it is first).
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const items = Array.from(el.children) as HTMLElement[];
    const start = items.find((li) => li.dataset.id === suggested) ?? items[0];
    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    el.scrollLeft = start ? Math.max(0, start.offsetLeft - pad) : 0;
    // Vertical wheel scrolls the row sideways.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // Once per card list: the list is rebuilt on progress ticks with the same order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.map((c) => c.id).join(",")]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const buttons = Array.from(
      trackRef.current?.querySelectorAll<HTMLButtonElement>(".tv-map-card-btn") ?? [],
    );
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[at + (e.key === "ArrowRight" ? 1 : -1)];
    if (at >= 0 && next) {
      e.preventDefault();
      e.stopPropagation(); // the trail map's own arrow keys walk the toy; here they walk the cards
      next.focus();
    }
  };

  return (
    <ol className="tv-map-track" ref={trackRef} onKeyDown={onKeyDown} aria-label="Places to play">
      {cards.map((card) => {
        const shot = cardShotUrl(card.id);
        return (
          <li
            key={card.id}
            className={`tv-map-card${card.badge === "new" ? " tv-map-card-hot" : ""}${card.suggested ? " tv-map-card-next" : ""}`}
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
              onClick={() => onOpen(card)}
            >
              <span className="tv-map-scene" aria-hidden="true">
                <span className="tv-map-glyph">{STOP_GLYPH[card.id] ?? "◆"}</span>
                {shot ? (
                  <img
                    className="tv-map-shot"
                    src={shot}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={(e) => {
                      e.currentTarget.style.display = "none"; // no screenshot yet: the glyph shows
                    }}
                  />
                ) : null}
                {card.complete ? <span className="tv-map-done">✓</span> : null}
                <span className="tv-map-tag">{KIND_WORD[card.kind]}</span>
              </span>
              <span className="tv-map-foot">
                <span className="tv-map-title">{card.label}</span>
                <span className="tv-map-pips" aria-hidden="true">
                  {card.pips.map((pip, i) => (
                    <i
                      key={i}
                      className={`tv-map-pip${pip.done ? " on" : ""}${pip.silhouette && !pip.done ? " sil" : ""}${pip.glyph ? " pic" : ""}`}
                    >
                      {pip.glyph ?? (pip.done ? "✓" : "·")}
                    </i>
                  ))}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
