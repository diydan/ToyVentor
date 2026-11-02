import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  explorerNeighbor,
  type ExplorerGraph,
  type ExplorerNode,
} from "../../../lib/explorerMap";
import type { LadderState } from "../../../lib/learn";
import { KIND_WORD, STOP_GLYPH, THEME_COLOR } from "../../../lib/mapCards";
import type { WorldId } from "./engine";
import { RungSheet } from "./RungSheet";

export interface ExplorerMapProps {
  graph: ExplorerGraph;
  currentId?: string | null;
  /** Live equipped-toy preview standing on the suggested node. */
  guide?: ReactNode;
  guideName?: string;
  onClose: () => void;
  /** Back to the swipe-card view of the same places. */
  onShowCards: () => void;
  onAskAge: () => void;
  onGoWorld: (world: WorldId) => void;
  /** Start the node's seeded level. False = it could not start (stay here). */
  onGoFrontier: (node: ExplorerNode) => boolean;
  onStartLearn?: (track: string, plan: number[]) => void;
  planForRung?: (track: string, rung: number) => number[];
}

const UNIT = 76;
const PAD = 58;

const nodeLabel = (node: ExplorerNode): string => {
  if (node.fog === "clouded") {
    return "A clouded place. Tap to go there and clear the clouds";
  }
  if (node.kind === "frontier") {
    return `New path, a surprise level. Seed ${node.seedCode ?? ""}`;
  }
  if (node.kind === "ask") {
    return "Who is playing? A grown-up sets the age, to open the right levels";
  }
  return `${node.label}, ${KIND_WORD[node.kind]}: ${node.done} of ${node.total}${node.complete ? ", done" : ""}`;
};

/**
 * The trail map: the carousel's places as one branching overworld.
 * Gold roads are where the child has been, silhouettes are one road
 * away, and clouds hide the rest. Nothing is locked; tapping any
 * node travels there. Frontier nodes play seeded level-kit levels.
 */
export function ExplorerMap({
  graph,
  currentId,
  guide,
  guideName,
  onClose,
  onShowCards,
  onAskAge,
  onGoWorld,
  onGoFrontier,
  onStartLearn,
  planForRung,
}: ExplorerMapProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [rungsOf, setRungsOf] = useState<LadderState | null>(null);
  const [notice, setNotice] = useState("");
  const { bounds } = graph;
  const width = (bounds.maxX - bounds.minX) * UNIT + PAD * 2;
  const height = (bounds.maxY - bounds.minY) * UNIT + PAD * 2;
  const px = (n: { x: number; y: number }) => ({
    x: PAD + (n.x - bounds.minX) * UNIT,
    y: PAD + (n.y - bounds.minY) * UNIT,
  });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const anchorId =
    graph.suggestedId ??
    (currentId && byId.has(currentId) ? currentId : null) ??
    "room";

  // The RungSheet replaces this whole view, which unmounts the scroller.
  // Remember where the child was looking so Back lands there, not at 0,0.
  const savedScroll = useRef<{ left: number; top: number } | null>(null);

  // Open centred on the suggested place, like the carousel does; after a
  // RungSheet visit, restore the saved spot instead. Keyed on the sheet,
  // not the graph: graph identity changes on every progress tick.
  useLayoutEffect(() => {
    if (rungsOf) return;
    const el = scrollerRef.current;
    if (!el) return;
    const saved = savedScroll.current;
    if (saved) {
      el.scrollLeft = saved.left;
      el.scrollTop = saved.top;
      return;
    }
    const anchor = byId.get(anchorId);
    if (!anchor) return;
    const c = px(anchor);
    el.scrollLeft = Math.max(0, c.x - el.clientWidth / 2);
    el.scrollTop = Math.max(0, c.y - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rungsOf]);

  const soon = (label: string) =>
    setNotice(`${label} levels are coming soon. Worlds and Labs work today.`);

  const open = (node: ExplorerNode) => {
    setNotice("");
    if (node.kind === "ask") return onAskAge();
    if (node.kind === "frontier") {
      if (!onGoFrontier(node)) {
        setNotice("That new path can't start right now. Try again in a moment.");
      }
      return;
    }
    if (node.kind === "learn" && node.card?.ladder) {
      const ladder = node.card.ladder;
      if (ladder.choices > 1) {
        const el = scrollerRef.current;
        if (el) savedScroll.current = { left: el.scrollLeft, top: el.scrollTop };
        return setRungsOf(ladder);
      }
      if (onStartLearn) return onStartLearn(node.id, ladder.plan);
      return soon(node.label);
    }
    onGoWorld(node.id as WorldId);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const dir =
      e.key === "ArrowUp"
        ? "up"
        : e.key === "ArrowDown"
          ? "down"
          : e.key === "ArrowLeft"
            ? "left"
            : e.key === "ArrowRight"
              ? "right"
              : null;
    if (!dir) return;
    const active = document.activeElement as HTMLElement | null;
    const fromId = active?.dataset.nodeId;
    if (!fromId) return;
    const nextId = explorerNeighbor(graph, fromId, dir);
    if (!nextId) return;
    const btn = scrollerRef.current?.querySelector<HTMLButtonElement>(
      `[data-node-id="${nextId}"]`,
    );
    if (btn) {
      e.preventDefault();
      btn.focus();
      btn.scrollIntoView({ block: "center", inline: "center" });
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
    <section className="tv-sheet tv-sheet-map" role="region" aria-label="Trail map">
      <div className="tv-sh-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="kicker-label kicker-gold">Places to play</span>
          <b className="tv-sh-title">Trail map</b>
        </div>
        <button type="button" className="tv-ctl" onClick={onShowCards}>
          Cards
        </button>
        <button type="button" className="tv-ctl" onClick={onClose}>
          Home
        </button>
      </div>
      <p className="tv-trail-legend">
        Gold roads are where you have been. Clouds hide what is ahead.
      </p>
      <div
        className="tv-trail-scroll"
        ref={scrollerRef}
        onKeyDown={onKeyDown}
        aria-label="Trail map places"
      >
        <div className="tv-trail-canvas" style={{ width, height }}>
          <svg
            className="tv-trail-roads"
            width={width}
            height={height}
            aria-hidden="true"
          >
            {graph.districts
              .filter((d) => d.fog !== "clouded")
              .map((d) => {
                const c = px({ x: d.cx, y: d.cy });
                return (
                  <g key={d.id}>
                    <ellipse
                      cx={c.x}
                      cy={c.y}
                      rx={d.rx * UNIT}
                      ry={d.ry * UNIT}
                      fill={THEME_COLOR[d.theme] ?? "#52b7ff"}
                      fillOpacity={d.fog === "revealed" ? 0.08 : 0.04}
                      stroke={THEME_COLOR[d.theme] ?? "#52b7ff"}
                      strokeOpacity={0.45}
                      strokeWidth={1.5}
                      strokeDasharray="5 6"
                    />
                    <text
                      x={c.x}
                      y={c.y - d.ry * UNIT + 16}
                      textAnchor="middle"
                      className="tv-trail-area-name"
                    >
                      {d.label}
                    </text>
                  </g>
                );
              })}
            {graph.edges
              .filter((e) => e.fog !== "clouded")
              .map((e) => {
                const a = px(byId.get(e.a)!);
                const b = px(byId.get(e.b)!);
                return e.fog === "revealed" ? (
                  <line
                    key={`${e.a}-${e.b}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className="tv-trail-road-done"
                  />
                ) : (
                  <line
                    key={`${e.a}-${e.b}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className="tv-trail-road-next"
                  />
                );
              })}
          </svg>
          {graph.nodes.map((node) => {
            const c = px(node);
            const clouded = node.fog === "clouded";
            return (
              <div
                key={node.id}
                className="tv-trail-node-wrap"
                style={{ left: c.x, top: c.y }}
              >
                {node.suggested && guide ? (
                  <span className="tv-map-guide" aria-hidden="true">
                    {guide}
                    {guideName ? (
                      <span className="tv-map-guide-name">{guideName}</span>
                    ) : null}
                  </span>
                ) : null}
                <button
                  type="button"
                  data-node-id={node.id}
                  className={`tv-trail-node tv-trail-node-${node.fog}${node.id === currentId ? " tv-trail-node-here" : ""}`}
                  style={
                    {
                      "--accent": THEME_COLOR[node.theme] ?? "#52b7ff",
                    } as CSSProperties
                  }
                  aria-label={nodeLabel(node)}
                  aria-current={node.id === currentId ? "true" : undefined}
                  onClick={() => open(node)}
                >
                  <span className="tv-trail-glyph" aria-hidden="true">
                    {clouded
                      ? "☁"
                      : node.kind === "frontier"
                        ? "◆"
                        : (STOP_GLYPH[node.id] ?? "◆")}
                  </span>
                  {node.complete ? (
                    <span className="tv-trail-done" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
                <span className="tv-trail-node-label" aria-hidden="true">
                  {clouded ? "Clouded" : node.label}
                  {!clouded && node.total > 0 ? (
                    <span className="tv-trail-count">
                      {node.done}/{node.total}
                    </span>
                  ) : null}
                  {!clouded && node.kind === "frontier" ? (
                    <span className="tv-trail-count">Seed {node.seedCode}</span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="tv-trail-legend">Drag to look around. Tap a place to go there.</p>
      {notice ? (
        <p className="tv-moves" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

