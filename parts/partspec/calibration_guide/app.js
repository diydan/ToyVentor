// Calibration guide: 3D exploded/construction view of every gauge plus a scorecard to fill in.
// Source for calibration/calibration-guide.html (build_guide.py makes the geometry, build.mjs bundles this with three.js).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const A = JSON.parse(document.getElementById('assets').textContent);
const $ = (id) => document.getElementById(id);
const STEPS_MM = A.kit.steps_mm; // extra clearance D for ladder steps 1..8

// ------------------------------------------------------------------ tiny DOM helper
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(2)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const fmt = (n, d = 4) => { const s = (+n).toFixed(d).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };
const sgn = (n, d = 4) => (n > 0 ? '+' : '') + fmt(n, d);

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ------------------------------------------------------------------ scorecard state
const KEY = 'toyforge.calibration-guide.v1';
const PM = A.print_meta || null;
const printerDefault = PM ? [PM.printer_model, PM.slicer, PM.filament_settings_id].filter(Boolean).join(' / ') : '';
const blank = () => ({
  printer: printerDefault, dots: '', A: '', B: '', Cfree: '', Cfric: '', Dholes: '', Dpin: '', Dplate: '', Esock: '', Efolds: '',
  notes: '', prep: { brims: false, fp: false },
});
let card = blank();
try {
  const raw = localStorage.getItem(KEY);
  if (raw) { const c = JSON.parse(raw); card = { ...blank(), ...c, prep: { ...blank().prep, ...(c.prep || {}) } }; }
} catch { /* private window or blocked storage: the card still works for this visit */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(card)); } catch { /* ignore */ } };

const FIELD_STEP = { dots: 'dots', A: 'A', B: 'B', Cfree: 'C', Cfric: 'C', Dholes: 'D', Dpin: 'D', Dplate: 'D', Esock: 'E', Efolds: 'E' };
const FIELDS = Object.keys(FIELD_STEP);
const filled = (f) => card[f] !== '' && card[f] != null;

// ------------------------------------------------------------------ 3D engine
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const canvas = $('gl');
const stage = $('stage');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { $('gl-fallback').style.display = 'grid'; }
const GL = !!renderer;

const scene3d = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 1, 2000);
camera.position.set(80, -140, 100);
let controls = null;
if (GL) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxDistance = 600;
  controls.minDistance = 15;
  scene3d.add(new THREE.HemisphereLight(0xffffff, 0x8a93a0, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(60, -90, 140); scene3d.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7); fill.position.set(-90, 60, 40); scene3d.add(fill);
  const under = new THREE.DirectionalLight(0xffffff, 0.5); under.position.set(0, 0, -120); scene3d.add(under);
}

const PAL = {
  light: { body: 0x93a6bd, gauge: 0xcfd6df, tester: 0xf0a73c, soft: 0x4fb3a9, edge: 0x1c2230, edgeA: 0.5, bed: 0xdfe4ea, grid: 0xb9c2cd },
  dark: { body: 0x7388a3, gauge: 0x8f9bab, tester: 0xe39a2e, soft: 0x3a9a91, edge: 0xffffff, edgeA: 0.22, bed: 0x1b2028, grid: 0x39414d },
};
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const mats = {};
for (const tone of ['body', 'gauge', 'tester', 'soft']) {
  mats[tone] = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
}
const edgeMat = new THREE.LineBasicMaterial({ transparent: true });
const bedMat = new THREE.MeshBasicMaterial({});
const gridMat = new THREE.LineBasicMaterial({});
function applyTheme() {
  const p = mq.matches ? PAL.dark : PAL.light;
  for (const tone of Object.keys(mats)) mats[tone].color.setHex(p[tone]);
  edgeMat.color.setHex(p.edge); edgeMat.opacity = p.edgeA;
  bedMat.color.setHex(p.bed); gridMat.color.setHex(p.grid);
}
applyTheme();
mq.addEventListener?.('change', applyTheme);

const bedGroup = new THREE.Group();
bedGroup.visible = false;
if (GL) {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), bedMat);
  plane.position.z = -0.15;
  const grid = new THREE.GridHelper(220, 22, 0x000000, 0x000000);
  grid.material = gridMat; grid.rotation.x = Math.PI / 2; grid.position.z = -0.1;
  bedGroup.add(plane, grid);
  scene3d.add(bedGroup);
}

const geoms = {};
function partGeom(pid) {
  if (geoms[pid]) return geoms[pid];
  const bin = atob(A.parts[pid].stl);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const g = toCreasedNormals(new STLLoader().parse(buf.buffer), Math.PI / 5);
  return (geoms[pid] = { g, edges: new THREE.EdgesGeometry(g, 40) });
}

const insts = new Map(); // key -> instance in the current scene
const _m4 = new THREE.Matrix4(), _sc = new THREE.Vector3();
const TWEEN_MS = 520;
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

function makeInst(it) {
  const pg = partGeom(it.part);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(pg.g, mats[A.parts[it.part].tone]);
  const lines = new THREE.LineSegments(pg.edges, edgeMat);
  group.add(mesh, lines);
  const inst = {
    key: it.key, part: it.part, group, mesh, fold: it.fold || null, nocap: !!it.nocap, from: null, to: null, t0: 0,
    cur: { p: new THREE.Vector3(), q: new THREE.Quaternion(), ex: new THREE.Vector3() },
    cap: h('div', { class: 'cap' }, A.parts[it.part].name),
  };
  mesh.userData.inst = inst;
  scene3d.add(group);
  capsEl.append(inst.cap);
  return inst;
}
function poseOf(it) {
  _m4.set(...it.m);
  const p = new THREE.Vector3(), q = new THREE.Quaternion();
  _m4.decompose(p, q, _sc);
  return { p, q, ex: new THREE.Vector3(...it.ex) };
}
function retarget(inst, it, immediate) {
  const to = poseOf(it);
  if (immediate || !inst.from) {
    inst.cur.p.copy(to.p); inst.cur.q.copy(to.q); inst.cur.ex.copy(to.ex);
    inst.from = { p: to.p.clone(), q: to.q.clone(), ex: to.ex.clone() };
    inst.to = to; inst.t0 = -1e9; inst.arc = 0;
  } else {
    inst.from = { p: inst.cur.p.clone(), q: inst.cur.q.clone(), ex: inst.cur.ex.clone() };
    inst.to = to; inst.t0 = performance.now();
    const lateral = Math.hypot(to.p.x - inst.from.p.x, to.p.y - inst.from.p.y);
    inst.arc = lateral > 1 ? 16 : 0; // lift out of the hole, slide, drop back in
  }
}
function removeInst(inst) { scene3d.remove(inst.group); inst.cap.remove(); insts.delete(inst.key); }

// flex-skin flap: swings as one rigid piece about the hinge line (axis along y through the pivot, in the part's own frame)
const _qf = new THREE.Quaternion(), _pv = new THREE.Vector3(), _tp = new THREE.Vector3(), AXIS_Y = new THREE.Vector3(0, 1, 0);
function foldPose(inst) {
  const dir = inst.fold.dir ?? -1;
  _qf.setFromAxisAngle(AXIS_Y, (dir * state.fold * Math.PI) / 180);
  _pv.set(inst.fold.pivot[0], 0, inst.fold.pivot[1]);
  _tp.copy(_pv).applyQuaternion(_qf);
  _tp.subVectors(_pv, _tp).applyQuaternion(inst.cur.q);
  inst.group.position.add(_tp);
  inst.group.quaternion.copy(inst.cur.q).multiply(_qf);
}

const labelsEl = $('labels');
const capsEl = h('div', { class: 'caps' });
labelsEl.append(capsEl);
let labelObjs = [];

const state = { step: 'plate', sub: { C: 'free', D: 'side' }, scene: 'overview', variant: 'plate', explode: 0, explodeTarget: 0, fold: 0, names: true, cam: 'iso' };
const sceneOf = (id) => A.scenes[id];

function buildLabels(v) {
  for (const { el } of labelObjs) el.remove();
  labelObjs = [];
  for (const l of v.labels) {
    const el = h('div', { class: `lbl ${l.cls || ''}` }, h('b', {}, l.text), l.sub ? h('i', {}, l.sub) : null);
    if (l.pick) { el.classList.add('pick'); el.title = 'Show this in 3D'; el.addEventListener('click', () => setVariant(l.pick)); }
    if (l.go) { el.classList.add('pick'); el.title = l.title ? `${l.title}: open this test` : 'Open this test'; el.addEventListener('click', () => go(l.go)); }
    if (l.pick && l.pick === v.id) el.classList.add('on');
    labelsEl.append(el);
    labelObjs.push({ el, l });
  }
}

function tryInfo(sc, v) {
  if (sc === 'dots') return { t: v.id, s: ['1 dot', '2 dots', '3 dots'][+v.id - 1] };
  return { t: v.id, s: sgn(STEPS_MM[+v.id - 1], 1) };
}
const TRY_CAPTION = { dots: 'Socket', snap: 'Hole', pro_b: 'Hole', pro_c_free: 'Hole', pro_c_fric: 'Hole' };

function buildToolbar(sid) {
  const sc = sceneOf(sid), row = $('tryrow');
  row.replaceChildren();
  row.hidden = sc.variants.length < 2;
  if (!row.hidden) {
    row.append(h('span', { class: 'cap-l' }, `Try ${TRY_CAPTION[sid] || 'one'}:`));
    const seg = h('div', { class: 'seg try' });
    for (const v of sc.variants) {
      const t = tryInfo(sid, v);
      const b = h('button', { type: 'button', dataset: { v: v.id } }, t.t, h('small', {}, t.s));
      b.addEventListener('click', () => setVariant(v.id));
      seg.append(b);
    }
    row.append(seg);
  }
  const hasFold = sc.variants.some((v) => v.items.some((i) => i.fold));
  $('foldrow').hidden = !hasFold;
  $('ctlrow').hidden = !sc.explodable && sid === 'overview' ? true : false;
  $('mode').style.display = sc.explodable ? '' : 'none';
  $('explode').style.display = sc.explodable ? '' : 'none';
}

function markToolbar() {
  for (const b of $('tryrow').querySelectorAll('button[data-v]')) b.classList.toggle('on', b.dataset.v === state.variant);
  for (const b of $('mode').children) b.classList.toggle('on', +b.dataset.m === Math.round(state.explodeTarget));
  for (const b of $('cams').children) b.classList.toggle('on', b.dataset.c === state.cam);
  $('explode').value = String(state.explode);
}

function showScene(sid, vid, { keepExplode = false, fresh = false, refit = true } = {}) {
  const sc = sceneOf(sid);
  const v = sc.variants.find((x) => x.id === String(vid)) || sc.variants.find((x) => x.id === sc.default) || sc.variants[0];
  const sceneChanged = state.scene !== sid;
  state.scene = sid; state.variant = v.id;
  const seen = new Set();
  for (const it of v.items) {
    let inst = insts.get(it.key);
    if (inst && (inst.part !== it.part || fresh)) { removeInst(inst); inst = null; }
    const isNew = !inst;
    if (!inst) { inst = makeInst(it); insts.set(it.key, inst); }
    retarget(inst, it, isNew);
    seen.add(it.key);
  }
  for (const inst of [...insts.values()]) if (!seen.has(inst.key)) removeInst(inst);
  bedGroup.visible = !!sc.bed;
  buildLabels(v);
  if (sceneChanged || fresh) buildToolbar(sid);
  if (!keepExplode && (sceneChanged || fresh)) { state.explodeTarget = sc.explode ?? 0; if (fresh) state.explode = state.explodeTarget; }
  $('viewtitle').textContent = sc.variants.length > 1 ? `${sc.title} · ${v.label}` : sc.title;
  if (refit && (sceneChanged || fresh)) fitScene(sid, fresh ? sc.cam : null);
  markToolbar();
}
function setVariant(vid) { showScene(state.scene, vid, { keepExplode: true, refit: false }); }

// ---- camera
const DIRS = { iso: new THREE.Vector3(0.55, -0.95, 0.72), top: new THREE.Vector3(0, -0.03, 1), under: new THREE.Vector3(0.3, -0.8, -0.85) };
let camTween = null;
function sceneBox(sid, t = 0.5) {
  const sc = sceneOf(sid), box = new THREE.Box3(), c = new THREE.Vector3();
  for (const v of sc.variants) for (const it of v.items) {
    _m4.set(...it.m);
    const [lo, hi] = A.parts[it.part].bbox;
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]).applyMatrix4(_m4);
      box.expandByPoint(c);
      if (sc.explodable && t > 0) box.expandByPoint(c.clone().add(new THREE.Vector3(...it.ex).multiplyScalar(t)));
    }
  }
  if (sc.bed) { box.expandByPoint(new THREE.Vector3(-sc.bed[0] / 2, -sc.bed[1] / 2, 0)); box.expandByPoint(new THREE.Vector3(sc.bed[0] / 2, sc.bed[1] / 2, 0)); }
  return box;
}
function fitScene(sid, camName, t = state.explodeTarget) {
  if (!GL) return;
  if (camName) state.cam = camName;
  const box = sceneBox(sid, t), center = box.getCenter(new THREE.Vector3()), sphere = box.getBoundingSphere(new THREE.Sphere());
  const aspect = Math.max(0.5, camera.aspect || 1.4);
  const room = size.h / Math.max(1, size.h - barH); // the controls cover the bottom of the view
  const dist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * (aspect < 1 ? 1 / aspect : 1) * 0.9 * room;
  const dir = camName ? DIRS[camName].clone().normalize() : camera.position.clone().sub(controls.target).normalize();
  flyTo(center.clone().add(dir.multiplyScalar(dist)), center);
  markToolbar();
}
function flyTo(pos, target, ms = 600) {
  camTween = { t0: performance.now(), ms, p0: camera.position.clone(), p1: pos, q0: controls.target.clone(), q1: target };
}
function setCam(name) {
  state.cam = name;
  const box = sceneBox(state.scene, state.explodeTarget), center = box.getCenter(new THREE.Vector3());
  const dist = Math.max(camera.position.distanceTo(controls.target), 40);
  flyTo(center.clone().add(DIRS[name].clone().normalize().multiplyScalar(dist)), center);
  markToolbar();
}

// ---- resize, picking, render loop
const size = { w: 1, h: 1 };
const barEl = document.querySelector('.stage-bar');
let barH = 0; // height of the floating controls: the model is framed in the space above them
function resize() {
  const w = Math.max(1, stage.clientWidth), h2 = Math.max(1, stage.clientHeight);
  size.w = w; size.h = h2;
  barH = Math.min(barEl.offsetHeight + 12, h2 * 0.45);
  if (GL) {
    renderer.setSize(w, h2, false);
    camera.aspect = w / h2;
    camera.setViewOffset(w, h2, 0, barH / 2, w, h2);
    camera.updateProjectionMatrix();
  }
}
let refitTimer = 0;
function onResize() {
  resize();
  // keep a preset view framed when the window or the control bars change size (a view you have orbited stays where you put it)
  cancelAnimationFrame(refitTimer);
  refitTimer = requestAnimationFrame(() => { if (state.cam && state.scene && controls) fitScene(state.scene, state.cam, state.explodeTarget); });
}
new ResizeObserver(onResize).observe(stage);
new ResizeObserver(onResize).observe(barEl);
resize();

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const sc = sceneOf(state.scene);
  if (!sc.bed) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([...insts.values()].map((i) => i.mesh), false)[0];
  if (!hit) return;
  const gid = hit.object.userData.inst.key.split(':')[0];
  const label = sc.variants[0].labels.find((l) => l.key.split(':')[0] === gid && l.go);
  if (label) go(label.go);
});
canvas.addEventListener('pointermove', (e) => { if (e.buttons) return; canvas.style.cursor = sceneOf(state.scene).bed ? 'pointer' : 'grab'; });
controls?.addEventListener('start', () => { state.cam = ''; markToolbar(); });

const _v = new THREE.Vector3(), _box = new THREE.Box3();
function project(x, y, z, el, dx = '-50%', dy = '-50%') {
  _v.set(x, y, z).project(camera);
  if (_v.z > 1 || _v.z < -1) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * size.w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * size.h).toFixed(1)}px) translate(${dx}, ${dy})`;
}
let lastNow = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!GL) return;
  const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000)); lastNow = now;
  const dE = state.explodeTarget - state.explode;
  if (Math.abs(dE) > 0.0005) { state.explode += dE * (1 - Math.exp(-dt * 9)); if (Math.abs(state.explodeTarget - state.explode) < 0.002) state.explode = state.explodeTarget; $('explode').value = String(state.explode); }
  for (const inst of insts.values()) {
    const u = Math.min(1, (now - inst.t0) / TWEEN_MS), e = ease(u);
    inst.cur.p.lerpVectors(inst.from.p, inst.to.p, e);
    inst.cur.q.slerpQuaternions(inst.from.q, inst.to.q, e);
    inst.cur.ex.lerpVectors(inst.from.ex, inst.to.ex, e);
    inst.group.position.copy(inst.cur.p).addScaledVector(inst.cur.ex, state.explode);
    if (inst.arc && u < 1) inst.group.position.z += inst.arc * Math.sin(Math.PI * e);
    inst.group.quaternion.copy(inst.cur.q);
    if (inst.fold) foldPose(inst);
  }
  if (camTween) {
    const u = Math.min(1, (now - camTween.t0) / camTween.ms), e = ease(u);
    camera.position.lerpVectors(camTween.p0, camTween.p1, e);
    controls.target.lerpVectors(camTween.q0, camTween.q1, e);
    if (u >= 1) camTween = null;
  }
  controls.update();
  renderer.render(scene3d, camera);
  // labels follow the parts they belong to
  for (const { el, l } of labelObjs) {
    const inst = insts.get(l.key);
    if (!inst) { el.style.display = 'none'; continue; }
    _v.set(...l.p); inst.group.localToWorld(_v);
    project(_v.x, _v.y, _v.z, el);
  }
  const showCaps = state.names && !sceneOf(state.scene).bed;
  capsEl.style.display = showCaps ? '' : 'none';
  if (showCaps) for (const inst of insts.values()) {
    inst.cap.hidden = inst.nocap;
    if (inst.nocap) continue;
    _box.setFromObject(inst.group);
    project((_box.min.x + _box.max.x) / 2, _box.max.y, _box.max.z, inst.cap, '-50%', '-135%');
  }
}
requestAnimationFrame(frame);

// stage controls
$('mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.explodeTarget = +b.dataset.m; fitScene(state.scene, null, state.explodeTarget); markToolbar(); });
$('explode').addEventListener('input', (e) => { state.explode = state.explodeTarget = +e.target.value; markToolbar(); });
$('cams').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setCam(b.dataset.c); });
$('names').addEventListener('change', (e) => { state.names = e.target.checked; });
$('fold').addEventListener('input', (e) => {
  state.fold = +e.target.value; $('foldv').textContent = `${state.fold}°`;
});

// ------------------------------------------------------------------ steps
const STEPS = [
  { id: 'plate', k: '•', name: 'Plate', scene: 'overview' },
  { id: 'prep', k: 'P', name: 'Prep', scene: 'prep' },
  { id: 'dots', k: '1', name: 'Dots', scene: 'dots' },
  { id: 'A', k: 'A', name: 'Snap', scene: 'snap' },
  { id: 'B', k: 'B', name: 'Shaft', scene: 'pro_b' },
  { id: 'C', k: 'C', name: 'Pins', scene: 'pro_c_free' },
  { id: 'D', k: 'D', name: 'Cubes', scene: 'cube_side' },
  { id: 'E', k: 'E', name: 'Flex', scene: 'flex' },
  { id: 'result', k: '✓', name: 'Result', scene: 'overview' },
];
const stepIdx = (id) => STEPS.findIndex((s) => s.id === id);

function stepStatus(id) {
  if (id === 'prep') { const n = Object.values(card.prep).filter(Boolean).length; return n === 2 ? 2 : n ? 1 : 0; }
  const fs = FIELDS.filter((f) => FIELD_STEP[f] === id);
  if (!fs.length) return id === 'result' ? (FIELDS.every(filled) ? 2 : 0) : 0;
  const n = fs.filter(filled).length;
  return n === fs.length ? 2 : n ? 1 : 0;
}

function sceneForStep(id) {
  if (id === 'C') return state.sub.C === 'free' ? 'pro_c_free' : 'pro_c_fric';
  if (id === 'D') return `cube_${state.sub.D}`;
  return STEPS[stepIdx(id)].scene;
}
function variantForStep(id) {
  const ladder = (v) => (typeof v === 'number' ? String(v) : null);
  switch (id) {
    case 'dots': return card.dots ? String(card.dots) : null;
    case 'A': return ladder(card.A);
    case 'B': return ladder(card.B);
    case 'C': return ladder(state.sub.C === 'free' ? card.Cfree : card.Cfric);
    default: return null;
  }
}

function go(target) {
  let [id, sub] = String(target).split(':');
  if (stepIdx(id) < 0) id = 'plate';
  if (sub && (id === 'C' || id === 'D')) state.sub[id] = sub;
  state.step = id;
  const sid = sceneForStep(id);
  showScene(sid, variantForStep(id), { fresh: true });
  renderPanel();
  $('panel').scrollTop = 0;
  try { history.replaceState(null, '', `#${id}`); } catch { /* file:// in some browsers */ }
  syncAll();
}
function swapScene(sid) { // sub-view inside one step: keep the camera and explode setting
  showScene(sid, variantForStep(state.step), { keepExplode: true, refit: false });
  buildToolbar(sid); markToolbar();
  fitScene(sid, null);
}

// ------------------------------------------------------------------ panel building blocks
const panel = $('panel');
const head = (title, lede) => h('div', {}, h('h2', {}, title), lede ? h('p', { class: 'lede' }, lede) : null);
const holding = (...names) => h('div', { class: 'holding' }, names.map((n) => h('span', { class: 'pill amber' }, n)));
const callout = (kind, title, html) => h('div', { class: `callout ${kind}` }, title ? h('b', { class: 't' }, title) : null, h('div', { html }));
const sect = (t) => h('h3', {}, t);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setField(f, v) {
  card[f] = v; save();
  if (typeof v === 'number' && FIELD_STEP[f] === state.step) { // show the step you just scored
    const vid = variantForStep(state.step);
    if (vid && sceneOf(state.scene).variants.some((x) => x.id === vid)) setVariant(vid);
  } else if (f === 'dots') { const vid = variantForStep(state.step); if (vid) setVariant(vid); }
  syncAll();
}
function choice(field, options, cls = '') {
  const wrap = h('div', { class: `chips ${cls}` });
  for (const o of options) {
    const b = h('button', { type: 'button', class: o.ghost ? 'ghost' : '', dataset: { field, v: String(o.v) } }, o.label, o.sub ? h('small', {}, o.sub) : null);
    b.addEventListener('click', () => setField(field, String(card[field]) === String(o.v) ? '' : o.v));
    wrap.append(b);
  }
  return wrap;
}
function stepChips(field) {
  const main = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ v: n, label: String(n), sub: sgn(STEPS_MM[n - 1], 1) }));
  return h('div', {},
    choice(field, main, 'steps'),
    h('div', { style: 'height:6px' }),
    choice(field, [{ v: 'tight', label: 'Every step too tight', ghost: true }, { v: 'loose', label: 'Every step too loose', ghost: true }]));
}
function field(label, hint, control) {
  return h('div', { class: 'field' }, h('div', { class: 'fl' }, label, hint ? h('span', { class: 'hint' }, ` ${hint}`) : null), control);
}
function textInput(f, ph, multi) {
  const el = multi ? h('textarea', { placeholder: ph }) : h('input', { type: 'text', placeholder: ph });
  el.value = card[f] ?? '';
  el.addEventListener('input', () => { card[f] = el.value; save(); syncAll(true); });
  return el;
}
function numInput(f, ph) {
  const el = h('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', placeholder: ph });
  el.value = card[f] === '' ? '' : String(card[f]);
  el.addEventListener('input', () => { card[f] = el.value === '' ? '' : Math.max(0, Math.floor(+el.value)); save(); syncAll(true); });
  return el;
}
function notesBox() {
  return h('div', { class: 'field' }, h('div', { class: 'fl' }, 'Notes', h('span', { class: 'hint' }, ' anything that broke, warped, or felt odd')), textInput('notes', 'e.g. step 5 stud sat slightly proud…', true));
}
function navButtons() {
  const i = stepIdx(state.step), prev = STEPS[i - 1], next = STEPS[i + 1];
  return h('div', { class: 'nav' },
    prev ? h('button', { class: 'btn', type: 'button', onclick: () => go(prev.id) }, `← ${prev.name}`) : null,
    h('span', { class: 'grow', style: 'flex:1' }),
    next ? h('button', { class: 'btn primary', type: 'button', onclick: () => go(next.id) }, `${next.name} →`) : null);
}
function subTabs(key, options, onPick) {
  const wrap = h('div', { class: 'seg sub-tabs' });
  for (const o of options) {
    const b = h('button', { type: 'button', class: state.sub[key] === o.v ? 'on' : '' }, o.label);
    b.addEventListener('click', () => { state.sub[key] = o.v; onPick(o.v); renderPanel(); syncAll(); });
    wrap.append(b);
  }
  return h('div', {}, wrap);
}
const passBox = (txt) => callout('pass', 'Pass when', txt);
const derive = (id) => h('div', { dataset: { derive: id } });

// ------------------------------------------------------------------ the step panels
const R = {};

R.plate = (p) => {
  p.append(head('Your calibration plate', 'Pieces are drawn flat on the bed the way they print. The arrangement is illustrative; your slicer laid them out its own way. Click any piece (or its badge) to jump to its test.'));
  p.append(callout('warn', 'Safety first', 'Keep the pins, shaft, stud tester, cubes and ladders out of reach of young children. They are small-parts testing gauges.'));
  p.append(sect('How to use this'));
  p.append(h('ol', { class: 'steps' },
    h('li', { html: '<b>Prep</b>: trim the brims, snap the tabs.' }),
    h('li', { html: 'Work through the tabs <b>1, A to E</b>. The 3D view shows the exact test pose; flip <b>Exploded</b> to see what goes into what, <b>Construction</b> to see it assembled.' }),
    h('li', { html: 'Score each test in the card on the right. Everything saves in this browser as you go.' }),
    h('li', { html: '<b>Result</b> shows the slicer offset and gives you the text to paste back.' })));
  if (PM) {
    p.append(sect(`Print check, read from ${PM.file}`));
    const rows = [
      ['Printer / slicer', `${PM.printer_model} · ${PM.slicer}`, null],
      ['Filament', `${PM.filament_settings_id} (${PM.filament_type}) · ${PM.nozzle_temperature} °C`, null],
      ['Nozzle · layer', `${PM.nozzle_diameter} mm · ${PM.layer_height} mm`, PM.nozzle_diameter === '0.4' && PM.layer_height === '0.2' ? ['ok', 'as specified'] : ['warn', 'spec: 0.4 / 0.2']],
      ['XY compensation', `contour ${PM.xy_contour_compensation} · hole ${PM.xy_hole_compensation}`, +PM.xy_contour_compensation === 0 && +PM.xy_hole_compensation === 0 ? ['ok', 'zero, as required'] : ['warn', 'must be 0']],
      ['Walls · infill', `${PM.wall_loops} · ${PM.sparse_infill_density}`, +PM.wall_loops === 3 ? ['ok', 'as specified'] : ['warn', 'spec: 3 walls']],
      ['Supports', PM.enable_support === '1' ? 'enabled' : 'off', PM.enable_support === '1' ? ['warn', 'spec: none'] : ['ok', 'as specified']],
    ];
    p.append(h('div', { class: 'kv' }, rows.flatMap(([k, v, s]) => [h('span', { class: 'k' }, k), h('span', {}, v), s ? h('span', { class: `s ${s[0]}` }, s[1]) : h('span')])));
    if (PM.enable_support === '1') {
      const sup = Object.entries(PM.supports_by_object || {});
      const NICE = { cal_flex_skin_coupon: 'flex skin coupon', cal_stud_tester: 'stud tester', cal_forge_mount_first_print: 'Forge Mount First-Print', cal_cube_cell: 'cube cell', cal_snap_ladder: 'snap ladder', cal_pro_ladder: 'pro ladder' };
      p.append(sup.length
        ? callout('warn', 'Supports were switched on in that slice', `Support material was generated inside only: <b>${sup.map(([o, n]) => `${esc(NICE[o] || o)} (${n} moves)`).join(', ')}</b>. Every other gauge (ladders, pins, cubes and dot strip) got zero support moves, so their fits are clean. Note: the updated calibration STLs now print the flex skin smooth show-face-down with upward-opening sockets and give the stud tester a solid flat bottom, eliminating all socket support moves even with Auto Support left on.`)
        : callout('info', 'Zero support moves generated', 'Supports were enabled in the slicer, and every calibration piece generated zero support moves.'));
    }
  }
  p.append(navButtons());
};

R.prep = (p) => {
  p.append(head('Prep: de-brim and snap the tabs', 'Two things before any fit test, or leftovers will fake a tight fit.'));
  p.append(sect('Checklist'));
  const check = (key, text) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!card.prep[key];
    cb.addEventListener('change', () => { card.prep[key] = cb.checked; save(); syncAll(); });
    return h('label', { class: 'chk', style: 'display:flex;gap:8px;align-items:flex-start;margin:8px 0;color:var(--ink);font-size:14px' }, cb, h('span', { html: text }));
  };
  p.append(check('brims', '<b>Trim the brims completely off</b> the shaft, free pin, friction pin and cube cell, so a leftover lip does not fake a tight fit.'));
  p.append(check('fp', '<b>Snap the 1.2 mm tabs on the Forge Mount First-Print</b>. It separates into the 3×2 stud base, the 1/2/3-dot strip, and the 2×1 single-stud test brick.'));
  p.append(callout('info', 'In the 3D view', 'Press <b>Exploded</b> to see where each piece parts. The red <b>snap</b> tags mark the tabs. Any stub left on a piece sits on the bed face, so trim it flush if it catches.'));
  p.append(navButtons());
};

R.dots = (p) => {
  p.append(head('1 · Dot strip: your Fit setting', 'This is the one question a customer would ever see: which socket clicked best?'));
  p.append(holding('Forge Mount First-Print → 1/2/3-dot strip', '2×1 test brick'));
  p.append(h('p', {}, "Press the test brick's stud into each underside socket on the dotted strip. The 3D view drops the strip over the stud."));
  const rows = A.kit.sockets.map((s, i) => h('tr', { class: s.as_designed ? 'hl' : '' }, h('td', {}, `${s.dots} dot${s.dots > 1 ? 's' : ''}`), h('td', {}, ['Snug', 'Standard', 'Easy'][i]), h('td', {}, `${s.clearance_mm.toFixed(2)} mm${s.as_designed ? ' (designed)' : ''}`)));
  p.append(h('table', { class: 'mini' }, h('tr', {}, h('th', {}, 'Dots'), h('th', {}, 'Fit'), h('th', {}, 'Clearance')), rows));
  p.append(passBox('Goes in with a firm thumb press, holds upside-down with a gentle shake, and pulls off by hand without tools.'));
  p.append(h('div', { class: 'card' }, sect('Scorecard'),
    field('Best socket', '', choice('dots', [{ v: 1, label: '1', sub: 'Snug' }, { v: 2, label: '2', sub: 'Standard' }, { v: 3, label: '3', sub: 'Easy' }, { v: 'none', label: 'None felt right', ghost: true }])),
    derive('dotsInfo')));
  p.append(notesBox(), navButtons());
};

function ladderIntro(p, what) {
  p.append(h('p', {}, h('b', {}, 'Step 1'), ' is at the 45° notched corner; count 1 → 8 away from it. ', h('b', {}, 'Step 2'), ' has the small round dimple: that is the CAD size (0.0 mm). Each step adds 0.1 mm across. The small numbers under each step are the extra clearance D.'));
  if (what) p.append(what);
}

R.A = (p) => {
  p.append(head('A · Snap ladder', 'Stud-hole ladder, 8 steps.'));
  p.append(holding('Snap ladder', 'Stud tester'));
  ladderIntro(p);
  p.append(h('p', {}, "Press the tester's stud into holes 1 to 8. The 3D view flips the tester over onto the hole you pick."));
  p.append(passBox('Presses in firmly, holds upside-down on a gentle shake, and comes out by hand without tools. Record the step that does all three.'));
  p.append(h('div', { class: 'card' }, sect('Scorecard'), field('Snap stud step (1 to 8)', '', stepChips('A')), derive('abAgree')));
  p.append(notesBox(), navButtons());
};

R.B = (p) => {
  p.append(head('B · Pro ladder, flat-sided holes', 'Double-D holes that should lock the shaft against turning.'));
  p.append(holding('Pro ladder', 'Shaft'));
  ladderIntro(p);
  p.append(h('p', {}, 'Use the flat-sided holes: the row along the notched edge. The shaft goes in from the top.'));
  p.append(passBox('Slides in with finger pressure and has zero rotational play. Record the step that does both.'));
  p.append(h('div', { class: 'card' }, sect('Scorecard'), field('Pro shaft step (1 to 8)', '', stepChips('B')), derive('abAgree')));
  p.append(notesBox(), navButtons());
};

R.C = (p) => {
  p.append(head('C · Pro ladder, round holes', 'The other row: round holes for the two pins.'));
  p.append(holding('Pro ladder', 'Free pin', 'Friction pin'));
  ladderIntro(p);
  p.append(subTabs('C', [{ v: 'free', label: 'Free pin' }, { v: 'fric', label: 'Friction pin' }], (v) => swapScene(sceneForStep('C'))));
  if (state.sub.C === 'free') {
    p.append(passBox('The right step spins freely with no wobble.'));
  } else {
    p.append(passBox('The right step takes a firm thumb push, grips, and pulls out by hand.'));
  }
  p.append(h('div', { class: 'card' }, sect('Scorecard'),
    field('Free pin step (1 to 8)', 'spins freely, no wobble', stepChips('Cfree')),
    field('Friction pin step (1 to 8)', 'firm push, grips, pulls out by hand', stepChips('Cfric'))));
  p.append(notesBox(), navButtons());
};

R.D = (p) => {
  const cp = A.notes?.cube_pin;
  p.append(head('D · Cube cell and crush-rib face plate', 'These parts grip by flexing, not by precision, so they should fit with no slicer compensation.'));
  p.append(holding('Cube cell ×2', 'Friction pin', 'Face plate'));
  p.append(subTabs('D', [{ v: 'side', label: 'Side to side' }, { v: 'top', label: 'Top to bottom' }, { v: 'plate', label: 'Face plate' }], (v) => swapScene(sceneForStep('D'))));
  p.append(h('ul', { class: 'plain' },
    h('li', { html: 'Do the sideways teardrop holes in the 12.5 mm cube look clean?' }),
    h('li', { html: 'Join the two cubes with the friction pin, <b>side to side</b>, then <b>top to bottom</b>. Does the pin grip inside both the vertical and the sideways holes, and do the cubes come apart by hand?' }),
    h('li', { html: 'Press the face plate (3 crush ribs) into an open hole: does it hold, sit flat, and pull out by hand?' })));
  if (cp) p.append(callout('warn', 'Heads-up from the CAD', `With the pin pushed all the way through, its grip fins land in the middle of each cube, where the three holes cross, so the CAD shows <b>${cp.full_insertion_mm3} mm³</b> of bite there (a Pro-ladder hole gives ${cp.ladder_mm3} mm³). If the pin feels <b>loose</b> at full depth, that is the design, not your printer. Try it pushed about ${Math.abs(cp.best_offset_mm)} mm off-centre, where the CAD bite is ${cp.best_offset_mm3} mm³, and say so in the notes.`));
  p.append(h('div', { class: 'card' }, sect('Scorecard'),
    field('Cube sideways holes clean?', '', choice('Dholes', [{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }])),
    field('Friction pin in cube', '', choice('Dpin', [{ v: 'good', label: 'Good' }, { v: 'loose', label: 'Loose' }, { v: 'tight', label: 'Tight' }])),
    field('Face plate', 'holds, sits flat, pulls out by hand', choice('Dplate', [{ v: 'good', label: 'Good' }, { v: 'loose', label: 'Loose' }, { v: 'tight', label: 'Tight' }]))));
  p.append(notesBox(), navButtons());
};

R.E = (p) => {
  p.append(head('E · Flex skin coupon', '0.80 mm sheet with 0.60 mm hinge webs, printed smooth show-face-down so its blind stud sockets open upward with zero support plugs.'));
  p.append(holding('Flex skin coupon', 'Forge Mount base'));
  p.append(h('ol', { class: 'steps' },
    h('li', { html: 'Flip the skin over (the smooth bed face is the outside show surface) and press its <b>blind stud sockets</b> onto the 3×2 Forge Mount studs.' }),
    h('li', { html: 'Fold the loose flap along the <b>0.60 mm hinge</b> (drag the <b>Fold</b> slider in the 3D view to see which flap).' }),
    h('li', { html: 'Note how the sockets feel, and <b>count the folds</b> until the hinge whitens or cracks (PLA is a baseline count; Card D skins print in PETG or TPU).' })));
  p.append(h('div', { class: 'card' }, sect('Scorecard'),
    field('Stud sockets fit?', '', choice('Esock', [{ v: 'yes', label: 'Yes' }, { v: 'loose', label: 'Loose' }, { v: 'tight', label: 'Tight' }])),
    field('Folds before whitening or cracking', 'a number', numInput('Efolds', 'e.g. 12'))));
  p.append(notesBox(), navButtons());
};

// ------------------------------------------------------------------ result
const LADDER_FIELDS = new Set(['A', 'B', 'Cfree', 'Cfric']);
const LADDER_WORDS = { tight: 'none (every step too tight)', loose: 'none (every step too loose)' };
const WORDS = { none: 'none' };
function show(f) { // the scorecard text for field f ('loose' on a pin test means loose, not "every step too loose")
  const v = card[f];
  if (v === '' || v == null) return '';
  if (LADDER_FIELDS.has(f) && LADDER_WORDS[v]) return LADDER_WORDS[v];
  return WORDS[v] ?? String(v);
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
function derived() {
  const a = typeof card.A === 'number' ? card.A : null, b = typeof card.B === 'number' ? card.B : null;
  if (a == null && b == null) return null;
  const agree = a != null && b != null ? Math.abs(a - b) <= 1 : null;
  // when A and B disagree there is no single XY offset to average: the snap-side test A (stud and hole, as the dot strip) sets the slicer offset
  const used = agree === false ? [a] : [a, b].filter((x) => x != null);
  const D = mean(used.map((x) => STEPS_MM[x - 1]));
  const pinSteps = [b, typeof card.Cfree === 'number' ? card.Cfree : null].filter((x) => x != null);
  return { a, b, D, s: D / 4, agree, basis: agree === false ? 'A alone' : used.length > 1 ? 'the mean of A and B' : a != null ? 'A' : 'B', used, pinD: pinSteps.length ? mean(pinSteps.map((x) => STEPS_MM[x - 1])) : null };
}
const dotInfo = () => {
  const i = typeof card.dots === 'number' ? card.dots - 1 : -1;
  return i < 0 ? null : { sock: A.kit.sockets[i], name: ['snug', 'standard', 'easy'][i] };
};

function scoreText() {
  const d = derived();
  const lines = [
    `Printer / slicer / filament: ${card.printer}`,
    `1-2-3 Dot strip best socket: ${show('dots')}`,
    `A  Snap stud step (1-8): ${show('A')}`,
    `B  Pro shaft step (1-8): ${show('B')}`,
    `C  Free pin step (1-8): ${show('Cfree')}        Friction pin step (1-8): ${show('Cfric')}`,
    `D  Cube sideways holes clean? ${show('Dholes')} | pin in cube: ${show('Dpin')} | face plate: ${show('Dplate')}`,
    `E  Flex skin (PLA): sockets fit? ${show('Esock')} | folds before whitening/crack: ${show('Efolds')}`,
    `Notes: ${card.notes.replace(/\n+/g, ' / ')}`,
  ];
  const extra = [];
  const di = dotInfo();
  if (di) extra.push(`dots -> fit "${di.name}" (${di.sock.clearance_mm.toFixed(2)} mm)`);
  if (d) extra.push(`slicer offset from ${d.basis}: D = ${sgn(d.D, 3)} mm -> s = ${sgn(d.s)} mm -> contour comp ${sgn(-d.s)} / hole comp ${sgn(d.s)}`);
  if (d && d.agree === false) extra.push(`A (step ${d.a}) and B (step ${d.b}) differ by ${Math.abs(d.a - d.b)} steps, so this is not one XY offset; the pin tests ask for about ${sgn(d.pinD, 2)} mm extra pin clearance on top`);
  return lines.join('\n') + (extra.length ? `\n\n(computed in the guide)\n${extra.join('\n')}` : '');
}

const DERIVE = {
  dotsInfo(el) {
    el.replaceChildren();
    if (card.dots === 'none') { el.append(callout('warn', 'Noted', 'None of the three sockets worked. Say how it failed (all too loose, all too tight, cracked) in the notes.')); return; }
    const di = dotInfo();
    if (!di) return;
    const w = di.sock.surface_offset_window_mm;
    el.append(callout('info', 'What this sets', `App <b>Fit setting: ${di.name}</b> (${di.sock.clearance_mm.toFixed(2)} mm clearance). That socket stays within the fit limits for printers whose surface offset is between <b>${sgn(w[0], 3)}</b> and <b>${sgn(w[1], 3)} mm</b>.`));
  },
  abAgree(el) {
    el.replaceChildren();
    const d = derived();
    if (!d) return;
    const bits = [];
    if (d.a != null) bits.push(`A = step ${d.a} (${sgn(STEPS_MM[d.a - 1], 1)} mm)`);
    if (d.b != null) bits.push(`B = step ${d.b} (${sgn(STEPS_MM[d.b - 1], 1)} mm)`);
    if (d.agree === false) el.append(callout('warn', 'A and B disagree', `${bits.join(' · ')}. They should agree within one step; recheck the hole that held on both, or note why they differ.`));
    else if (d.agree === true) el.append(callout('pass', 'A and B agree', `${bits.join(' · ')}. Within one step.`));
  },
  derived(el) {
    el.replaceChildren();
    const bad = ['A', 'B'].filter((f) => card[f] === 'tight' || card[f] === 'loose');
    if (bad.length) el.append(callout('bad', 'The ladder range was too narrow', `${bad.map((f) => `${f}: ${card[f] === 'tight' ? 'every step too tight' : 'every step too loose'}`).join(' · ')}. The ladder needs a wider range for this printer. Send this card as it is.`));
    const d = derived();
    if (!d) { el.append(h('p', { class: 'lede' }, 'Score ladders A and B to get your slicer offset.')); return; }
    el.append(h('p', {}, `From ${d.basis}: extra clearance `, h('b', {}, `D = ${sgn(d.D, 3)} mm`), `, so the surface offset `, h('b', {}, `s = D / 4 = ${sgn(d.s)} mm`), '.'));
    if (d.agree === false) el.append(callout('warn', `A and B differ by ${Math.abs(d.a - d.b)} steps`, `That is not one XY offset, so they are not averaged. The slicer offset above comes from the snap-side test A (stud in hole, like the dot strip). The pin tests (B${typeof card.Cfree === 'number' ? ' and the free pin' : ''}) ask for about <b>${sgn(d.pinD, 2)} mm</b> more pin clearance than the CAD gives, which a global slicer offset cannot supply without loosening every snap fit. Caliper the printed shaft and pins and send me the numbers.`));
    el.append(h('table', { class: 'mini' },
      h('tr', {}, h('th', {}, 'Slicer'), h('th', {}, 'Setting')),
      h('tr', {}, h('td', {}, 'OrcaSlicer / Bambu Studio'), h('td', {}, `X-Y contour ${sgn(-d.s)} · X-Y hole ${sgn(d.s)} mm`)),
      h('tr', {}, h('td', {}, 'PrusaSlicer'), h('td', {}, `XY Size Compensation ${sgn(-d.s)} mm`)),
      h('tr', {}, h('td', {}, 'Cura'), h('td', {}, `Horizontal Expansion ${sgn(-d.s)} mm`))));
    el.append(h('p', { class: 'lede' }, Math.abs(d.s) < 0.005
      ? 'Nothing to change: the studs and holes already come out at the designed size, so leave the slicer compensation at 0.'
      : 'Round to what your slicer accepts. Reprint the Snap ladder with this setting: step 2 (the dimple) should then feel right.'));
  },
  scoretext(el) { el.textContent = scoreText(); },
};

R.result = (p) => {
  p.append(head('Result', 'Your scorecard, the slicer offset it implies, and the text to send back.'));
  p.append(derive('missing'));
  p.append(sect('Slicer offset'), derive('derived'), derive('dotsInfo'));
  p.append(sect('Send this back'));
  p.append(h('div', { class: 'field' }, h('div', { class: 'fl' }, 'Printer / slicer / filament', PM ? h('span', { class: 'hint' }, ' filled in from your gcode, edit if wrong') : null), textInput('printer', 'printer / slicer / filament')));
  p.append(h('pre', { class: 'out', dataset: { derive: 'scoretext' } }));
  p.append(notesBox());
  p.append(h('div', { class: 'row', style: 'margin-top:12px' },
    h('button', { class: 'btn primary', type: 'button', onclick: copyScore }, 'Copy scorecard'),
    h('button', { class: 'btn', type: 'button', onclick: downloadJson }, 'Download .json'),
    h('span', { style: 'flex:1' }),
    h('button', { class: 'btn danger sm', type: 'button', onclick: resetAll }, 'Clear all')));
  p.append(callout('info', 'About the physical checks', 'These answers are measurements from one print. They do not mark any part\'s printed-fit or breakage check as passed; that is recorded separately once the numbers are in.'));
  p.append(navButtons());
};
DERIVE.missing = (el) => {
  el.replaceChildren();
  const miss = FIELDS.filter((f) => !filled(f));
  if (!miss.length) { el.append(callout('pass', 'Scorecard complete', 'Every field is filled in.')); return; }
  const steps = [...new Set(miss.map((f) => FIELD_STEP[f]))];
  const names = { dots: '1 Dots', A: 'A Snap', B: 'B Shaft', C: 'C Pins', D: 'D Cubes', E: 'E Flex' };
  el.append(h('div', { class: 'callout warn missing' }, h('b', { class: 't' }, `${miss.length} of ${FIELDS.length} fields still empty`),
    steps.map((s) => h('a', { onclick: () => go(s) }, names[s]))));
};

async function copyScore() {
  const t = scoreText();
  try { await navigator.clipboard.writeText(t); toast('Scorecard copied'); return; } catch { /* fall back */ }
  const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); toast('Scorecard copied'); } catch { toast('Select the text and copy it by hand'); }
  ta.remove();
}
function downloadJson() {
  const out = { saved: new Date().toISOString(), card, computed: derived(), dots: dotInfo() && { fit: dotInfo().name, clearance_mm: dotInfo().sock.clearance_mm }, gcode: PM };
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })), download: 'calibration-scorecard.json' });
  document.body.append(a); a.click(); a.remove();
}
function resetAll() {
  if (!confirm('Clear every answer on this scorecard?')) return;
  card = blank(); save(); go('plate'); toast('Scorecard cleared');
}

// ------------------------------------------------------------------ chrome: tabs, progress, panel
function renderTabs() {
  const nav = $('tabs');
  nav.replaceChildren();
  for (const s of STEPS) nav.append(h('button', { type: 'button', dataset: { step: s.id }, onclick: () => go(s.id) }, h('span', { class: 'k' }, s.k), s.name));
}
function renderPanel() {
  panel.replaceChildren();
  R[state.step](panel);
}
function syncAll(light) {
  for (const b of panel.querySelectorAll('[data-field]')) b.classList.toggle('on', String(card[b.dataset.field]) === b.dataset.v);
  for (const el of panel.querySelectorAll('[data-derive]')) DERIVE[el.dataset.derive]?.(el);
  for (const b of $('tabs').children) {
    const st = stepStatus(b.dataset.step);
    b.classList.toggle('on', b.dataset.step === state.step);
    b.classList.toggle('done', st === 2 && b.dataset.step !== state.step);
    b.classList.toggle('part', st === 1 && b.dataset.step !== state.step);
  }
  const n = FIELDS.filter(filled).length;
  $('progtxt').textContent = `${n} of ${FIELDS.length} scored`;
  $('barfill').style.width = `${(n / FIELDS.length) * 100}%`;
}

$('meta').textContent = PM ? `${PM.printer_model} · ${PM.filament_type}` : '';
renderTabs();
go(location.hash.slice(1) && stepIdx(location.hash.slice(1)) >= 0 ? location.hash.slice(1) : 'plate');
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (stepIdx(id) >= 0 && id !== state.step) go(id); });
window.__guide = { state, insts, go, setVariant, card: () => card, showScene, minZ: (key) => new THREE.Box3().setFromObject(insts.get(key).group).min.z }; // for the headless check
