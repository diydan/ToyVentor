import { useEffect, useMemo, useRef, useState } from "react";
import type { GarageStatus } from "../../../lib/garage";
import { shapeSpeech, speakName, startShape, tapShape, type ShapeState } from "../../../lib/garageHousehold";
import {
  HOUSEHOLD_ITEMS,
  HOUSEHOLD_SUPPORT,
  loadHouseholdPictures,
  type HouseholdPicture,
  type HouseholdPictures,
} from "../../../lib/garageHouseholdData";

// The household weekends on screen (docs/specs/garage-weekend-spec.md, "Household library drops"): the pictures, the "Who's that shape?" game that a child
// plays instead of finding the thing, and the grown-up's "We found it". The rules live in src/lib/garageHousehold.ts and src/lib/garage.ts; this file only
// draws them.

const LABELS = new Map([...HOUSEHOLD_ITEMS, ...HOUSEHOLD_SUPPORT].map((i) => [i.id, i.label]));
export const labelOf = (id: string): string => LABELS.get(id) ?? id;

/** Load the item pictures once, when they are first wanted (`enabled`), and hand them back. */
export function useHouseholdPictures(enabled: boolean): HouseholdPictures | null {
  const [pictures, setPictures] = useState<HouseholdPictures | null>(null);
  useEffect(() => {
    if (!enabled || pictures) return;
    let live = true;
    loadHouseholdPictures()
      .then((p) => {
        if (live) setPictures(p);
      })
      .catch(() => {
        // No pictures: the sheet falls back to words, and the game says it cannot start.
      });
    return () => {
      live = false;
    };
  }, [enabled, pictures]);
  return pictures;
}

const INK = "#1c2236";

/** One item as a picture: its colours from the front, or its black silhouette from the three-quarter view (what the shape game shows). */
export function ItemPicture({
  picture,
  view,
  label,
  className,
}: {
  picture: HouseholdPicture | undefined;
  view: "colour" | "silhouette";
  label?: string;
  className?: string;
}) {
  if (!picture) return <span className={`tv-house-pic tv-house-pic-empty ${className ?? ""}`} aria-hidden="true" />;
  return (
    <svg
      className={`tv-house-pic ${className ?? ""}`}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-view={view}
    >
      {view === "silhouette" ? (
        <path d={picture.threeQuarter} fill={INK} fillRule="evenodd" />
      ) : (
        <>
          {picture.zones.map((z) => (
            <path key={z.zone} d={z.d} fill={z.hex} fillRule="evenodd" />
          ))}
          <path d={picture.front} fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" fillRule="evenodd" />
        </>
      )}
    </svg>
  );
}

/** The library items a household drop asks about for this child's age group (the toy support tool for the youngest tool weekend). */
export function householdItemIds(status: GarageStatus): string[] {
  const goal = status.variant.goal;
  if (goal.kind !== "household") return [];
  return goal.toyTool ? ["support_tool"] : [...goal.items];
}

/** Which item the shape game opens with: the weekend's item, the toy tool for the youngest tool weekend, or one of the tools. */
export function firstShapeTarget(status: GarageStatus, rng: () => number = Math.random): string {
  const ids = householdItemIds(status);
  if (ids.length === 0) return "ball";
  return ids.length === 1 ? ids[0]! : ids[Math.min(ids.length - 1, Math.floor(rng() * ids.length))]!;
}

/** The weekend's pictures on the Garage sheet: the item, or the tools the weekend names (for the youngest, the toy tool). */
export function HouseholdPicturesRow({ status, pictures }: { status: GarageStatus; pictures: HouseholdPictures | null }) {
  const ids = householdItemIds(status);
  return (
    <div className="tv-house-row" data-testid="household-pictures">
      {ids.map((id) => (
        <figure key={id} className="tv-house-fig">
          <ItemPicture picture={pictures?.[id]} view="colour" label={labelOf(id)} />
          <figcaption>{labelOf(id)}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- the game */

/**
 * "Who's that shape?": the item's silhouette, and a few pictures to pick from. Right answers in a row finish it; a wrong one starts the streak again (the
 * youngest retry the same shape); hints arrive after a few wrong taps and never finish it for the child. `onFinished` pays out and returns the line to show.
 */
export function ShapeGame({
  ageBand,
  firstTarget,
  pictures,
  onFinished,
  onBack,
}: {
  ageBand: number | null | undefined;
  firstTarget: string;
  pictures: HouseholdPictures | null;
  onFinished: () => string;
  onBack: () => void;
}) {
  const ctx = useMemo(() => ({ items: HOUSEHOLD_ITEMS, support: HOUSEHOLD_SUPPORT, rng: Math.random }), []);
  const [state, setState] = useState<ShapeState>(() => startShape(ctx, { ageBand, firstTarget }));
  const [note, setNote] = useState("");
  const [reward, setReward] = useState<string | null>(null);
  const paid = useRef(false);

  useEffect(() => {
    if (state.done && !paid.current) {
      paid.current = true;
      setReward(onFinished());
    }
  }, [state.done, onFinished]);

  const tap = (id: string) => {
    if (state.done || !pictures) return;
    const next = tapShape(state, id, ctx);
    const say = shapeSpeech(state, next);
    if (say) speakName(say);
    setNote(
      next.done
        ? "You did it!"
        : id === state.target
          ? "Yes! That is the one."
          : state.group === "tiny"
            ? "Not that one. Try again."
            : "Not that one. Here is a new shape.",
    );
    setState(next);
  };

  const pips = Array.from({ length: state.need }, (_, i) => i < state.streak);
  return (
    <section className="tv-sheet tv-sheet-garage tv-shape" role="region" aria-label="Who's that shape?" data-target={state.target} data-level={state.level}>
      <div className="tv-sh-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="kicker-label kicker-gold">Garage</span>
          <b className="tv-sh-title">Who&apos;s that shape?</b>
        </div>
        <button type="button" className="tv-ctl" onClick={onBack}>
          {state.done ? "Close" : "Back"}
        </button>
      </div>

      <div className="tv-shape-stage">
        <ItemPicture picture={pictures?.[state.target]} view={state.level >= 1 ? "colour" : "silhouette"} className="tv-shape-target" label="The shape to find" />
        {state.nameShown ? <p className="tv-shape-name">{labelOf(state.target)}</p> : null}
      </div>

      <ol className="tv-shape-pips" aria-label={`${state.streak} of ${state.need} right`}>
        {pips.map((on, i) => (
          <li key={i} className={on ? "on" : ""} aria-hidden="true" />
        ))}
      </ol>

      {state.done ? (
        <div className="tv-shape-done" role="status">
          <b>You did it!</b>
          {reward ? <p className="tv-moves">{reward}</p> : null}
        </div>
      ) : (
        <>
          {!pictures ? <p className="tv-moves">Getting the pictures…</p> : null}
          <div className="tv-shape-choices" data-count={state.choices.length}>
            {state.choices.map((id) => (
              <button
                key={id}
                type="button"
                data-item={id}
                disabled={!pictures}
                aria-label={labelOf(id)}
                className={`tv-shape-choice${state.highlight === id ? " tv-shape-choice-hint" : ""}${state.lastWrong === id ? " tv-shape-choice-wrong" : ""}`}
                onClick={() => tap(id)}
              >
                <ItemPicture picture={pictures?.[id]} view="colour" />
              </button>
            ))}
          </div>
          <p className="tv-moves" role="status" aria-live="polite">
            {note || "Tap the picture that has this shape."}
          </p>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------ the grown-up's find */

/**
 * The Grown-Ups sheet's confirm for a household weekend, in place of "We built it": it names what was asked and shows the picture, so the grown-up knows
 * what the family was looking for, then "We found it". It pays the drop's XP and the play-time minutes; a skip (the shape game) pays no minutes.
 */
export function HouseholdConfirm({
  status,
  pictures,
  realLifeOn,
  onConfirm,
}: {
  status: GarageStatus;
  pictures: HouseholdPictures | null;
  realLifeOn: boolean;
  onConfirm: () => string | Promise<string>;
}) {
  const [note, setNote] = useState("");
  const ids = householdItemIds(status);
  const goal = status.variant.goal;
  const toyTool = goal.kind === "household" && goal.toyTool === true;
  const finished = status.done;
  const found = status.found;
  return (
    <div className="tv-house-confirm" data-testid="household-confirm">
      <b>{status.variant.title}</b>
      <div className="tv-house-row">
        {ids.map((id) => (
          <figure key={id} className="tv-house-fig">
            <ItemPicture picture={pictures?.[id]} view="colour" label={labelOf(id)} />
            <figcaption>{labelOf(id)}</figcaption>
          </figure>
        ))}
      </div>
      <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
        {toyTool
          ? "Show your child a real tool and say what it is for. The toy tool is only the picture."
          : goal.kind === "household" && goal.count > 1
            ? `Find ${goal.count} different ones. When the family has found them, say so here.`
            : "When the family has found one, say so here. It pays +40 XP and play time."}
        {" "}
        If your child plays “Who&apos;s that shape?” instead, it pays +40 XP and no play time.
      </p>
      <button
        type="button"
        className="tv-ctl tv-ctl-primary"
        disabled={finished || !realLifeOn}
        onClick={() => {
          void Promise.resolve(onConfirm()).then(setNote);
        }}
      >
        {found ? "Found it ★" : finished ? "Done by playing" : "We found it"}
      </button>
      {!realLifeOn ? (
        <p className="tv-moves" style={{ margin: 0, fontSize: 12 }}>
          Real-life tasks are off, so “We found it” is off. Your child can still play “Who&apos;s that shape?”.
        </p>
      ) : null}
      {note ? (
        <p className="tv-moves" role="status" style={{ margin: 0, fontSize: 12 }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
