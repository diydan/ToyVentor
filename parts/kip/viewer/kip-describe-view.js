// Describe & build: the exploded view and the build animation. See kip-describe-contract.md.
//
// Two halves. The first is pure arithmetic with no three.js, so Node can test it: a part's box carried through its pose, the exploded-view plan (where
// each part goes at full spread), the approach plan (where each part comes from when the build plays) and the build timeline. The second draws it: one
// three.js group of the recipe's parts, posed from the recipe's poses (the validator's poses: tilt then quarter turns about Z, then translate; STLs are
// the assembly-frame exports of tools/export_describe_stls.py), moved by pose + t * offset as the slider moves, or by pose + away * approach while a
// build plays.
//
// Both plans are greedy in build order. Each part tries the six axis directions and takes the shortest move that (a) leaves a gap of at least `margin`
// to every part already placed and (b) does not sweep through any part it was not already touching. Boxes are axis-aligned boxes of the posed parts,
// so "disjoint boxes" is a conservative proof that the parts do not interpenetrate. Direction preference: stacked parts lift (+Z); a part on an axis
// prefers its own axis; both only within `prefer` mm of the best alternative, so nothing flies off to keep a habit.
//   * explode: placed parts are at their EXPLODED positions, and a part inherits its host's move (it travels with the host until it separates).
//   * approach: placed parts are SEATED (that is what a build looks like while it plays), the part starts `APPROACH_MIN` mm or more away and slides in.

const DEG = Math.PI / 180;
export const DEFAULT_MARGIN = 8;       // mm of clear space between any two parts at full spread (3 mm looked almost assembled in a render)
export const APPROACH_MARGIN = 4;      // mm of clear space between an arriving part and the seated parts at the start of its approach
export const APPROACH_MIN = 30;        // mm: an arriving part starts at least this far from its seat, so the motion is visible
export const PREFER_WITHIN = 8;        // mm: a preferred direction wins if it is no more than this much longer than the shortest
const MAX_MOVE = 600;                  // mm: give up looking beyond this

// ---------------------------------------------------------------------------------------------------------------------------------
// pose maths

/** 3x3 row-major rotation of a pose: tilt (rx, ry degrees) then rot quarter turns about Z, i.e. R = Rz * Ry * Rx (the validator's Manifold.rotate order). */
export function poseRotation(pose) {
  const [tx, ty] = pose.tilt ?? [0, 0];
  const a = tx * DEG, b = ty * DEG, c = (pose.rot ?? 0) * 90 * DEG;
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
    [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
    [-sb, cb * sa, cb * ca],
  ];
}

const apply = (R, v) => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);

/** Box [minx, miny, minz, maxx, maxy, maxz] of a part's local box once posed. Exact for quarter-turn poses. */
export function worldBox(local, pose) {
  const R = poseRotation(pose);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const x of [local[0], local[3]]) for (const y of [local[1], local[4]]) for (const z of [local[2], local[5]]) {
    const p = apply(R, [x, y, z]);
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  }
  const t = [pose.x, pose.y, pose.z];
  return [lo[0] + t[0], lo[1] + t[1], lo[2] + t[2], hi[0] + t[0], hi[1] + t[1], hi[2] + t[2]];
}

/** The world direction (a snapped unit axis) of a connector's axis on a posed part, or null if the part has no such axis connector. */
export function worldAxis(partsData, part, conn, pose) {
  const a = partsData?.parts?.[part]?.connectors?.[conn]?.axis;
  if (!a) return null;
  const v = apply(poseRotation(pose), a);
  const i = [0, 1, 2].reduce((m, k) => (Math.abs(v[k]) > Math.abs(v[m]) ? k : m), 0);
  const out = [0, 0, 0];
  out[i] = Math.sign(v[i]) || 1;
  return out;
}

const shift = (b, v) => [b[0] + v[0], b[1] + v[1], b[2] + v[2], b[3] + v[0], b[4] + v[1], b[5] + v[2]];
const centre = (b) => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
/** True when the boxes are closer than `gap` mm on every axis (that is, NOT separated by `gap` on some axis). */
const near = (a, b, gap) => a[0] < b[3] + gap && b[0] < a[3] + gap && a[1] < b[4] + gap && b[1] < a[4] + gap && a[2] < b[5] + gap && b[2] < a[5] + gap;
const hull = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];

const DIRS = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
const sameDir = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** How far boxes a and b overlap along axis k, or null when they do not overlap on the other two axes (so they cannot be pushed into one another along k). */
function overlapAlong(a, b, k) {
  for (let i = 0; i < 3; i++) if (i !== k && !(a[i] < b[3 + i] && b[i] < a[3 + i])) return null;
  return Math.min(a[3 + k], b[3 + k]) - Math.max(a[k], b[k]);
}

/**
 * True if sliding box `from` by `delta` along unit axis `d` would push it DEEPER into `other` than it already is at the start. A part that starts touching
 * another (its seat, or its host) may leave it, but must not cut through it: the overlap along the move never grows. Sampled at eight points, which is
 * enough because the overlap of two boxes sliding along an axis rises, plateaus and falls.
 */
function pushesInto(from, d, delta, other) {
  const k = d[0] ? 0 : d[1] ? 1 : 2;
  const start = overlapAlong(from, other, k);
  if (start === null) return false;
  for (let s = 1; s <= 8; s++) {
    const here = overlapAlong(shift(from, d.map((c) => (c * delta * s) / 8)), other, k);
    if (here !== null && here > Math.max(start, 0) + 1e-6) return true;
  }
  return false;
}

/**
 * The shortest move of `start` (a box) along one axis direction that leaves `margin` mm to every box in `placed` ({id, box}), does not sweep through a
 * placed part outside `touching` (a Set of ids it is allowed to start against), and does not cut deeper into a part it is touching. `minDelta` is the
 * least distance accepted. `preferred` is a list of unit axes, any of which wins when it is within PREFER_WITHIN of the shortest. Returns
 * { d, delta, moved } or null when nothing within MAX_MOVE works.
 */
function chooseMove(start, placed, touching, preferred, margin, minDelta = 0) {
  const options = [];
  for (const d of DIRS) {
    const along = d[0] ? 0 : d[1] ? 1 : 2, sign = d[along];
    const cands = new Set([minDelta]);
    // the distance at which the part just clears each placed part along d (+1e-4 mm so rounding never leaves it a hair short of the margin)
    for (const p of placed) cands.add((sign > 0 ? p.box[3 + along] + margin - start[along] : start[3 + along] - (p.box[along] - margin)) + 1e-4);
    for (const delta of [...cands].filter((c) => c >= minDelta && c <= MAX_MOVE).sort((a, b) => a - b)) {
      const moved = shift(start, d.map((c) => c * delta));
      if (placed.some((p) => near(moved, p.box, margin))) continue;       // not yet clear of everything placed
      const swept = hull(start, moved);
      if (placed.some((p) => !touching.has(p.id) && near(swept, p.box, 0))) continue;   // would pass through a part it was not touching
      if (placed.some((p) => touching.has(p.id) && pushesInto(start, d, delta, p.box))) continue;   // would cut through a part it is touching
      options.push({ d, delta, moved });
      break;
    }
  }
  if (!options.length) return null;
  const shortest = Math.min(...options.map((o) => o.delta));
  const wanted = options.filter((o) => (preferred ?? []).some((p) => sameDir(o.d, p)) && o.delta <= shortest + PREFER_WITHIN).sort((a, b) => a.delta - b.delta)[0];
  return wanted ?? options.slice().sort((a, b) => a.delta - b.delta)[0];
}

/**
 * The plans. `steps` and `poses` are the recipe's; `localBoxes[partId]` is each part's box in its own (assembly) frame.
 * Returns {
 *   offsets, dirs, exploded   the exploded view: at t a part sits at pose + t * offsets[id]; exploded[id] is its box at t = 1
 *   approach, approachDirs    the build: a part arriving sits at pose + away * approach[id], away from 1 (just started) down to 0 (seated)
 *   assembled                 every part's box at its pose;  order: step ids in build order
 * }. Throws if a part has no pose or no box, or cannot be separated from the rest.
 */
export function explodePlan(steps, poses, localBoxes, partsData, { margin = DEFAULT_MARGIN, approachMargin = APPROACH_MARGIN, approachMin = APPROACH_MIN } = {}) {
  const offsets = {}, dirs = {}, assembled = {}, exploded = {}, approach = {}, approachDirs = {}, placed = [], seated = [];
  for (const [i, s] of steps.entries()) {
    const pose = poses[s.id], local = localBoxes[s.part];
    if (!pose) throw new Error(`no pose for step ${s.id}`);
    if (!local) throw new Error(`no box for part ${s.part}`);
    const box = worldBox(local, pose);
    assembled[s.id] = box;
    if (i === 0) {
      offsets[s.id] = [0, 0, 0]; dirs[s.id] = null; exploded[s.id] = box; placed.push({ id: s.id, box });
      approach[s.id] = [0, 0, 0]; approachDirs[s.id] = null; seated.push({ id: s.id, box });
      continue;
    }
    const host = s.mate.host;
    const conn = partsData?.parts?.[s.part]?.connectors?.[s.mate.conn];
    // stacked parts prefer straight up; a part on an axis prefers its own axis, in whichever direction is open (its normal can point into the host)
    const axis = worldAxis(partsData, s.part, s.mate.conn, pose);
    const preferred = conn && (conn.kind === 'studs' || conn.kind === 'sockets') ? [[0, 0, 1]] : axis ? [axis, axis.map((v) => -v)] : [];

    const hostOff = offsets[host];
    const start = shift(box, hostOff);                        // where the part is when it has not yet left its (already moved) host
    const touching = new Set(placed.filter((p) => p.id === host || near(start, p.box, 0)).map((p) => p.id));
    const pick = chooseMove(start, placed, touching, preferred, margin);
    if (!pick) throw new Error(`step ${s.id} (${s.part}) cannot be separated from the rest within ${MAX_MOVE} mm`);
    offsets[s.id] = [hostOff[0] + pick.d[0] * pick.delta, hostOff[1] + pick.d[1] * pick.delta, hostOff[2] + pick.d[2] * pick.delta];
    dirs[s.id] = pick.d;
    exploded[s.id] = pick.moved;
    placed.push({ id: s.id, box: pick.moved });

    // the build: everything before this step is seated, so the part must come in from where nothing seated is in its way
    const seatTouching = new Set(seated.filter((p) => p.id === host || near(box, p.box, 0)).map((p) => p.id));
    const a = chooseMove(box, seated, seatTouching, preferred, approachMargin, approachMin);
    if (!a) throw new Error(`step ${s.id} (${s.part}) has no clear way in once the earlier parts are seated`);
    approach[s.id] = a.d.map((c) => c * a.delta);
    approachDirs[s.id] = a.d;
    seated.push({ id: s.id, box });
  }
  return { offsets, dirs, assembled, exploded, approach, approachDirs, order: steps.map((s) => s.id) };
}

/** Pairs of steps whose boxes are closer than `margin` at full spread (empty for a good plan). */
export function planOverlaps(plan, margin = 0) {
  const ids = plan.order, out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (near(plan.exploded[ids[i]], plan.exploded[ids[j]], margin)) out.push([ids[i], ids[j]]);
  return out;
}

/**
 * Problems with the approach plan, as [stepId, otherStepId, why] (empty for a good plan): a part that starts closer than `margin` to a seated earlier part,
 * whose path from start to seat sweeps through an earlier part it is not touching at its seat, or that cuts through one it is touching (the path to the
 * seat must leave it, never go deeper into it than the seat itself does).
 */
export function approachProblems(plan, margin = APPROACH_MARGIN) {
  const out = [];
  plan.order.forEach((id, i) => {
    if (i === 0) return;
    const seat = plan.assembled[id], v = plan.approach[id], start = shift(seat, v), path = hull(seat, start);
    const delta = Math.hypot(...v), d = delta ? v.map((c) => c / delta) : null;
    for (const other of plan.order.slice(0, i)) {
      const o = plan.assembled[other];
      if (near(start, o, margin)) out.push([id, other, 'starts too close']);
      else if (!near(seat, o, 0) && near(path, o, 0)) out.push([id, other, 'sweeps through']);
      else if (d && near(seat, o, 0) && pushesInto(seat, d, delta, o)) out.push([id, other, 'cuts through']);
    }
  });
  return out;
}

/** Axis-aligned box of the whole recipe at t (0 assembled, 1 exploded), for framing the camera. */
export function planBounds(plan, t = 1) {
  const bs = plan.order.map((id) => hull(plan.assembled[id], shift(plan.assembled[id], plan.offsets[id].map((v) => v * t))));
  return bs.reduce((a, b) => hull(a, b));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the build timeline

export const EASE = (f) => 1 - (1 - f) ** 3;   // fast in, gentle settle

/**
 * The state of a build at progress p (0 to n, one unit per step) as one { visible, away, alpha } per step. Step i owns the slot p in (i, i + 1]: it
 * appears at the start of its slot, slides in (`away` 1 down to 0, fading in) until `1 - rest` of the slot has gone, then sits seated for the rest.
 * Earlier steps are seated, later ones are hidden, so at most one part is ever moving. With `motion: false` (reduced motion) a part just appears seated.
 */
export function buildFrame(p, n, { motion = true, rest = 0.25 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (p >= i + 1) out.push({ visible: true, away: 0, alpha: 1 });
    else if (p > i) {
      const arrive = Math.min(1, (p - i) / (1 - rest));
      out.push(motion ? { visible: true, away: 1 - EASE(arrive), alpha: Math.min(1, arrive * 3) } : { visible: true, away: 0, alpha: 1 });
    } else out.push({ visible: false, away: 1, alpha: 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// drawing

const CATEGORY_COLOURS = {
  vehicle: ['#2E6FDB', '#1FA97C', '#F5C518'],
  wheel: ['#262D40'],
  addon: ['#FF6B4A'],
  character: ['#F4EFE6'],
  hair: ['#7A4B2A'],
  hat: ['#F5C518'],
};

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Draw recipes. `THREE`, `STLLoader`, `mergeVertices` and `toCreasedNormals` come from the host page (the same bundle Kip-Demo uses).
 * Options: { THREE, STLLoader, mergeVertices, toCreasedNormals, partsData (indexed or plain kip-describe-parts.json), base: '/kip/partspec/describe/' }.
 * Returns { group, show(result), setExplode(t), setBuild(p, opts), highlight(i), frame(camera, controls), clear(), plan, steps, meshes }.
 * `setExplode(t)` shows every part, spread by t (0 assembled, 1 exploded); `setBuild(p)` shows the build at progress p (see buildFrame), and p = steps.length
 * is the finished, fully assembled recipe.
 */
export function createDescribeView({ THREE, STLLoader, mergeVertices, toCreasedNormals, partsData, base = '/kip/partspec/describe/' }) {
  const group = new THREE.Group();          // add this to the scene
  group.name = 'describe_view';
  const root = new THREE.Group();           // CAD frame (X right, Y toward the back, Z up) -> three.js (Y up): the same turn Truck-Mockup uses
  root.rotation.x = -Math.PI / 2;
  group.add(root);
  const loader = new STLLoader();
  const geos = new Map();
  let meshes = [], current = null, plan = null;

  // One material per mesh, not per part: highlighting one wheel must not light the other three.
  const material = (part) => {
    const palette = CATEGORY_COLOURS[partsData?.parts?.[part]?.category] ?? ['#9AA3B5'];
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(palette[hash(part) % palette.length]), roughness: 0.42, metalness: 0.05 });
  };

  async function geometry(part) {
    if (!geos.has(part)) {
      geos.set(part, loader.loadAsync(`${base}${part}.stl`).then((raw) => {
        const g = toCreasedNormals(mergeVertices(raw, 1e-4), THREE.MathUtils.degToRad(32));
        g.computeBoundingBox();
        return g;
      }));
    }
    return geos.get(part);
  }

  /** Put mesh i at pose + k * vec, visible or not, with this opacity. */
  function put(i, k, vec, visible = true, alpha = 1) {
    const s = current.steps[i], pose = current.poses[s.id], m = meshes[i];
    m.rotation.order = 'ZYX';
    m.rotation.set((pose.tilt?.[0] ?? 0) * DEG, (pose.tilt?.[1] ?? 0) * DEG, (pose.rot ?? 0) * Math.PI / 2);
    m.position.set(pose.x + k * vec[0], pose.y + k * vec[1], pose.z + k * vec[2]);
    m.visible = visible;
    const mat = m.material;
    mat.transparent = alpha < 1;
    mat.opacity = alpha;
    mat.depthWrite = alpha >= 1;
  }

  const api = {
    group,
    get plan() { return plan; },
    get steps() { return current?.steps ?? []; },
    get meshes() { return meshes; },
    /** Load the recipe's parts and draw it assembled. `result` needs `steps` and `poses` (a validated result from describe()). */
    async show(result) {
      if (!result?.poses) throw new Error('only a recipe with poses can be drawn (an unchecked model recipe has none)');
      api.clear();
      const gs = await Promise.all(result.steps.map((s) => geometry(s.part)));
      const local = {};
      result.steps.forEach((s, i) => { const b = gs[i].boundingBox; local[s.part] = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]; });
      current = result;
      plan = explodePlan(result.steps, result.poses, local, partsData);
      meshes = result.steps.map((s, i) => {
        const m = new THREE.Mesh(gs[i], material(s.part));
        m.name = `step_${s.id}`;
        m.castShadow = m.receiveShadow = true;
        root.add(m);
        return m;
      });
      api.setExplode(0);
      return plan;
    },
    setExplode(t) {
      const k = Math.min(1, Math.max(0, t));
      meshes.forEach((_, i) => put(i, k, plan.offsets[current.steps[i].id]));
    },
    /** The build at progress p (0 nothing yet, steps.length finished). `opts.motion = false` makes parts appear in place (reduced motion). */
    setBuild(p, opts) {
      const frames = buildFrame(p, meshes.length, opts);
      frames.forEach((f, i) => put(i, f.away, plan.approach[current.steps[i].id], f.visible, f.alpha));
    },
    /** Tint one step (or none with null) so the step list and the picture agree. */
    highlight(i) {
      meshes.forEach((m, k) => {
        const mat = m.material;
        if (!mat.emissive) return;
        mat.emissive.set(k === i ? 0x555555 : 0x000000);
      });
    },
    /** Point the host's camera and orbit target at the recipe (assembled and exploded together). */
    frame(camera, controls) {
      if (!plan) return;
      const b = planBounds(plan, 1);
      const c = centre(b), size = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
      const target = new THREE.Vector3(c[0], c[2], -c[1]);                       // CAD -> three
      const dist = Math.max(120, size * 1.7);
      camera.position.set(target.x - dist * 0.7, target.y + dist * 0.5, target.z + dist * 0.9);
      controls?.target.copy(target);
      controls?.update?.();
    },
    clear() {
      for (const m of meshes) { root.remove(m); m.material.dispose(); }
      meshes = []; current = null; plan = null;
    },
    dispose() { api.clear(); geos.clear(); },
  };
  return api;
}
