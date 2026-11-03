import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  explorerNeighbor,
  explorerRoute,
  type ExplorerGraph,
  type ExplorerNode,
} from "../../../lib/explorerMap";
import {
  fogPuffs,
  roadCurve,
  scatterDecor,
  worldFrame,
  UNIT,
  type Pt,
  type RoadCurve,
} from "../../../lib/explorerArt";
import type { LadderState } from "../../../lib/learn";
import { KIND_WORD } from "../../../lib/mapCards";
import type { WorldId } from "./engine";
import { NodeArt } from "./ExplorerNodeArt";
import { FogBank, WorldArt } from "./ExplorerWorldArt";
import { RungSheet } from "./RungSheet";

export interface ExplorerMapProps {
  graph: ExplorerGraph;
  /** World the child is standing in now (the guide starts here). */
  currentId?: string | null;
  /** Last trail-map node walked to; the guide starts here when the child is
   *  in a generated level that has no place of its own on the map. */
  lastVisitedId?: string | null;
  /** The equipped toy, hopping along the roads. */
  guide?: ReactNode;
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

const HOP_MS = 110;
const DRAG_PX = 6;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** What the name plate says about the place the guide is standing on. */
function placeInfo(node: ExplorerNode | undefined): { title: string; sub: string; action: string } {
  if (!node) return { title: "Trail map", sub: "", action: "Play" };
  if (node.fog === "clouded") {
    return { title: "A new place?", sub: "Hidden in the clouds", action: "Go!" };
  }
  if (node.kind === "frontier") {
    return { title: "New path", sub: "A surprise level", action: "Go!" };
  }
  if (node.kind === "ask") {
    return { title: "Who is playing?", sub: "A grown-up sets the age", action: "Open" };
  }
  const progress =
    node.total > 0 ? ` · ${node.done} of ${node.total}${node.complete ? " ★" : ""}` : "";
  return {
    title: node.label,
    sub: `${KIND_WORD[node.kind]}${progress}`,
    action: node.kind === "world" ? "Go!" : "Play",
  };
}

const nodeLabel = (node: ExplorerNode, here: boolean): string => {
  const stand = here ? ", the guide is here" : "";
  if (node.fog === "clouded") return `A place hidden in the clouds${stand}`;
  if (node.kind === "frontier") return `New path, a surprise level${stand}`;
  if (node.kind === "ask") return `Who is playing? A grown-up sets the age${stand}`;
  const progress = node.total > 0 ? `: ${node.done} of ${node.total}${node.complete ? ", done" : ""}` : "";
  return `${node.label}, ${KIND_WORD[node.kind]}${progress}${stand}`;
};

/**
 * The trail map as an old console overworld: a full-screen sea with islands,
 * winding roads, level dots and castles, a cloud bank over what the child has
 * not found yet, and the toy hopping from place to place. Tap a place and
 * the toy hops there; tap it again (or press Play) to go in. Nothing is
 * locked: clouds are only drawing, and a clouded place can be walked to.
 */
export function ExplorerMap({
  graph,
  currentId,
  lastVisitedId,
  guide,
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

  // Everything geometric depends only on the shape of the map, and the graph
  // object is rebuilt on every progress tick, so key on the shape.
  const shape = useMemo(
    () =>
      graph.nodes.map((n) => `${n.id}@${n.x},${n.y}:${n.theme}`).join(";") +
      "|" +
      graph.edges.map((e) => `${e.a}-${e.b}`).join(";"),
    [graph],
  );
  const world = useMemo(() => {
    const frame = worldFrame(graph.bounds);
    const pos = new Map<string, Pt>(graph.nodes.map((n) => [n.id, frame.at(n)]));
    const curves = new Map<string, RoadCurve>();
    for (const e of graph.edges) {
      const [lo, hi] = e.a < e.b ? [e.a, e.b] : [e.b, e.a];
      const a = pos.get(lo);
      const b = pos.get(hi);
      if (a && b) curves.set(edgeKey(lo, hi), roadCurve(a, b, lo, hi));
    }
    const artNodes = graph.nodes.map((n) => ({ id: n.id, theme: n.theme, ...pos.get(n.id)! }));
    const decor = scatterDecor(
      artNodes,
      [...curves.values()].map((c) => c.points),
      frame,
    );
    return {
      frame,
      pos,
      curves,
      artNodes,
      decor,
      roadPaths: [...curves.values()].map((c) => c.d),
      puffs: fogPuffs(frame),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const startId =
    currentId && byId.has(currentId)
      ? currentId
      : lastVisitedId && byId.has(lastVisitedId)
        ? lastVisitedId
        : "room";
  const [kipAt, setKipAt] = useState(startId);
  const [kipPt, setKipPt] = useState<Pt>(() => world.pos.get(startId) ?? { x: 0, y: 0 });
  const [facing, setFacing] = useState<1 | -1>(1);
  const [moving, setMoving] = useState(false);
  const run = useRef(0);
  const kipAtRef = useRef(kipAt);
  kipAtRef.current = kipAt;

  useEffect(() => () => void (run.current += 1), []);

  const centerOn = (pt: Pt, smooth: boolean) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({
      left: pt.x - el.clientWidth / 2,
      top: pt.y - el.clientHeight / 2,
      behavior: smooth ? "smooth" : "auto",
    });
  };
  useLayoutEffect(() => {
    centerOn(kipPt, false);
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Hop the toy along the roads to another place. */
  const moveTo = async (id: string) => {
    const route = explorerRoute(graph, kipAtRef.current, id);
    if (!route || route.length < 2) return;
    const token = ++run.current;
    const quick = prefersReducedMotion();
    setMoving(true);
    setNotice("");
    let lastX = kipPt.x;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!;
      const b = route[i]!;
      const curve = world.curves.get(edgeKey(a, b));
      const samples = curve ? (a < b ? curve.points : [...curve.points].reverse()) : [];
      const hops = samples.filter((_, k) => k > 0 && k % 2 === 0);
      const end = world.pos.get(b);
      if (!end) break;
      centerOn(end, !quick);
      for (const p of quick || hops.length === 0 ? [end] : hops) {
        if (run.current !== token) return;
        if (Math.abs(p.x - lastX) > 2) setFacing(p.x > lastX ? 1 : -1);
        lastX = p.x;
        setKipPt(p);
        if (!quick) await sleep(HOP_MS);
      }
      if (run.current !== token) return;
      setKipAt(b);
    }
    if (run.current === token) setMoving(false);
  };

  const soon = (label: string) =>
    setNotice(`${label} levels are coming soon. Worlds and Labs work today.`);

  /** Go in: the toy is standing on this place. */
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
      if (ladder.choices > 1) return setRungsOf(ladder);
      if (onStartLearn) return onStartLearn(node.id, ladder.plan);
      return soon(node.label);
    }
    onGoWorld(node.id as WorldId);
  };

  // A mouse drags the map like a hand; touch scrolls natively.
  const drag = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = scrollerRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    d.moved = true;
    dragged.current = true;
    el.scrollLeft = d.l - dx;
    el.scrollTop = d.t - dy;
  };
  const endDrag = () => {
    drag.current = null;
    // Let the click that ends a drag pass, then forget it.
    setTimeout(() => {
      dragged.current = false;
    }, 0);
  };

  const onNodeClick = (node: ExplorerNode) => {
    if (dragged.current || moving) return;
    if (node.id === kipAt) return open(node);
    void moveTo(node.id);
  };

  // Arrow keys walk the toy along the roads, like a d-pad.
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
    if (!dir || moving) return;
    const nextId = explorerNeighbor(graph, kipAt, dir);
    if (!nextId) return;
    e.preventDefault();
    void moveTo(nextId).then(() => {
      scrollerRef.current
        ?.querySelector<HTMLButtonElement>(`[data-node-id="${nextId}"]`)
        ?.focus({ preventScroll: true });
    });
  };

  const kipNode = byId.get(kipAt);
  const info = placeInfo(kipNode);
  const { frame } = world;
  const fogged = graph.nodes.some((n) => n.fog !== "revealed");

  return (
    <section
      className="tv-trail-full"
      role="region"
      aria-label="Trail map"
      data-kip-at={kipAt}
      data-moving={moving ? "1" : "0"}
    >
      <div
        className="tv-trail-scroll"
        ref={scrollerRef}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <div className="tv-trail-canvas" style={{ width: frame.width, height: frame.height }}>
          <svg className="tv-trail-art" width={frame.width} height={frame.height} aria-hidden="true">
            <WorldArt
              width={frame.width}
              height={frame.height}
              nodes={world.artNodes}
              roadPaths={world.roadPaths}
              decor={world.decor}
            />
            {graph.edges.map((e) => {
              const curve = world.curves.get(edgeKey(e.a, e.b));
              if (!curve || e.fog === "clouded") return null;
              return e.fog === "revealed" ? (
                <g key={`${e.a}-${e.b}`}>
                  <path d={curve.d} className="tv-trail-road-edge" />
                  <path d={curve.d} className="tv-trail-road-done" />
                </g>
              ) : (
                <g key={`${e.a}-${e.b}`}>
                  <path d={curve.d} className="tv-trail-road-dots-edge" />
                  <path d={curve.d} className="tv-trail-road-dots" />
                </g>
              );
            })}
            {fogged ? (
              <>
                <defs>
                  <filter
                    id="tvt-reveal-blur"
                    filterUnits="userSpaceOnUse"
                    x="0"
                    y="0"
                    width={frame.width}
                    height={frame.height}
                  >
                    <feGaussianBlur stdDeviation="24" />
                  </filter>
                  <mask
                    id="tvt-fog-mask"
                    maskUnits="userSpaceOnUse"
                    x="0"
                    y="0"
                    width={frame.width}
                    height={frame.height}
                  >
                    <rect width={frame.width} height={frame.height} fill="#fff" />
                    <g filter="url(#tvt-reveal-blur)" fill="#000" stroke="#000" strokeLinecap="round">
                      {graph.edges.map((e) => {
                        const curve = world.curves.get(edgeKey(e.a, e.b));
                        return curve && e.fog !== "clouded" ? (
                          <path key={`${e.a}-${e.b}`} d={curve.d} fill="none" strokeWidth={UNIT * 0.95} />
                        ) : null;
                      })}
                      {graph.nodes.map((n) => {
                        const p = world.pos.get(n.id)!;
                        return n.fog === "clouded" ? null : (
                          <circle
                            key={n.id}
                            cx={p.x}
                            cy={p.y}
                            r={(n.fog === "revealed" ? 1.5 : 1.05) * UNIT}
                            strokeWidth="0"
                          />
                        );
                      })}
                    </g>
                  </mask>
                </defs>
                <g mask="url(#tvt-fog-mask)">
                  <FogBank width={frame.width} height={frame.height} puffs={world.puffs} />
                </g>
              </>
            ) : null}
          </svg>

          {graph.nodes.map((node) => {
            const p = world.pos.get(node.id)!;
            const here = node.id === kipAt;
            return (
              <button
                key={node.id}
                type="button"
                data-node-id={node.id}
                className={`tv-trail-node tv-trail-node-${node.fog}${here ? " tv-trail-node-here" : ""}`}
                style={{ left: p.x, top: p.y }}
                aria-label={nodeLabel(node, here)}
                aria-current={here ? "true" : undefined}
                onClick={() => onNodeClick(node)}
              >
                <NodeArt node={node} />
                {node.suggested && !here ? (
                  <span className="tv-trail-flag" aria-hidden="true">
                    ▼
                  </span>
                ) : null}
              </button>
            );
          })}

          <div
            className={`tv-trail-kip${moving ? " tv-trail-kip-hop" : ""}`}
            style={{ left: kipPt.x, top: kipPt.y }}
            aria-hidden="true"
          >
            <span className="tv-trail-kip-shadow" />
            <div className="tv-trail-kip-body" style={{ transform: `scaleX(${facing})` }}>
              {guide ?? <span className="tv-trail-kip-dot" />}
            </div>
          </div>
        </div>
      </div>

      <header className="tv-trail-hud">
        <div className="tv-trail-plate" aria-live="polite">
          {info.sub ? (
            <span className="kicker-label kicker-gold tv-trail-plate-kicker">{info.sub}</span>
          ) : null}
          <b className="tv-sh-title tv-trail-plate-title">{info.title}</b>
        </div>
        <div className="tv-trail-hud-btns">
          <button type="button" className="tv-ctl tv-trail-ctl" onClick={onShowCards}>
            Cards
          </button>
          <button type="button" className="tv-ctl tv-trail-ctl" onClick={onClose}>
            Home
          </button>
        </div>
      </header>

      {notice ? (
        <p className="tv-trail-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="tv-trail-play-wrap">
        <button
          type="button"
          className="tv-trail-play"
          disabled={moving || !kipNode}
          onClick={() => kipNode && open(kipNode)}
        >
          {info.action}
        </button>
      </div>

      {rungsOf ? (
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
      ) : null}
    </section>
  );
}
