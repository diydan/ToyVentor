// kip-bench.js: the Kip bench as a module (Workshop stage 4a, docs/specs/workshop-spec.md).
// Moved here from Kip-Demo.html (its markup, style and script) in one step; this file is now the source, edit it here. The page is a loader.
// The function body is not re-indented on purpose, so `git diff --color-moved` against the old page stays readable.
import {
  THREE,
  OrbitControls,
  STLLoader,
  GLTFLoader,
  FBXLoader,
  RoomEnvironment,
  mergeVertices,
  toCreasedNormals,
} from '/kip/vendor/three-kip.js';
import {
  DECAL_EXPRESSIONS,
  KID_DRAWING_PRESETS,
  createDecalExpressionCanvas,
  createTorsoOutfitDecalCanvas,
  renderKidPresetToCanvas,
  segmentForegroundMask,
  trySamScanEndpoint,
  buildPhotoAccessoryMesh,
  buildHouseholdHandMesh,
  applyHouseholdSkin,
  encodeToyContractHash,
  setSelfieCanvas,
} from '/kip/kip-forge-sdk.js?v=10.0';
import {
  HUMAN_HEAD_IDS,
  headphonesFit,
  FACE_INSERT_MODES,
  HEAD_CATEGORIES,
  WARDROBE_HEADS,
  headsInCategory,
  categoryOfHead,
  SHIRT_OPTIONS,
  PANTS_OPTIONS,
  SKIN_TONES,
  HAIR_COLORS,
  HAT_COLORS,
  HAIR_OPTIONS,
  HAT_OPTIONS,
  FACE_STEM_MM,
  BACK_OPTIONS,
  PROP_OPTIONS,
  VEHICLE_OPTIONS,
  makeDriveSitClip,
  makeScooterRideClip,
  makeMotoStraddleClip,
  makeSkateboardClip,
} from '/kip/kip-vehicles-wardrobe.js?v=10.0';
import { createMenuHost } from '/kip/kip-menu.js?v=10.0';
import { mountPrintView } from '/kip/kip-print-view.js?v=10.0';
import { mountSelfie } from '/kip/kip-selfie.js?v=10.0';
import { mountDescribe } from '/kip/kip-describe-tab.js?v=10.0';
import { KIP_CLIPS, clipForProp, isPropClip, makeKipClip, plantBakedClip, limitHands } from '/kip/kip-clips.js?v=10.0';
import { findMixamoBones, retargetMixamoClipToKip as retargetMixamoClip } from '/kip/kip-mixamo-retarget.js?v=10.0';
import { bakedToClip, checkBaked } from '/kip/kip-baked-clips.js?v=10.0';
import { mountParty } from '/kip/kip-party.js?v=10.0';
import { createMySongs } from '/kip/kip-my-songs.js?v=10.0';   // a child's own theme songs, measured so Kip can dance to them
import { createKipSession } from '/kip/kip-session.js?v=10.0';
import { FACEPLATE_SEAT_MM } from '/kip/kip-faceplate-shape.js?v=10.0';
import { disposeThreeScene } from '/kip/bench-lifecycle.js?v=10.0';
import { BLUEPRINT } from '/kip/bench-look.js?v=10.0';

export const KIP_BENCH_CSS = `
:where(.kip-bench) {
  & {
    --ink: #1b2238;
    --muted: #5d657c;
    --spark: #ff6b4a;
    --mint: #1fa97c;
    --glass: rgba(255, 255, 255, 0.85);
    --line: rgba(27, 34, 56, 0.11);
  }
  & * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  & {
    position: relative;
    contain: layout; /* position: fixed UI sits in this box, not the window: the bench works inside a host's area */
    width: 100%;
    height: 100%;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: ${BLUEPRINT.gradient};
    color: var(--ink);
  }
  #viewport { position: fixed; inset: 0; }
  canvas { display: block; width: 100%; height: 100%; outline: none; }

  .topbar {
    position: fixed;
    top: 14px;
    left: 16px;
    right: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    pointer-events: none;
    z-index: 10;
  }
  .brand-pill, .hint-pill {
    pointer-events: auto;
    background: var(--glass);
    backdrop-filter: blur(12px);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 8px 13px;
    box-shadow: 0 6px 20px rgba(27, 34, 56, 0.06);
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .badge {
    background: var(--spark);
    color: #fff;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    padding: 4px 9px;
    border-radius: 999px;
    cursor: pointer;
    border: none;
  }
  .badge.snap-mode { background: var(--mint); }
  .back-link {
    text-decoration: none;
    color: var(--ink);
    font-size: 11.5px;
    font-weight: 750;
    padding: 4px 9px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.72);
  }
  .back-link:hover { background: #fff; }
  &.in-iframe .back-link { display: none; }
  .title { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; }
  .status { font-size: 12px; color: var(--muted); font-weight: 600; }
  .status b { color: var(--spark); }
  .hint-pill { font-size: 11.5px; color: var(--muted); font-weight: 600; flex-wrap: wrap; }
  kbd {
    background: rgba(27, 34, 56, 0.08);
    border: 1px solid rgba(27, 34, 56, 0.14);
    border-radius: 5px;
    padding: 1px 5px;
    font-family: inherit;
    font-size: 10.5px;
    font-weight: 700;
    color: var(--ink);
  }

  #version-pill {
    position: fixed;
    left: 14px;
    bottom: 8px;
    z-index: 65;
    pointer-events: none;
    background: rgba(27, 34, 56, 0.88);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0.02em;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 14px rgba(27, 34, 56, 0.18);
  }
  #version-pill .ver-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--spark);
    display: inline-block;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
  }
  .row-label {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--muted);
    min-width: 68px;
    padding-left: 3px;
  }
  button, .file-btn {
    appearance: none;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.76);
    color: var(--ink);
    font-size: 11.8px;
    font-weight: 650;
    padding: 5px 9.5px;
    border-radius: 9px;
    cursor: pointer;
    transition: all 0.12s ease;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  button:hover, .file-btn:hover {
    background: #fff;
    border-color: rgba(27, 34, 56, 0.25);
  }
  button.active {
    background: var(--ink);
    color: #fff;
    border-color: var(--ink);
  }
  button.spark-active {
    background: var(--spark);
    color: #fff;
    border-color: var(--spark);
  }
  button.mint-active {
    background: var(--mint);
    color: #fff;
    border-color: var(--mint);
  }
  #drop-overlay {
    position: fixed;
    inset: 16px;
    border: 3px dashed var(--spark);
    border-radius: 24px;
    background: rgba(255, 107, 74, 0.12);
    backdrop-filter: blur(4px);
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 800;
    color: var(--ink);
    z-index: 50;
    pointer-events: none;
  }
  &.dragging #drop-overlay { display: flex; }
  &.clean-ui .topbar, &.clean-ui .modal-backdrop, &.clean-ui #version-pill { display: none !important; }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(27, 34, 56, 0.34);
    backdrop-filter: blur(6px);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 40;
    padding: 18px;
  }
  .modal-backdrop.open { display: flex; }
  .modal-card {
    background: #fbf9f5;
    border: 1px solid rgba(27, 34, 56, 0.15);
    border-radius: 20px;
    box-shadow: 0 22px 56px rgba(27, 34, 56, 0.24);
    width: min(680px, 96vw);
    max-height: 88vh;
    overflow-y: auto;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    user-select: text;
  }
  .modal-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .modal-head h2 { font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
  .digital-tag {
    background: rgba(124, 77, 255, 0.14);
    color: #5b2ee8;
    border: 1px solid rgba(124, 77, 255, 0.32);
    font-size: 10.5px;
    font-weight: 800;
    padding: 3px 8px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .modal-sub { font-size: 12.5px; color: var(--muted); line-height: 1.45; }
  .code-pill {
    background: #20232a;
    color: #f4efe6;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px;
    padding: 9px 12px;
    border-radius: 10px;
    overflow-x: auto;
    white-space: pre-wrap;
  }
  .forge-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    align-items: center;
  }
  .forge-preview-box {
    background: #efebe2;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .forge-preview-box canvas, .forge-preview-box video {
    width: 148px;
    height: 148px;
    object-fit: contain;
    border-radius: 10px;
    background: #fff;
    border: 1px solid rgba(27,34,56,0.1);
  }
  select {
    appearance: none;
    border: 1px solid var(--line);
    background: #fff;
    color: var(--ink);
    font-size: 12px;
    font-weight: 700;
    padding: 5px 10px;
    border-radius: 9px;
    cursor: pointer;
  }
}
`;

export const KIP_BENCH_MARKUP = `
<div id="viewport"></div>
<div id="version-pill"><span class="ver-dot"></span><span id="version-label">Kip v10.1 · 4 Head Categories (Human · Robot · Animal · Creature) · 3 Universal Inserts · 19 Wigs · 7 Hats</span></div>
<div id="drop-overlay">Drop Custom PartSpec .stl or Mixamo .fbx/.glb onto Kip</div>

<div class="topbar">
  <div class="brand-pill">
    <a class="back-link" href="/" title="Back to ToyVentor App">← ToyVentor</a>
    <button class="badge" id="badge-edition" title="Click to toggle Pro (8+) vs Snap (3+)">Pro 8+ Rig</button>
    <span class="title" id="scene-title">Kip — Wardrobe, Modular TU Vehicles &amp; PartSpec SDK</span>
    <span class="status" id="status-text">Loading Kip, Wardrobe &amp; TU Vehicles…</span>
  </div>
  <div class="hint-pill">
    <span><kbd>WASD</kbd>/<kbd>Arrows</kbd> Move/Drive</span>
    <span><kbd>Shift</kbd> Boost</span>
    <span><kbd>Space</kbd> Hop</span>
    <span><kbd>E</kbd> Explode</span>
    <span><kbd>B</kbd> Pile→Build</span>
    <span><kbd>H</kbd> Hide UI</span>
  </div>
</div>

<!-- PHASE 3 MODAL: CONFORMING LLM PART-MAKER SDK -->
<div class="modal-backdrop" id="modal-llm">
  <div class="modal-card">
    <div class="modal-head">
      <h2>🤖 Conforming LLM Part-Maker SDK (PartSpec v2)</h2>
      <button id="btn-close-llm">✕ Close</button>
    </div>
    <p class="modal-sub">
      Any LLM can author 100% support-free, lattice-verified ToyVentor parts using <code>kip_partspec_sdk.py</code> (<code>crown_addon</code>, <code>character_head</code>, <code>backpack_addon</code>, <code>handheld_prop</code>, <code>vehicle_addon</code>) and validate them through <code>toyventor_parts.evaluate()</code> + <code>toyventor_assembly.validate()</code>.
    </p>
    <div class="row">
      <button id="btn-copy-prompt" class="spark-active">📋 Copy 1-Page LLM Authoring Prompt</button>
      <span class="status" id="llm-copy-status">Validate locally: <code>npm run kip:validate-part -- my_part.py</code></span>
    </div>
    <div class="code-pill">from kip_partspec_sdk import *
def build():
    return crown_addon(loft_slabs([(0,23.6,11.6,4.8), (7,28,17.2,6.5,0,-1.5), (23.5,6.2,6.2,2.8,1.8,1.2)]))
PART = part_spec(id="custom_wizard_hat", name="Starlight Wizard Hat", stat="Glow", behavior="...", slot="crown", fn=build)
if __name__ == "__main__": run_cli(PART)</div>
    <div class="row">
      <span class="row-label">SDK Demos</span>
      <button id="btn-ex-hat">🧙 Equip Verified Wizard Hat (Crown)</button>
      <button id="btn-ex-wand">⭐ Equip Verified Star Wand (Hand)</button>
      <button id="btn-ex-hood">🏎️ Equip Verified Hood Crest (Car)</button>
    </div>
    <div class="row">
      <span class="row-label">Drop .STL</span>
      <select id="sel-llm-slot">
        <option value="crown">Mount on: Crown (2×1)</option>
        <option value="hand">Mount on: Right Hand (Ø6.6)</option>
        <option value="back">Mount on: Back Dock (2×2)</option>
        <option value="head">Mount on: Neck Turret (2×1 Head)</option>
        <option value="hood">Mount on: Roadster Car Hood (2×2)</option>
      </select>
      <input type="color" id="col-llm-stl" value="#7c4dff" title="Part color" style="width:32px;height:28px;border:none;background:none;cursor:pointer;" />
      <label class="file-btn spark-active">
        📂 Load Custom .STL
        <input type="file" id="llm-stl-input" accept=".stl" hidden />
      </label>
      <button id="btn-clear-custom">Clear Custom</button>
    </div>
  </div>
</div>

<!-- PHASE 4 MODAL: PHOTO-TO-ACCESSORY FORGE (DIGITAL ONLY, prints: false) -->
<div class="modal-backdrop" id="modal-photo">
  <div class="modal-card">
    <div class="modal-head">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <h2>📸 Photo-to-Accessory Forge</h2>
        <span class="digital-tag">Digital-Only · prints: false</span>
      </div>
      <button id="btn-close-photo">✕ Close</button>
    </div>
    <p class="modal-sub">
      Snap a webcam picture or upload a kid's drawing on paper! Instant corner-flood segmentation + Marching-Squares contour + beveled UV-textured 3D extrusion turns it into a playable accessory for Kip (strictly digital <code>prints: false</code>).
    </p>
    <div class="row">
      <span class="row-label">Kid Sketches</span>
      <button id="btn-kid-sword" class="spark-active">🗡️ Cardboard Spark Sword</button>
      <button id="btn-kid-wings">🦋 Rainbow Sketch Wings</button>
      <button id="btn-kid-crest">⚡ Lightning Crown Crest</button>
    </div>
    <div class="row">
      <span class="row-label">Capture</span>
      <label class="file-btn">
        🖼️ Upload Image / Drawing
        <input type="file" id="photo-file-input" accept="image/*" hidden />
      </label>
      <button id="btn-cam-start">📷 Live Webcam</button>
      <button id="btn-cam-snap" style="display:none;" class="spark-active">🔴 Snap Photo!</button>
      <button id="btn-sam-scan" title="Try optional /api/scan SAM 3.1 segmentation endpoint">✨ SAM 3.1 (/api/scan)</button>
    </div>
    <div class="forge-grid">
      <div class="forge-preview-box">
        <span class="status">Source Drawing / Webcam</span>
        <canvas id="photo-src-canvas" width="256" height="256"></canvas>
        <video id="photo-webcam" autoplay playsinline muted style="display:none;"></video>
      </div>
      <div class="forge-preview-box">
        <span class="status" id="photo-seg-label">Segmented Cutout Mask</span>
        <canvas id="photo-mask-canvas" width="96" height="96"></canvas>
      </div>
    </div>
    <div class="row">
      <span class="slider-pill">
        <span>BG Cutoff</span>
        <input type="range" id="rng-photo-thr" min="10" max="90" value="38" />
      </span>
      <span class="slider-pill">
        <span>Depth</span>
        <input type="range" id="rng-photo-depth" min="3" max="10" value="5" />
      </span>
      <select id="sel-photo-slot">
        <option value="hand">Equip: Right Hand Grip</option>
        <option value="wings">Equip: Flapping Back Wings</option>
        <option value="crown">Equip: Crown Topper</option>
        <option value="hood">Equip: Roadster Car Hood</option>
      </select>
      <button id="btn-equip-photo" class="mint-active">⚡ Equip on Kip!</button>
      <button id="btn-sync-hash" title="Write updated ToyContract (#toy=..., prints: false) into URL hash">🔗 Sync #toy= Hash</button>
      <button id="btn-print-photo" title="Turn a photo of something Kip can hold into a plate to print and a sticker with your photo on it">🖨️ Print it…</button>
    </div>
    <div class="status" id="photo-forge-status">Ready — pick a Kid Sketch, upload an image, or snap from Webcam!</div>
  </div>
</div>
`;

/**
 * Mount the bench into `host` (an element the caller owns). Everything below the signature is the body of the old
 * page script, moved here unchanged except for the host seams listed in docs/specs/workshop-spec.md (stage 4a):
 * lookups go through `$el` / `benchRoot` instead of `document`, listeners through `listen` (so dispose can remove them),
 * the URL through `getSearch` / `getHash` / `replaceHash`, published handles through `globals`.
 * `env` (all optional): { getSearch, getHash, replaceHash, embedded, globals }.
 * Returns { root, ready, dispose }; `ready` settles when the first load is done.
 */
export function mountKipBench(host, env = {}) {
const getSearch = env.getSearch ?? (() => location.search);
const getHash = env.getHash ?? (() => location.hash);
const replaceHash = env.replaceHash ?? ((h) => history.replaceState(null, '', h));
const embedded = env.embedded ?? (window.self !== window.top);
const globals = env.globals ?? window;

const benchRoot = document.createElement('div');
benchRoot.className = 'kip-bench';
benchRoot.innerHTML = KIP_BENCH_MARKUP;
host.append(benchRoot);
let styleEl = document.getElementById('kip-bench-css');
const ownsStyle = !styleEl;
if (ownsStyle) {
  styleEl = document.createElement('style');
  styleEl.id = 'kip-bench-css';
  styleEl.textContent = KIP_BENCH_CSS;
  document.head.append(styleEl);
}
const $el = (id) => benchRoot.querySelector('#' + id);
const offs = [];
const stage = env.stage ?? null; // a host's shared renderer, camera and controls (Workshop stage 4b, bench-stage.js); null: this bench builds its own
const hosted = stage !== null;
const kipSession = env.sharedKip ?? createKipSession({ THREE, STLLoader, mergeVertices, toCreasedNormals });
kipSession.acquire('kip');
const printOn = env.features?.downloads !== false; // false: this bench hands no file out (Print group, photo "Print it", selfie sticker): see workshop.js `downloads`
// Under 'gated' the shell hands this bench its grown-up check (`askGrownUp`) and its one parent-gate client (`cloud`, so the selfie's Smart face and its sticker share one proof).
// The Print group asks through the print view; the selfie sticker asks before it saves; the photo "Print it" needs a real grown-up proof before anything is made (kip-photo-print.js,
// its own check). Make-from-words files have their own exit and stay hidden under 'gated' until it is gated too.
const askGrownUp = env.features?.askGrownUp ?? null;
const downloadsOn = printOn && (!env.features?.gated || askGrownUp !== null); // the photo "Print it" and the selfie sticker
const forgeFilesOn = printOn && !env.features?.gated; // Make-from-words files
let unregisterKipSync = null;
let unregisterKipPrintState = null;
let active = !hosted; // a hosted bench draws and reads input only while the host has it active
let started = !hosted; // hosted: the stage ticks this bench from the moment it is active, but the rig is not built until init() has run (set below)
const listen = (target, type, fn, opts) => {
  const h = (e) => { if (active) fn(e); };
  target.addEventListener(type, h, opts);
  offs.push(() => target.removeEventListener(type, h, opts));
};
let raf = 0;
let disposed = false;

if (embedded) benchRoot.classList.add('in-iframe');

function decodeHashToyContract() {
  const m = getHash().match(/(?:^#|&)toy=([^&]+)/);
  if (!m) return null;
  try {
    const padded = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    return (obj && obj.format === 'toyventor.toy/1') ? obj : null;
  } catch {
    return null;
  }
}

const params = new URLSearchParams(getSearch());
if (params.get('clean') === '1') benchRoot.classList.add('clean-ui');

const statusEl = $el('status-text');
const vp = $el('viewport');

// --- 1. MINIMAL THREE.JS STUDIO SCENE ---
const renderer = hosted ? stage.renderer : new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
if (!hosted) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  vp.appendChild(renderer.domElement);
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(BLUEPRINT.fog, 0.00050);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = hosted ? stage.camera : new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 5, 4000);
const controls = hosted ? stage.controls : new OrbitControls(camera, renderer.domElement);
// This bench's look on the (possibly shared) renderer, camera and controls. Standalone it runs once, now; hosted it runs again each time
// the stage activates the bench, from the pose the bench was left in (camPose is saved when it stands down).
const camPose = { position: new THREE.Vector3(175, 162, 415), target: new THREE.Vector3(0, 68, 0) };
function applyLook() {
  renderer.toneMappingExposure = 0.92;
  camera.fov = 34; camera.near = 5; camera.far = 4000;
  camera.position.copy(camPose.position);
  camera.updateProjectionMatrix();
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.copy(camPose.target);
  controls.minDistance = 85;
  controls.maxDistance = 1600;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI * 0.495;
}
applyLook();

// Studio Lighting
scene.add(new THREE.HemisphereLight(0xfffcf5, 0xb8ae9e, 0.52));

const keyLight = new THREE.DirectionalLight(0xfff9ee, 1.65);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -320;
keyLight.shadow.camera.right = 320;
keyLight.shadow.camera.top = 320;
keyLight.shadow.camera.bottom = -320;
keyLight.shadow.camera.near = 40;
keyLight.shadow.camera.far = 1000;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.35;
scene.add(keyLight);
scene.add(keyLight.target);

const rimLight = new THREE.DirectionalLight(0xfff6eb, 0.85);
rimLight.position.set(-220, 195, -220);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0xffece0, 0.34);
fillLight.position.set(-160, 95, 180);
scene.add(fillLight);

// Seamless Infinite 12.5 mm TU Lattice Floor Grid + Contact Shadow Receiver
const floorShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(8000, 8000),
  new THREE.ShadowMaterial({ opacity: BLUEPRINT.shadowOpacity })
);
floorShadow.rotation.x = -Math.PI / 2;
floorShadow.receiveShadow = true;
scene.add(floorShadow);

const minorGrid = new THREE.GridHelper(2000, 80, BLUEPRINT.gridFine, BLUEPRINT.gridFine);
minorGrid.position.y = 0.1;
minorGrid.material.transparent = true;
minorGrid.material.opacity = 0.55;
scene.add(minorGrid);

const majorGrid = new THREE.GridHelper(2000, 20, BLUEPRINT.gridCentre, BLUEPRINT.gridMajor);
majorGrid.position.y = 0.2;
majorGrid.material.transparent = true;
majorGrid.material.opacity = 0.45;
scene.add(majorGrid);

const originRing = new THREE.Mesh(
  new THREE.RingGeometry(48, 50, 64),
  new THREE.MeshBasicMaterial({ color: BLUEPRINT.ring, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
);
originRing.rotation.x = -Math.PI / 2;
originRing.position.y = 0.3;
scene.add(originRing);

// Dashed Coral Spark assembly guide lines for Exploded View
const explodeLineGeo = new THREE.BufferGeometry();
const explodeLinePositions = new Float32Array(128 * 6);
explodeLineGeo.setAttribute('position', new THREE.BufferAttribute(explodeLinePositions, 3));
const explodeLines = new THREE.LineSegments(
  explodeLineGeo,
  new THREE.LineDashedMaterial({ color: 0xff6b4a, dashSize: 4.5, gapSize: 3.5, transparent: true, opacity: 0.65 })
);
explodeLines.visible = false;
explodeLines.frustumCulled = false;
scene.add(explodeLines);

// --- 2. LOAD KIP PARAMETRIC STLs (PRO 8+ & SNAP 4-8) + PARTSPEC UPGRADES ---
const stlLoader = new STLLoader();
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

// Rig helpers come from the shared Kip session (kip-session.js -> kip-rig.js), shared with Truck-Mockup.html.
const { scadMesh, mats } = kipSession.K;

// Build Kip with leaf partSlots so Pro (8+), Snap (4-8), Exploded View, and Tabletop Pile->Build all share one rig!

// Compute collision-free tabletop Part Pile layout for all active visible partSlots!
const CARDINAL_ROTATIONS = [
  new THREE.Euler(0, 0, 0),
  new THREE.Euler(Math.PI / 2, 0, 0),
  new THREE.Euler(-Math.PI / 2, 0, 0),
  new THREE.Euler(0, 0, Math.PI / 2),
  new THREE.Euler(0, 0, -Math.PI / 2),
  new THREE.Euler(Math.PI, 0, 0),
];

function slotIsEffectivelyVisible(slot) {
  let cur = slot.grp;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  // Also verify at least one visible Mesh inside!
  let hasVisMesh = false;
  slot.grp.traverse(o => { if (o.isMesh && o.visible) hasVisMesh = true; });
  return hasVisMesh;
}

function layoutPartPile(kipRig, edition) {
  // Ensure clean upright standing pose at origin while measuring rest & pile bounds
  const savedMoverPos = kipRig.mover.position.clone();
  const savedMoverRot = kipRig.mover.rotation.y;
  kipRig.mover.position.set(0, 0, 0);
  kipRig.mover.rotation.y = 0;

  for (const s of kipRig.partSlots) {
    s.grp.position.set(0, 0, 0);
    s.grp.quaternion.identity();
  }
  kipRig.mover.updateMatrixWorld(true);

  const active = kipRig.partSlots.filter(s =>
    (s.edition === 'both' || s.edition === edition) && slotIsEffectivelyVisible(s)
  );

  // Sort by assembly waveOrder so inner/earlier parts sit slightly closer and fly up in crisp waves!
  active.sort((a, b) => a.waveOrder - b.waveOrder);

  const probeScene = new THREE.Group();
  const box = new THREE.Box3();
  const yawQ = new THREE.Quaternion();
  const candQ = new THREE.Quaternion();
  const bestQ = new THREE.Quaternion();

  active.forEach((s, idx) => {
    // Pick the flattest stable tabletop orientation + deterministic natural yaw
    const clone = s.grp.clone(true);
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    probeScene.add(clone);
    clone.updateMatrixWorld(true);
    box.setFromObject(clone);
    if (!box.isEmpty()) box.getCenter(s.localCentroid);
    else s.localCentroid.set(0, 0, 0);

    const yaw = (idx * 2.399963) % (Math.PI * 2); // golden-angle yaw variety
    yawQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);

    let minHeight = Infinity;
    let bestBox = new THREE.Box3();
    for (const er of CARDINAL_ROTATIONS) {
      candQ.setFromEuler(er).premultiply(yawQ);
      clone.quaternion.copy(candQ);
      clone.updateMatrixWorld(true);
      box.setFromObject(clone);
      if (box.isEmpty()) continue;
      const h = box.max.y - box.min.y;
      if (h < minHeight - 0.2) {
        minHeight = h;
        bestQ.copy(candQ);
        bestBox.copy(box);
      }
    }
    probeScene.remove(clone);

    const cx = (bestBox.min.x + bestBox.max.x) * 0.5;
    const cz = (bestBox.min.z + bestBox.max.z) * 0.5;
    const rx = (bestBox.max.x - bestBox.min.x) * 0.5;
    const rz = (bestBox.max.z - bestBox.min.z) * 0.5;
    s.horizRadius = Math.max(8.5, Math.hypot(rx, rz));

    // Initial spiral ring outside Kip's central landing pad (compact symmetric tabletop spread!)
    const angle = idx * 2.399963 + 0.4;
    const rad = 46 + Math.sqrt(idx) * 17.5;
    s._px = Math.cos(angle) * rad * 1.12;
    s._pz = Math.sin(angle) * rad * 0.86;
    s._localCenterOffset = new THREE.Vector2(cx, cz);
    s._groundLiftY = -bestBox.min.y + 0.25;
    s.pileQuat.copy(bestQ);
  });

  // 2D circle-packing relaxation so ZERO parts touch or overlap on the tabletop, keeping center pad clear!
  for (let iter = 0; iter < 55; iter++) {
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      // Keep central landing ring (r = 36 mm around origin) clear for Kip's sneakers to assemble!
      const d0 = Math.hypot(a._px, a._pz);
      const minCenterClear = 36 + a.horizRadius;
      if (d0 < minCenterClear) {
        const nx = d0 > 1e-3 ? a._px / d0 : 1;
        const nz = d0 > 1e-3 ? a._pz / d0 : 0;
        a._px = nx * minCenterClear;
        a._pz = nz * minCenterClear;
      }
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        const dx = b._px - a._px;
        const dz = b._pz - a._pz;
        const dist = Math.hypot(dx, dz);
        const minDist = a.horizRadius + b.horizRadius + 3.2;
        if (dist < minDist) {
          const push = (minDist - dist) * 0.52;
          const ux = dist > 1e-3 ? dx / dist : Math.cos(i + j);
          const uz = dist > 1e-3 ? dz / dist : Math.sin(i + j);
          a._px -= ux * push; a._pz -= uz * push;
          b._px += ux * push; b._pz += uz * push;
        }
      }
    }
  }

  // Finalize world pile positions & staggered build choreography windows (total build ~ 3.85s)
  const n = Math.max(1, active.length);
  active.forEach((s, idx) => {
    s.pilePos.set(
      savedMoverPos.x + s._px - s._localCenterOffset.x,
      s._groundLiftY,
      savedMoverPos.z + s._pz - s._localCenterOffset.y
    );
    s.pileCentroid.copy(s.localCentroid).applyQuaternion(s.pileQuat).add(s.pilePos);
    // Stagger start times cleanly across 0.35s .. 3.15s by waveOrder + index
    const frac = idx / Math.max(1, n - 1);
    s.t0 = 0.35 + frac * 2.75;
    s.dur = 0.62;
    s.arcExtra = 18 + (s.waveOrder * 7);
  });

  kipRig.mover.position.copy(savedMoverPos);
  kipRig.mover.rotation.y = savedMoverRot;
}

// --- 3. MIXAMO -> KIP RETARGETER: the code lives in kip-mixamo-retarget.js (pure, so scripts/mixamo-bake.mjs runs the same one); this wrapper binds THREE ---
const retargetMixamoClipToKip = (clip, sourceRoot, opts) => retargetMixamoClip(THREE, clip, sourceRoot, opts);

// Upgraded Kip ToyVentor Signature Wave (open 3-finger + thumb palm facing forward +Z!)
function makeHeroWaveClip() {
  const dur = 2.0, steps = 61, times = new Float32Array(steps);
  const tracks = [];
  const d2r = THREE.MathUtils.degToRad;
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  const names = ['Hips','Head','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot'];
  const bufs = Object.fromEntries(names.map(n => [n, new Float32Array(steps * 4)]));
  const pBuf = new Float32Array(steps * 3);

  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * dur;
    const ph = (t / dur) * Math.PI * 2;
    times[i] = t;

    pBuf[i * 3 + 0] = Math.sin(ph) * 1.4;
    pBuf[i * 3 + 1] = 61.5 + Math.abs(Math.sin(ph)) * 1.8;
    pBuf[i * 3 + 2] = 0;

    const setQ = (nm, rx, ry, rz, order = 'ZYX') => {
      q.setFromEuler(e.set(d2r(rx), d2r(ry), d2r(rz), order));
      const b = bufs[nm];
      if (i > 0 && (b[(i-1)*4]*q.x + b[(i-1)*4+1]*q.y + b[(i-1)*4+2]*q.z + b[(i-1)*4+3]*q.w) < 0) {
        q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w;
      }
      b[i*4] = q.x; b[i*4+1] = q.y; b[i*4+2] = q.z; b[i*4+3] = q.w;
    };

    const wave = Math.sin(ph * 2);
    const wristFollow = Math.sin(ph * 2 - 0.45);

    setQ('Hips', -2, Math.sin(ph) * 3.5, Math.sin(ph) * 2.2);
    setQ('Head', -6 + Math.sin(ph) * 2.5, 6, 8 + Math.sin(ph) * 3.5);

    setQ('LeftArm', -6, 8, 16 + Math.sin(ph) * 3);
    setQ('LeftForeArm', -16, 12, 6);
    setQ('LeftHand', 0, 0, -6);

    setQ('RightArm', -18, 0, -98 + wave * 6);
    setQ('RightForeArm', 0, -94, -58 + wave * 18);
    setQ('RightHand', -wristFollow * 15, 0, -4);

    setQ('LeftUpLeg', 2, 4, 4);    setQ('LeftLeg', 0, 0, 0);  setQ('LeftFoot', 0, 0, -6.2);
    setQ('RightUpLeg', 2, -4, -4); setQ('RightLeg', 0, 0, 0); setQ('RightFoot', 0, 0, 1.8);
  }
  tracks.push(new THREE.VectorKeyframeTrack('kip_Hips.position', times, pBuf));
  for (const n of names) tracks.push(new THREE.QuaternionKeyframeTrack(`kip_${n}.quaternion`, times, bufs[n]));
  return new THREE.AnimationClip('HeroWave', dur, tracks);
}

// Expressive Sad Slump & Sigh Clip
function makeSadClip() {
  const dur = 3.2, steps = 97, times = new Float32Array(steps);
  const tracks = [];
  const d2r = THREE.MathUtils.degToRad;
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  const names = ['Hips','Head','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot'];
  const bufs = Object.fromEntries(names.map(n => [n, new Float32Array(steps * 4)]));
  const pBuf = new Float32Array(steps * 3);

  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * dur;
    const ph = (t / dur) * Math.PI * 2;
    const sigh = 0.5 - 0.5 * Math.cos(ph);
    const sway = Math.sin(ph);
    times[i] = t;

    pBuf[i * 3 + 0] = sway * 1.2;
    pBuf[i * 3 + 1] = 59.0 - sigh * 2.2;
    pBuf[i * 3 + 2] = 1.4 + sigh * 1.0;

    const setQ = (nm, rx, ry, rz, order = 'ZYX') => {
      q.setFromEuler(e.set(d2r(rx), d2r(ry), d2r(rz), order));
      const b = bufs[nm];
      if (i > 0 && (b[(i-1)*4]*q.x + b[(i-1)*4+1]*q.y + b[(i-1)*4+2]*q.z + b[(i-1)*4+3]*q.w) < 0) {
        q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w;
      }
      b[i*4] = q.x; b[i*4+1] = q.y; b[i*4+2] = q.z; b[i*4+3] = q.w;
    };

    const hipPitch = 13 + sigh * 3.5;
    setQ('Hips', hipPitch, sway * 2.0, sway * 1.8);
    setQ('Head', 24 + sigh * 4.5, Math.sin(ph) * 11.5, 6.5 + Math.cos(ph) * 3.0);

    setQ('LeftArm', -22 - sigh * 3, 18, 8);
    setQ('LeftForeArm', -18 - sigh * 4, 10, -5);
    setQ('LeftHand', -6, 0, -10);

    setQ('RightArm', -22 - sigh * 3, -18, -8);
    setQ('RightForeArm', -18 - sigh * 4, -10, 5);
    setQ('RightHand', -6, 0, 10);

    const upLegPitch = -(hipPitch + 11);
    setQ('LeftUpLeg',  upLegPitch, -10,  3); setQ('LeftLeg',  20, 0, 0); setQ('LeftFoot', -9, 0, -3);
    setQ('RightUpLeg', upLegPitch,  10, -3); setQ('RightLeg', 20, 0, 0); setQ('RightFoot', -9, 0, 3);
  }
  tracks.push(new THREE.VectorKeyframeTrack('kip_Hips.position', times, pBuf));
  for (const n of names) tracks.push(new THREE.QuaternionKeyframeTrack(`kip_${n}.quaternion`, times, bufs[n]));
  return new THREE.AnimationClip('sad_pose', dur, tracks);
}

// Expressive Sneaky Tiptoe Prowl Clip (replaces Xbot.glb's 1-frame additive sneak_pose!)
// Deep sneaky crouch, peering forward while glancing cautiously left & right, sneaky raised cartoon paws,
// and high-knee pointed-toe sneak steps with level stance sweep for zero-slip floor pinning!
function makeSneakClip() {
  const dur = 1.9, steps = 61, times = new Float32Array(steps);
  const tracks = [];
  const d2r = THREE.MathUtils.degToRad;
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  const names = ['Hips','Head','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot'];
  const bufs = Object.fromEntries(names.map(n => [n, new Float32Array(steps * 4)]));
  const pBuf = new Float32Array(steps * 3);

  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * dur;
    const ph = (t / dur) * Math.PI * 2;
    times[i] = t;

    pBuf[i * 3 + 0] = Math.sin(ph) * 2.4;
    pBuf[i * 3 + 1] = 51.5 + Math.abs(Math.cos(ph)) * 3.2;
    pBuf[i * 3 + 2] = 0;

    const setQ = (nm, rx, ry, rz, order = 'ZYX') => {
      q.setFromEuler(e.set(d2r(rx), d2r(ry), d2r(rz), order));
      const b = bufs[nm];
      if (i > 0 && (b[(i-1)*4]*q.x + b[(i-1)*4+1]*q.y + b[(i-1)*4+2]*q.z + b[(i-1)*4+3]*q.w) < 0) {
        q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w;
      }
      b[i*4] = q.x; b[i*4+1] = q.y; b[i*4+2] = q.z; b[i*4+3] = q.w;
    };

    const hipPitch = 21;
    setQ('Hips', hipPitch, Math.sin(ph) * 9, Math.cos(ph) * 2.5);
    // Peer forward mischievously while scanning left & right!
    setQ('Head', -15, Math.sin(ph) * 23, Math.cos(ph) * 5.5);

    // Sneaky tiptoe cartoon paws in front of chest!
    setQ('LeftArm',  -48 + Math.sin(ph) * 10,  18,  26);
    setQ('LeftForeArm', -60,  20, 8);
    setQ('LeftHand', 22 + Math.cos(ph) * 10, 0, -18);

    setQ('RightArm', -48 - Math.sin(ph) * 10, -18, -26);
    setQ('RightForeArm', -60, -20, -8);
    setQ('RightHand', 22 - Math.cos(ph) * 10, 0, 18);

    // Alternating high-knee tiptoe stride:
    // phase: cos > 0 is lifted forward swing; cos <= 0 is planted backward stance sweep!
    for (const [tag, side, legPh] of [['Left', 1, ph], ['Right', -1, ph + Math.PI]]) {
      const s = Math.sin(legPh);
      const lift = Math.max(0, Math.cos(legPh));
      const upRx = -hipPitch - 24 * s - 28 * lift;
      const knRx = 26 + 38 * lift - 6 * s;
      // Level sole during stance (upRx + hipPitch + knRx + ftRx = 0), pointed toe (+26 deg) during lifted swing!
      const ftRx = -(hipPitch + upRx + knRx) + 26 * lift;
      setQ(`${tag}UpLeg`, upRx, 0, side * 3);
      setQ(`${tag}Leg`,   knRx, 0, 0);
      setQ(`${tag}Foot`,  ftRx, 0, -side * 3);
    }
  }
  tracks.push(new THREE.VectorKeyframeTrack('kip_Hips.position', times, pBuf));
  for (const n of names) tracks.push(new THREE.QuaternionKeyframeTrack(`kip_${n}.quaternion`, times, bufs[n]));
  return new THREE.AnimationClip('sneak_pose', dur, tracks);
}

// --- 4. BOOTSTRAP EVERYTHING ---

let kip = null;
let kipMixer = null;
const actions = new Map();
let activeClipName = null;
// Dance party (kip-party.js): the clips that carry a tempo, and the party itself once mounted. `partyApi` is declared here so the frame loop can ask it
// safely before the mount below has run.
const danceTempos = [];
// Clips whose feet are already solved onto the floor (every kip-clips.js clip, and each baked clip the bake tool planted): the grounder must not re-centre the body over them
// frame by frame (see pinAndGroundKipFeet), or it drags the planted foot across the floor.
const plantedClips = new Set();
let partyApi = null;
let partyCrownBefore = null;

let refSkeletonGroup = null;
let refMixer = null;
const refActions = new Map();

const LOCO_CLIPS = new Set(['walk', 'run', 'sneak_pose']);
const keys = new Set();

const loco = {
  edition: 'pro',      // 'pro' (8+) | 'snap' (3+)
  category: 'human',   // 'human' | 'robot' | 'animal' | 'creature'
  head: 'kid',         // human: 'kid' | 'chibi' | 'tall' | 'jumbo' · robot: 'robot' | 'scout' · animal: 'fox' | 'bear' | 'cat' · creature: 'dragon' | 'alien' | 'imp' · 'custom'
  skin: 'warm_peach',
  hairColor: 'chestnut',
  hatColor: 'cobalt_cap',
  shirt: 'off',
  pants: 'off',
  hair: 'off',         // 'off' | 8 Hat-Ready wigs + 11 Sculpted-Top wigs
  faceInsert: 'sculpted', // 'sculpted' (3D Nose & Orbitals) | 'vinyl' (3D Button Eyes & Nose) | 'flat' (Smooth Printed Decal)
  expr: 'spark',       // 'spark' | 'button' | 'happy' | 'wink' | 'cool' | 'starry' | 'surprised' | 'blank'
  hat: 'buds',         // 'buds' | 7 wearable hats ('ballcap'..'pirate') | 'hat' | 'ears' | 'horns' | 'blank' | 'wizardHat' | 'custom'
  crown: 'buds',       // synced alias of `hat` for #toy= contract compatibility
  back: 'off',
  prop: 'off',         // 'off' | 'wrench' | 'shield' | 'shaft' | 'skateboard' | 'wand' | 'custom'
  vehicle: 'none',     // 'none' | 'car' | 'truck' | 'scooter' | 'moto'
  vehCovers: true,
  racerKit: true,
  hasPhotoAccessory: false,
  photoWingGroup: null,
  driveSpeed: 0,
  steerAngle: 0,
  vel: new THREE.Vector3(),
  heading: 0,
  jumpY: 0,
  jumpVel: 0,
  manualOverride: false,
  speedScale: 1.0,
  animClock: 0,
  // Zero-slip stance-foot pinning state
  stanceIdx: 0,
  prevStanceIdx: -1,
  prevStanceLocal: new THREE.Vector3(),
  hasPrevStance: false,
  // Exploded View & Tabletop Pile -> Build state
  explodeTarget: 0,
  explodeAmount: 0,
  buildMode: 'assembled', // 'assembled' | 'pile' | 'building'
  buildTime: 0,
  buildTotalDur: 3.95,
};

function resolveClipKey(name) {
  if (name === 'sad') return 'sad_pose';
  if (name === 'sneak') return 'sneak_pose';
  if (name === 'wave') return 'HeroWave';
  if (name === 'sit' || name === 'drive') return 'drive_sit';
  if (name === 'scooter') return 'scooter_ride';
  if (name === 'moto') return 'moto_straddle';
  if (name === 'skate') return 'skate_cruise';
  return name;
}

const NICE_CLIP_LABELS = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  HeroWave: 'Hero Wave',
  sad_pose: 'Sad',
  sneak_pose: 'Sneak',
  agree: 'Agree (Nod)',
  headShake: 'Head Shake',
  SambaDance: 'Samba Dance',
  TPose: 'T-Pose',
  drive_sit: 'Sit & Drive',
  scooter_ride: 'Scooter Ride',
  moto_straddle: 'Moto Straddle',
  skate_cruise: 'Skate Cruise',
};

function playClip(rawName, fadeSec = 0.22) {
  const name = resolveClipKey(rawName);
  if (!actions.has(name) || activeClipName === name) return;
  const next = actions.get(name);
  next.reset().setEffectiveTimeScale(loco.speedScale).setEffectiveWeight(1).play();
  if (activeClipName && actions.has(activeClipName)) {
    actions.get(activeClipName).crossFadeTo(next, fadeSec, false);
  }
  if (refActions.has(name)) {
    const rNext = refActions.get(name);
    rNext.reset().setEffectiveTimeScale(loco.speedScale).setEffectiveWeight(1).play();
    if (activeClipName && refActions.has(activeClipName)) {
      refActions.get(activeClipName).crossFadeTo(rNext, fadeSec, false);
    }
  }
  activeClipName = name;
  loco.hasPrevStance = false; // re-anchor stance foot cleanly on clip change
  updateStatusText();
}

function updateStatusText() {
  syncHouseholdChip();
  syncForgeStorage();
  const edTag = loco.edition === 'pro' ? 'Pro 8+' : 'Snap 3+';
  const vehObj = VEHICLE_OPTIONS.find(v => v.id === loco.vehicle);
  const vehTag = loco.vehicle !== 'none' ? ` · ${vehObj ? vehObj.label : loco.vehicle}` : '';
  const digTag = loco.hasPhotoAccessory ? ' · <span style="color:#5b2ee8">prints:false</span>' : '';
  if (loco.buildMode === 'pile') {
    statusEl.innerHTML = `${edTag}${vehTag} · <b>Tabletop Part Pile</b>${digTag}`;
  } else if (loco.buildMode === 'building') {
    statusEl.innerHTML = `${edTag}${vehTag} · <b>Snapping Together…</b>${digTag}`;
  } else if (loco.explodeTarget > 0.02 || loco.explodeAmount > 0.02) {
    statusEl.innerHTML = `${edTag}${vehTag} · <b>Exploded (${Math.round(loco.explodeAmount * 100)}%)</b>${digTag}`;
  } else {
    const lbl = NICE_CLIP_LABELS[activeClipName] || (clipChoices.find(c => c.id === activeClipName) || {}).label || activeClipName || 'Idle';
    statusEl.innerHTML = `${edTag}${vehTag} · <b>${lbl}</b>${digTag}`;
  }
}

// One entry per playable clip; the side menu's Clip select lists these.
const clipChoices = [];
function triggerClip(name) {
  if (loco.buildMode !== 'assembled') exitPileMode();
  loco.manualOverride = (name !== 'idle');
  playClip(name);
}
function registerClip(name, label) {
  clipChoices.push({ id: name, label });
}

// Camera helper for deterministic framing.
function applyCameraPreset(presetName) {
  const cx = kip ? kip.mover.position.x : 0;
  const cz = kip ? kip.mover.position.z : 0;
  if (presetName === 'front') {
    camera.position.set(cx, 134, cz + 410); controls.target.set(cx, 88, cz);
  } else if (presetName === 'wave') {
    camera.position.set(cx - 42, 126, cz + 305); controls.target.set(cx - 8, 90, cz);
  } else if (presetName === 'back34') {
    camera.position.set(cx - 225, 162, cz - 265); controls.target.set(cx, 80, cz - 10);
  } else if (presetName === 'side34') {
    camera.position.set(cx - 245, 145, cz + 205); controls.target.set(cx, 76, cz - 4);
  } else if (presetName === 'vehicle') {
    camera.position.set(cx + 255, 165, cz + 320); controls.target.set(cx, 54, cz - 6);
  } else if (presetName === 'exploded') {
    camera.position.set(cx + 245, 240, cz + 655); controls.target.set(cx, 108, cz);
  } else if (presetName === 'head_exploded') {
    camera.position.set(cx - 175, 248, cz + 445); controls.target.set(cx, 184, cz + 6);
  } else if (presetName === 'head_front') {
    camera.position.set(cx, 136, cz + 188); controls.target.set(cx, 120, cz + 2);
  } else if (presetName === 'head_close') {
    camera.position.set(cx - 52, 146, cz + 188); controls.target.set(cx, 118, cz + 2);
  } else if (presetName === 'head_hat') {
    camera.position.set(cx - 48, 168, cz + 224); controls.target.set(cx, 132, cz + 2);
  } else if (presetName === 'head_side34') {
    camera.position.set(cx - 146, 146, cz + 132); controls.target.set(cx, 120, cz);
  } else if (presetName === 'head_profile') {
    camera.position.set(cx - 192, 132, cz + 18); controls.target.set(cx, 120, cz - 2);
  } else if (presetName === 'head_back34') {
    camera.position.set(cx - 122, 150, cz - 156); controls.target.set(cx, 116, cz - 4);
  } else if (presetName === 'pile') {
    camera.position.set(cx + 165, 415, cz + 495); controls.target.set(cx, -12, cz + 45);
  }
}

async function init() {
  const [sharedKipData, xbotGltf, michelleGltf] = await Promise.all([
    kipSession.load(),
    gltfLoader.loadAsync('/kip/mixamo/Xbot.glb'),
    gltfLoader.loadAsync('/kip/mixamo/Michelle.glb'),
  ]);
  if (!sharedKipData?.rig) return;

  kip = sharedKipData.rig;
  unregisterKipSync = kipSession.registerSync(adoptSharedDriverState);
  unregisterKipPrintState = kipSession.registerPrintState(getPrintState); // the Truck prints its driver as this bench has it dressed (stage 4c)
  attachSharedKip();
  kipMixer = new THREE.AnimationMixer(kip.grounder);

  // Clean-room Mixamo Reference bone-and-joint kinematic rig (zero third-party character mesh!)
  refSkeletonGroup = new THREE.Group();
  refSkeletonGroup.visible = false;
  const xbotVis = xbotGltf.scene;
  const jointDotGeo = new THREE.IcosahedronGeometry(0.018, 1);
  const jointDotMat = new THREE.MeshBasicMaterial({ color: 0xff6b4a });
  const majorBones = findMixamoBones(xbotVis);
  for (const b of Object.values(majorBones)) {
    b.add(new THREE.Mesh(jointDotGeo, jointDotMat));
  }
  refSkeletonGroup.add(xbotVis);
  const skelHelper = new THREE.SkeletonHelper(xbotVis);
  skelHelper.material.linewidth = 2;
  scene.add(skelHelper);
  skelHelper.visible = false;
  kip.skelHelper = skelHelper;
  scene.add(refSkeletonGroup);

  const clipLabels = [
    ['idle', 'Idle'],
    ['walk', 'Walk'],
    ['run', 'Run'],
    ['sneak_pose', 'Sneak'],
    ['HeroWave', 'Hero Wave'],
    ['sad_pose', 'Sad'],
    ['agree', 'Agree'],
    ['headShake', 'Shake'],
  ];

  for (const [rawName, label] of clipLabels) {
    if (rawName === 'HeroWave') {
      actions.set('HeroWave', kipMixer.clipAction(makeHeroWaveClip()));
      registerClip('HeroWave', label);
      continue;
    }
    if (rawName === 'sad_pose') {
      actions.set('sad_pose', kipMixer.clipAction(makeSadClip()));
      registerClip('sad_pose', label);
      continue;
    }
    if (rawName === 'sneak_pose') {
      actions.set('sneak_pose', kipMixer.clipAction(makeSneakClip()));
      registerClip('sneak_pose', label);
      continue;
    }
    const rawClip = xbotGltf.animations.find(a => a.name === rawName);
    if (!rawClip) continue;
    const baked = retargetMixamoClipToKip(rawClip, xbotVis, { name: rawName, inPlace: true });
    if (baked) {
      actions.set(rawName, kipMixer.clipAction(baked));
      registerClip(rawName, label);
    }
  }

  // Register Phase 2 dedicated Vehicle & Skateboard clips!
  actions.set('drive_sit', kipMixer.clipAction(makeDriveSitClip(THREE)));
  registerClip('drive_sit', 'Sit & Drive');
  actions.set('scooter_ride', kipMixer.clipAction(makeScooterRideClip(THREE)));
  registerClip('scooter_ride', 'Scooter');
  actions.set('moto_straddle', kipMixer.clipAction(makeMotoStraddleClip(THREE)));
  registerClip('moto_straddle', 'Moto');
  actions.set('skate_cruise', kipMixer.clipAction(makeSkateboardClip(THREE)));
  registerClip('skate_cruise', 'Skate');

  // Reactions, short dances and one clip per handheld prop (kip-clips.js): hand-built, same 14 joints and 30 fps as the clips above.
  for (const entry of KIP_CLIPS) {
    actions.set(entry.id, kipMixer.clipAction(makeKipClip(THREE, entry)));
    registerClip(entry.id, entry.label);
    if (entry.group === 'dance' && entry.bpm) danceTempos.push({ id: entry.id, bpm: entry.bpm, beats: entry.beats, group: 'dance' }); // the party picks from these
    if (entry.plant) plantedClips.add(entry.id);
  }

  xbotVis.scale.multiplyScalar(83.5);
  refMixer = new THREE.AnimationMixer(xbotVis);
  for (const [rawName] of clipLabels) {
    const rawClip = xbotGltf.animations.find(a => a.name === rawName);
    if (rawClip && rawClip.duration > 0.05) refActions.set(rawName, refMixer.clipAction(rawClip));
  }

  const tposeClip = michelleGltf.animations.find(a => a.name === 'TPose');
  const sambaClip = michelleGltf.animations.find(a => a.name === 'SambaDance');
  if (sambaClip) {
    const bakedSamba = retargetMixamoClipToKip(sambaClip, michelleGltf.scene, {
      name: 'SambaDance', tposeClip, inPlace: false
    });
    if (bakedSamba) {
      limitHands(THREE, bakedSamba);       // Mixamo's wrists bend 59 degrees on Kip's arm: cap the bend and the forearm twist
      plantBakedClip(THREE, bakedSamba);   // Mixamo's feet skate on Kip's rigid legs (29 to 41 mm on the floor): re-solve the legs with the feet planted
      actions.set('SambaDance', kipMixer.clipAction(bakedSamba));
      registerClip('SambaDance', 'Samba');
    }
  }
  // Baked Mixamo clips (scripts/mixamo-bake.mjs -> /kip/mixamo/baked/): the dances and movement-break moves as joint data only, already
  // retargeted, wrists capped and feet planted, so nothing is solved here and no raw Mixamo file is served. A clip that fails its own check is
  // skipped; a missing index (an older build) changes nothing.
  try {
    const res = await fetch('/kip/mixamo/baked/index.json');
    const list = res.ok ? ((await res.json()).clips || []) : [];
    const loaded = await Promise.all(list.map(async (c) => {
      const r = await fetch(`/kip/mixamo/baked/${encodeURIComponent(c.id)}.json`);
      if (!r.ok) return null;
      const baked = await r.json();
      return checkBaked(baked, { loop: c.loop }).length === 0 ? { c, baked } : null;
    }));
    for (const item of loaded) {
      if (!item) continue;
      actions.set(item.baked.id, kipMixer.clipAction(bakedToClip(THREE, item.baked)));
      registerClip(item.baked.id, item.c.label);
      // a baked clip with a tempo is offered to the party: a dance is picked by the tempo, a movement-break move or a guitar strum only when a child chooses it
      if (item.baked.planted) plantedClips.add(item.baked.id);
      if (['dance', 'move', 'music'].includes(item.baked.group) && item.baked.beats) danceTempos.push({ id: item.baked.id, bpm: item.baked.bpm, beats: item.baked.beats, group: item.baked.group });
    }
  } catch (err) {
    console.warn('baked Mixamo clips not loaded', err);
  }
  if (tposeClip) {
    const bakedTPose = retargetMixamoClipToKip(tposeClip, michelleGltf.scene, {
      name: 'TPose', tposeClip, inPlace: true
    });
    if (bakedTPose) {
      actions.set('TPose', kipMixer.clipAction(bakedTPose));
      registerClip('TPose', 'T-Pose');
    }
  }

  // Initialize Photo-Forge default kid sketch preview so modal is ready immediately
  loadKidSketchIntoForge('sword');

  // Apply ToyVentor #toy= build contract if launched from Toybox / Play screen!
  const toyContract = decodeHashToyContract();
  if (toyContract) {
    if (toyContract.name) {
      $el('scene-title').textContent = `${toyContract.name} — Kip 3D Modular Rig`;
    }
    if (toyContract.col?.c1) mats.shell.color.set(toyContract.col.c1);
    if (toyContract.col?.c2) mats.spark.color.set(toyContract.col.c2);
    const parts = Array.isArray(toyContract.parts) ? toyContract.parts : [];
    const stats = toyContract.stats || {};
    if (toyContract.prints === false) loco.hasPhotoAccessory = true;
    if (parts.some(p => p.includes('veh_car'))) setVehicleMode('car', false);
    else if (parts.some(p => p.includes('veh_truck'))) setVehicleMode('truck', false);
    else if (parts.some(p => p.includes('veh_moto'))) setVehicleMode('moto', false);
    else if (parts.some(p => p.includes('veh_scooter'))) setVehicleMode('scooter', false);
    if (parts.some(p => p.includes('jetpack'))) setBackMode('jetpack');
    else if (parts.some(p => p.includes('pack_explorer'))) setBackMode('explorer');
    else if (parts.some(p => p.includes('spoiler') || p.includes('walkers'))) {
      setBackMode((stats.speed ?? 0) >= 3 ? 'gears' : 'wings');
    }
    if (parts.some(p => p.includes('tail') || p.includes('wheels') || p.includes('cams'))) {
      setTailMode((stats.spin ?? 0) >= 3 ? 'pro' : 'wag');
    }
    if (parts.some(p => p.includes('eyes') || p.includes('lightbar') || p.includes('bulb'))) {
      setCrownMode('ears');
    }
    if (parts.some(p => p.includes('wrench'))) setPropMode('wrench');
    else if (parts.some(p => p.includes('shield'))) setPropMode('shield');
    else if (parts.some(p => p.includes('skateboard'))) setPropMode('skateboard');
    else if (parts.some(p => p.includes('block') || p.includes('truck') || p.includes('box'))) {
      setPropMode('shaft');
    }
  }

  // Initialize default head/faceplate/hair/hat layout, then apply URL query overrides
  if (kipSession.state.source) adoptSharedDriverState();
  syncHeadHairHatLayout();
  if (params.get('edition') === 'snap') setEdition('snap');
  const startPreset = params.get('loadout') || params.get('preset');
  if (startPreset) applyPreset(startPreset);
  if (params.get('cat'))     setCategoryMode(params.get('cat'));
  if (params.get('head'))    setHeadMode(params.get('head'));
  if (params.get('skin'))    setSkinTone(params.get('skin'));
  if (params.get('shirt'))   setShirtMode(params.get('shirt'));
  if (params.get('pants'))   setPantsMode(params.get('pants'));
  if (params.get('haircol')) setHairColor(params.get('haircol'));
  if (params.get('hair'))    setHairMode(params.get('hair'));
  if (params.get('insert'))  setFaceInsertMode(params.get('insert'));
  if (params.get('face') || params.get('expr')) setFaceMode(params.get('face') || params.get('expr'));
  if (params.get('hat') || params.get('crown')) setCrownMode(params.get('hat') || params.get('crown'));
  if (params.get('hatcol'))  setHatColor(params.get('hatcol'));
  if (params.get('back'))    setBackMode(params.get('back'));
  if (params.get('tail'))    setTailMode(params.get('tail'));
  if (params.get('prop'))    setPropMode(params.get('prop'));
  else if (params.get('hand')) setPropMode(['1', 'shaft', 'pro'].includes(params.get('hand')) ? 'shaft' : params.get('hand'));
  if (params.get('covers') !== null) setVehicleCovers(params.get('covers') !== '0');
  if (params.get('racer') !== null) setRacerKit(params.get('racer') !== '0');
  if (params.get('vehicle')) setVehicleMode(params.get('vehicle'), !params.get('cam'));
  if (params.get('sdk'))     equipSdkDemo(params.get('sdk'));
  if (params.get('photo')) {
    loadKidSketchIntoForge(params.get('photo'));
    equipPhotoAccessoryFromForge(false);
  }
  if (params.get('modal') === 'llm')   $el('modal-llm').classList.add('open');
  if (params.get('modal') === 'photo') $el('modal-photo').classList.add('open');
  if (params.get('ref') === '1') toggleRefSkeleton();

  const defaultStartClip = getDefaultRestClip();
  const startClip = resolveClipKey(params.get('clip') || defaultStartClip);
  if (actions.has(startClip)) {
    loco.manualOverride = Boolean(params.get('clip') && startClip !== defaultStartClip);
    playClip(startClip, 0.001);
    const seekT = parseFloat(params.get('t') || '0');
    if (seekT > 0) {
      loco.animClock = seekT;
      kipMixer.update(seekT);
      if (refMixer) refMixer.update(seekT);
    }
  } else {
    playClip(defaultStartClip, 0.001);
  }

  const viewParam = params.get('view');
  if (viewParam === 'exploded') {
    const amt = parseFloat(params.get('explode') || '1');
    setExplodeAmount(amt, true);
    if (!params.get('cam')) applyCameraPreset('exploded');
  } else if (viewParam === 'pile') {
    enterPartPile();
    if (!params.get('cam')) applyCameraPreset('pile');
  } else if (viewParam === 'building') {
    startPileToBuild();
    loco.buildTime = parseFloat(params.get('bt') || '1.85');
    if (!params.get('cam')) applyCameraPreset('pile');
  }

  if (params.get('cam')) applyCameraPreset(params.get('cam'));

  if (!hosted) animate(); // hosted: the stage's loop calls frame()
  started = true;
  globals.__KIP_READY__ = true;
  // put back the part the child made from words last time, unless this visit asked for a look of its own (a #toy= link or a look in the address)
  const askedForLook = Boolean(toyContract) || ['head', 'crown', 'hat', 'loadout', 'preset'].some((k) => params.get(k));
  if (!askedForLook) restoreForgeParts();
}

// --- 5. EDITION (PRO 8+ vs SNAP 3+), WARDROBE, MODULAR TU VEHICLES, LLM SDK & PHOTO FORGE ---
function getDefaultRestClip() {
  if (loco.vehicle === 'car' || loco.vehicle === 'truck') return 'drive_sit';
  if (loco.vehicle === 'scooter') return 'scooter_ride';
  if (loco.vehicle === 'moto') return 'moto_straddle';
  if (loco.prop === 'skateboard') return 'skate_cruise';
  const propClip = clipForProp(loco.prop);
  if (propClip && actions.has(propClip)) return propClip;
  return 'idle';
}

function syncNeckAndSeatedVisibility() {
  if (!kip || !kip.exp) return;
  const isPro = loco.edition === 'pro';

  // Universal Neck Collar: all 12 PartSpec 2x1 heads snap onto `neck_turret_2x1`!
  if (kip.neckTurret2x1Slot) kip.neckTurret2x1Slot.visible = true;

  // Snap (`3+`) 1-piece legs now smoothly flex at hips & digital knees in animations (including all 4 vehicles!),
  // while straightening right back into rigid 1-piece printable parts in Exploded View & Part Pile!
  for (const s of kip.snapStandingLegSlots) s.visible = !isPro;
  for (const b of kip.bootSlots)            b.visible = true;
  kip.exp.snapSeatedLegsGroup.visible = false;
}

function attachSharedKip() {
  if (!kip || !active) return false;
  return kipSession.borrow('kip', scene) === kip;
}

function adoptSharedDriverState(sharedState = kipSession.state) {
  if (!kip?.exp || !sharedState?.source) return false;
  loco.edition = sharedState.edition === 'snap' ? 'snap' : 'pro';
  loco.head = sharedState.head || loco.head;
  if (loco.head !== 'custom') loco.category = categoryOfHead(loco.head);
  loco.hair = HUMAN_HEAD_IDS.has(loco.head) ? (sharedState.hair || 'off') : 'off';
  loco.hat = sharedState.hat || 'buds';
  loco.crown = loco.hat;
  setEdition(loco.edition);
  syncHeadHairHatLayout();
  updateStatusText();
  return true;
}

function setEdition(ed) {
  loco.edition = (ed === 'snap') ? 'snap' : 'pro';
  const isPro = loco.edition === 'pro';
  for (const s of kip.editionParts.pro)  s.visible = isPro;
  for (const s of kip.editionParts.snap) s.visible = !isPro;

  // Restore joint offsets & rest Snap limb meshes cleanly when switching back to Pro 8+
  for (const tag of ['Left', 'Right']) {
    if (isPro) {
      kip.joints[`${tag}ForeArm`].position.set(0, -23.8, 0);
      kip.joints[`${tag}Hand`].position.set(0, -22.6, 0);
      kip.joints[`${tag}Leg`].position.set(0, -25.6, 0);
      kip.joints[`${tag}Foot`].position.set(0, -26.0, -1.5);
    }
    if (kip.flexArms[tag]) kip.flexArms[tag].deform(new THREE.Quaternion());
    if (kip.flexLegs[tag]) kip.flexLegs[tag].deform(new THREE.Quaternion());
    if (kip.snapWriAnchors[tag]) {
      kip.snapWriAnchors[tag].position.set(0, -35.0, 3.8);
      kip.snapWriAnchors[tag].rotation.set(THREE.MathUtils.degToRad(-11), 0, 0);
    }
    if (kip.snapAnkAnchors[tag]) {
      kip.snapAnkAnchors[tag].position.set(0, -39.2, 0);
      kip.snapAnkAnchors[tag].quaternion.identity();
    }
  }
  syncNeckAndSeatedVisibility();

  const badge = $el('badge-edition');
  badge.textContent = isPro ? 'Pro 8+ Rig' : 'Snap 3+ Rig';
  badge.classList.toggle('snap-mode', !isPro);

  loco.hasPrevStance = false;
  if (loco.buildMode !== 'assembled') {
    layoutPartPile(kip, loco.edition);
  }
  kipSession.setDriverState({ edition: loco.edition }, 'kip');
  updateStatusText();
}

$el('badge-edition').addEventListener('click', () => {
  setEdition(loco.edition === 'pro' ? 'snap' : 'pro');
});

// Exploded View controls

function setExplodeAmount(val, instant = false) {
  if (val > 0.01 && loco.buildMode !== 'assembled') exitPileMode();
  loco.explodeTarget = THREE.MathUtils.clamp(val, 0, 1);
  if (instant) loco.explodeAmount = loco.explodeTarget;
  updateStatusText();
}

function toggleExplode() {
  const turningOn = loco.explodeTarget < 0.5;
  setExplodeAmount(turningOn ? 1.0 : 0.0, false);
  if (turningOn) applyCameraPreset('exploded');
  else if (loco.vehicle !== 'none') applyCameraPreset('vehicle');
  else {
    const cx = kip.mover.position.x, cz = kip.mover.position.z;
    camera.position.set(cx + 175, 162, cz + 415);
    controls.target.set(cx, 68, cz);
  }
}

// Tabletop Part Pile & Pile -> Build controls
function resetSlotsToIdentity() {
  for (const s of kip.partSlots) {
    s.grp.position.set(0, 0, 0);
    s.grp.quaternion.identity();
  }
  explodeLines.visible = false;
}

function exitPileMode() {
  loco.buildMode = 'assembled';
  resetSlotsToIdentity();
  updateStatusText();
}

function enterPartPile(autoFrame = false) {
  setExplodeAmount(0, true);
  loco.buildMode = 'pile';
  loco.buildTime = 0;
  playClip(getDefaultRestClip(), 0.01);
  kipMixer.setTime(0);
  applySnapJointOverrides();
  layoutPartPile(kip, loco.edition);
  if (autoFrame) applyCameraPreset('pile');
  updateStatusText();
}

function startPileToBuild(autoFrame = false) {
  setExplodeAmount(0, true);
  loco.buildMode = 'building';
  loco.buildTime = 0;
  playClip(getDefaultRestClip(), 0.01);
  kipMixer.setTime(0);
  applySnapJointOverrides();
  layoutPartPile(kip, loco.edition);
  if (autoFrame) applyCameraPreset('pile');
  updateStatusText();
}

function togglePartPile() {
  if (loco.buildMode === 'pile') exitPileMode();
  else enterPartPile(true);
}

function refreshPileIfActive() {
  if (kip && loco.buildMode !== 'assembled') layoutPartPile(kip, loco.edition);
}

// --- PHASE 1: 12 HEADS IN 4 CATEGORIES (HUMAN · ROBOT · ANIMAL · CREATURE), UNIVERSAL FACE INSERTS, WRAP-AROUND HAIRS & OUTFITS ---
const HEAD_DECAL_TRANSFORMS = Object.assign(
  Object.fromEntries(WARDROBE_HEADS.map(h => [h.id, { crownY: h.crownY, faceY: h.faceY }])),
  { custom: { crownY: 36.2, faceY: 17.1875 } }
);

const LEGACY_HEAD_HAIR_MAP = {
  classic: { head: 'kid', hair: null },   // retired Classic Kip merged into Soft Youth
  chin:    { head: 'kid', hair: null },   // retired Human 3 (Slender Grace) merged into Soft Youth
  boy:     { head: 'kid', hair: 'short_swept' },
  bob:     { head: 'kid', hair: 'bob' },
  curls:   { head: 'kid', hair: 'curly' },
  human:   { head: 'kid', hair: null },
};

function setSkinTone(skinId) {
  const found = SKIN_TONES.find(s => s.id === skinId) || SKIN_TONES[0];
  loco.skin = found.id;
  syncHeadHairHatLayout();
}

function setShirtMode(shirtId) {
  const found = SHIRT_OPTIONS.find(s => s.id === shirtId) || SHIRT_OPTIONS[0];
  loco.shirt = found.id;
  // Auto-pair denim overalls with overall denim pants if pants are currently Off!
  if (loco.shirt === 'overalls' && loco.pants === 'off') {
    loco.pants = 'overalls_jeans';
  }
  syncHeadHairHatLayout();
}

function setPantsMode(pantsId) {
  const found = PANTS_OPTIONS.find(p => p.id === pantsId) || PANTS_OPTIONS[0];
  loco.pants = found.id;
  syncHeadHairHatLayout();
}

function setHairColor(colId) {
  const found = HAIR_COLORS.find(c => c.id === colId) || HAIR_COLORS[0];
  loco.hairColor = found.id;
  if (kip && kip.exp) kip.exp.expMats.hair.color.set(found.hex);
}

function setHatColor(colId) {
  const found = HAT_COLORS.find(c => c.id === colId) || HAT_COLORS[0];
  loco.hatColor = found.id;
  if (kip && kip.exp && kip.exp.expMats.hat) kip.exp.expMats.hat.color.set(found.hex);
}

function setFaceInsertMode(modeId) {
  const found = FACE_INSERT_MODES.find(m => m.id === modeId);
  loco.faceInsert = found ? found.id : 'sculpted';
  syncHeadHairHatLayout();
  refreshPileIfActive();
  updateStatusText();
}

function refreshDecalTexture() {
  if (!kip || !kip.exp) return;
  const hType = (loco.head === 'custom') ? 'kid' : loco.head;
  const newCanvas = createDecalExpressionCanvas(loco.expr, hType, loco.faceInsert, { onPlate: HUMAN_HEAD_IDS.has(loco.head) });
  const tex = kip.exp.decalTex;
  const prev = tex.image;
  tex.image = newCanvas;
  // The GPU copy has a fixed size: a canvas of another size (the selfie is 510x268, the 2D art 512x256) needs a fresh texture, or the upload silently fails and the old art stays on the plate.
  if (!prev || prev.width !== newCanvas.width || prev.height !== newCanvas.height) tex.dispose();
  tex.needsUpdate = true;
}

function syncHeadHairHatLayout() {
  if (!kip || !kip.exp) return;
  const isHuman = HUMAN_HEAD_IDS.has(loco.head);
  const dt = HEAD_DECAL_TRANSFORMS[loco.head] || HEAD_DECAL_TRANSFORMS.kid;
  const headCrownY = dt.crownY;

  // 1. Base Head shell visibility
  kip.exp.altHeadsGroup.visible = true;
  for (const [k, hm] of Object.entries(kip.exp.headMeshes)) {
    hm.visible = (k === loco.head);
  }
  kip.exp.customHeadContainer.visible = (loco.head === 'custom');

  // 2. Universal Swappable Human Face Inserts (`sculpted`, `vinyl`, `flat` — 100% interchangeable across ALL 4 human heads!)
  refreshDecalTexture();
  kip.exp.faceplateGroup.visible = isHuman;
  // The plate STL's z = 0 is the printed chin edge; its stem axis is 2.9 - 0.4 (chin trim, 6b20bed) = 2.5 mm above it.
  kip.exp.faceplateHolder.position.set(0, dt.faceY - 2.50 + FACEPLATE_SEAT_MM.raise, FACE_STEM_MM - FACEPLATE_SEAT_MM.sink);
  kip.exp.faceplateMesh.visible      = isHuman && (loco.faceInsert === 'sculpted');
  kip.exp.faceplateVinylMesh.visible = isHuman && (loco.faceInsert === 'vinyl');
  kip.exp.faceplateFlatMesh.visible  = isHuman && (loco.faceInsert === 'flat');
  kip.exp.faceplateDecalPlane.geometry = kip.exp.faceplateDecalGeos[loco.expr === 'selfie' ? 'selfie' : loco.faceInsert] || kip.exp.faceplateDecalGeos.sculpted;
  kip.exp.faceplateDecalPlane.visible = isHuman && (loco.expr !== 'blank');

  const usesConformalDecal = !isHuman && loco.head !== 'custom';
  if (usesConformalDecal && kip.exp.headDecalGeos[loco.head]) {
    kip.exp.decalPlane.geometry = kip.exp.headDecalGeos[loco.head];
    kip.exp.decalPlane.position.set(0, 0, 0);
    kip.exp.decalPlane.rotation.set(0, 0, 0);
    kip.exp.decalPlane.scale.setScalar(1.0);
  }
  kip.exp.decalPlane.visible = usesConformalDecal && (loco.expr !== 'blank');

  // 3. Separate Clip-On 2x1 Hair (`8 Hat-Ready` with top_studs + `11 Sculpted-Top` studless)
  const hairOpt = HAIR_OPTIONS.find(h => h.id === loco.hair) || HAIR_OPTIONS[0];
  const hasHair = (hairOpt.id !== 'off');
  kip.exp.hairGroup.visible = hasHair;
  kip.exp.hairAnchor.position.y = headCrownY;
  for (const [k, m] of Object.entries(kip.exp.hairMeshes)) {
    m.visible = (k === hairOpt.id);
  }
  kip.exp.hairCrownBuds.position.y = hairOpt.topH;
  kip.exp.hairCrownBuds.visible = hasHair && hairOpt.hatReady && (loco.hat !== 'blank');

  // Base head 2x1 Crown Buds
  kip.exp.altCrownBuds.position.y = headCrownY;
  kip.exp.altCrownBuds.visible = (loco.hat !== 'blank' || hasHair);

  // 4. Stackable 2x1 Hat / Topper (`crownAnchor` sits on bald head crown OR on top of Hat-Ready hair!)
  const canWearHat = hairOpt.hatReady;
  kip.crownAccSlot.visible = canWearHat;
  kip.exp.crownAnchor.position.y = headCrownY + (hasHair ? hairOpt.topH : 0.0);

  kip.pointyEars.visible = canWearHat && (loco.hat === 'ears');
  kip.wobbleHat.visible  = canWearHat && (loco.hat === 'hat');
  for (const [k, m] of Object.entries(kip.exp.hatMeshes)) {
    m.visible = canWearHat && (k === loco.hat) && (k !== 'headphones' || headphonesFit(loco.head, loco.hair));
  }
  kip.exp.customCrownContainer.visible = canWearHat && (loco.hat === 'custom');

  // Dynamic Explode guide lines & pull heights when Hat stacks on Hair!
  const hairSlotEntry = kip.partSlots.find(s => s.id === 'hair_clip');
  if (hairSlotEntry) {
    hairSlotEntry.guideTo = 'alt_head';
    hairSlotEntry.explodeVec.set(0, 70, 0);
  }
  const crownSlotEntry = kip.partSlots.find(s => s.id === 'crown_acc');
  if (crownSlotEntry) {
    crownSlotEntry.guideTo = hasHair ? 'hair_clip' : 'alt_head';
    crownSlotEntry.explodeVec.set(0, hasHair ? 114 : 84, 0);
  }

  // 5. Full-Body Skin Tones + Solid Filament Clothing + Front Chest Stencil Stickers
  kip.exp.applyBodySkinAndClothing({
    head: loco.head,
    skinId: loco.skin,
    shirtId: loco.shirt,
    pantsId: loco.pants,
  });

  syncNeckAndSeatedVisibility();
  kipSession.setDriverState({
    edition: loco.edition,
    head: loco.head,
    hair: loco.hair,
    hat: loco.hat,
  }, 'kip');
}

function setHeadMode(headId) {
  const prevHead = loco.head;
  if (LEGACY_HEAD_HAIR_MAP[headId]) {
    const mapped = LEGACY_HEAD_HAIR_MAP[headId];
    loco.head = mapped.head;
    if (mapped.hair) {
      loco.hair = mapped.hair;
      const ho = HAIR_OPTIONS.find(h => h.id === loco.hair);
      if (ho && !ho.hatReady) { loco.hat = 'buds'; loco.crown = 'buds'; }
    }
  } else {
    const valid = WARDROBE_HEADS.some(h => h.id === headId) || headId === 'custom';
    loco.head = valid ? headId : 'kid';
  }
  if (loco.head !== 'custom') loco.category = categoryOfHead(loco.head);
  // When switching from default Clean Kip (`vinyl_cream`) to a Human head, auto-select Warm Peach skin!
  if (HUMAN_HEAD_IDS.has(loco.head) && loco.skin === 'vinyl_cream') {
    loco.skin = 'warm_peach';
  }
  // When stepping onto `chibi` (`Human 2 · Vinyl Squircle`), showcase the collector-vinyl `3D Button Eyes & Nose` insert by default
  // (while remaining 100% swappable to `sculpted` or `flat` from the menu or `?insert=...`!).
  if (loco.head === 'chibi' && prevHead !== 'chibi') {
    loco.faceInsert = 'vinyl';
  }
  // Wrap-around human wigs hug the 4 human skulls; clear hair when switching to a robot, animal or creature head!
  if (!HUMAN_HEAD_IDS.has(loco.head) && loco.hair !== 'off') {
    loco.hair = 'off';
  }
  if (loco.hat === 'headphones' && !headphonesFit(loco.head, loco.hair)) { loco.hat = 'buds'; loco.crown = 'buds'; }
  syncHeadHairHatLayout();
  refreshPileIfActive();
  updateStatusText();
}

function setCategoryMode(catId) {
  const found = HEAD_CATEGORIES.find(c => c.id === catId) || HEAD_CATEGORIES[0];
  loco.category = found.id;
  const list = headsInCategory(found.id);
  if (!list.some(h => h.id === loco.head)) setHeadMode(list[0].id);
  else syncHeadHairHatLayout();
}

function setFaceMode(exprId) {
  const found = DECAL_EXPRESSIONS.find(e => e.id === exprId) || DECAL_EXPRESSIONS[0];
  loco.expr = found.id;
  syncHeadHairHatLayout();
  refreshPileIfActive();
}

function setHairMode(hairId) {
  const found = HAIR_OPTIONS.find(h => h.id === hairId) || HAIR_OPTIONS[0];
  loco.hair = found.id;
  if (!found.hatReady || (loco.hat === 'headphones' && !found.earReady)) {
    loco.hat = 'buds';
    loco.crown = 'buds';
  }
  syncHeadHairHatLayout();
  refreshPileIfActive();
  updateStatusText();
}

function setCrownMode(mode) {
  // Support legacy `?crown=spiky` / `curly` / `swoosh` / `ponytail` URL params by routing hair IDs to `setHairMode`!
  const isHairOnly = HAIR_OPTIONS.some(h => h.id === mode && h.id !== 'off');
  if (isHairOnly) {
    setHairMode(mode);
    return;
  }
  const extraValid = mode === 'wizardHat' || mode === 'custom';
  const found = HAT_OPTIONS.find(c => c.id === mode);
  const nextHat = (found || extraValid) ? mode : 'buds';

  // If equipping a physical hat/topper while wearing a studless Sculpted-Top hair, switch to Hat-Ready hair!
  const curHair = HAIR_OPTIONS.find(h => h.id === loco.hair) || HAIR_OPTIONS[0];
  if (!curHair.hatReady && nextHat !== 'buds' && nextHat !== 'blank') {
    loco.hair = HUMAN_HEAD_IDS.has(loco.head) ? 'short_swept' : 'off';
  }
  // Party headphones fit only the four human heads, over a bald head or a short Hat-Ready wig (headphonesFit): on any other head the request is ignored; on a long wig the hair becomes Swept.
  if (nextHat === 'headphones') {
    if (!HUMAN_HEAD_IDS.has(loco.head)) { updateStatusText(); return; }
    if (!headphonesFit(loco.head, loco.hair)) loco.hair = 'short_swept';
  }
  if (found && found.defaultCol) {
    setHatColor(found.defaultCol);
  }
  loco.hat = nextHat;
  loco.crown = nextHat;
  syncHeadHairHatLayout();
  refreshPileIfActive();
  updateStatusText();
}

function setBackMode(mode) {
  const found = BACK_OPTIONS.find(b => b.id === mode);
  loco.back = (found || mode === 'custom') ? mode : 'off';
  if (loco.back !== 'custom') loco.photoWingGroup = null;

  kip.backStudsSlot.visible      = (loco.back !== 'gears');
  kip.exp.explorerGroup.visible  = (loco.back === 'explorer');
  kip.exp.jetpackGroup.visible   = (loco.back === 'jetpack');
  kip.wingsGroup.visible         = (loco.back === 'wings');
  kip.proBackGroup.visible       = (loco.back === 'gears');
  kip.exp.customBackGroup.visible = (loco.back === 'custom');

  refreshPileIfActive();
}

const tailModes = ['off', 'wag', 'pro'];
let tailIdx = 0;

function setTailMode(mode) {
  tailIdx = Math.max(0, tailModes.indexOf(mode));
  const m = tailModes[tailIdx];
  kip.snapTailGroup.visible = (m === 'wag');
  kip.proTailGroup.visible  = (m === 'pro');
  refreshPileIfActive();
}

function setPropMode(mode) {
  const extraValid = mode === 'wand' || mode === 'custom';
  const found = PROP_OPTIONS.find(p => p.id === mode);
  loco.prop = (found || extraValid) ? mode : 'off';

  // Skateboard is on-foot riding gear, so step out of vehicle if equipping skateboard
  if (loco.prop === 'skateboard' && loco.vehicle !== 'none') {
    setVehicleMode('none', false);
  }

  kip.exp.wrenchGroup.visible     = (loco.prop === 'wrench');
  kip.exp.shieldGroup.visible     = (loco.prop === 'shield');
  for (const [wid, wgrp] of Object.entries(kip.exp.workshopGroups || {})) wgrp.visible = (loco.prop === wid);
  kip.proStaffGroup.visible       = (loco.prop === 'shaft');
  kip.exp.skateboardGroup.visible = (loco.prop === 'skateboard');
  kip.exp.customWandGroup.visible = (loco.prop === 'wand');
  kip.exp.customHandGroup.visible = (loco.prop === 'custom');

  // A prop with a clip (broom: sweep, hammer: strike ...) plays it on foot, like the skateboard; putting the prop away returns to the rest clip.
  const propClip = loco.vehicle === 'none' ? clipForProp(loco.prop) : null;
  if (loco.prop === 'skateboard' && loco.buildMode === 'assembled' && actions.has('skate_cruise')) {
    loco.manualOverride = false;
    playClip('skate_cruise', 0.18);
  } else if (propClip && loco.buildMode === 'assembled' && actions.has(propClip)) {
    loco.manualOverride = false;
    playClip(propClip, 0.18);
  } else if (loco.prop !== 'skateboard' && (activeClipName === 'skate_cruise' || isPropClip(activeClipName))) {
    playClip(getDefaultRestClip(), 0.18);
  }

  refreshPileIfActive();
  updateStatusText();
}

// --- PHASE 2 V2: MODULAR 12.5 mm TU VEHICLES + SNAP-ON BODY COVERS + STYLIZED WHEELS ---
function setVehicleCovers(on) {
  loco.vehCovers = Boolean(on);
  if (kip && kip.exp) kip.exp.setCoversVisible(loco.vehCovers, loco.vehicle);
  refreshPileIfActive();
}

function setRacerKit(on) {
  loco.racerKit = Boolean(on);
  kip.exp.carRacerGroup.visible   = loco.racerKit;
  kip.exp.truckRacerGroup.visible = loco.racerKit;
  kip.exp.bikeRacerGroup.visible  = loco.racerKit;
  // Hide hood scoop when a custom/photo hood ornament occupies the 2x2 Roadster hood!
  kip.exp.carHoodScoopAddon.slot.visible = loco.racerKit && !kip.exp.customHoodGroup.visible;

  refreshPileIfActive();
}

function setVehicleMode(vehId, autoFrame = true) {
  const found = VEHICLE_OPTIONS.find(v => v.id === vehId) || VEHICLE_OPTIONS[0];
  loco.vehicle = found.id;

  if (loco.vehicle !== 'none' && loco.prop === 'skateboard') {
    kip.exp.skateboardGroup.visible = false;
    loco.prop = 'off';
  }

  kip.exp.carGroup.visible   = (loco.vehicle === 'car');
  kip.exp.truckGroup.visible = (loco.vehicle === 'truck');
  kip.exp.bikeGroup.visible  = (loco.vehicle === 'scooter' || loco.vehicle === 'moto');
  kip.exp.setCoversVisible(loco.vehCovers, loco.vehicle);
  kip.exp.bikeLeanGroup.rotation.z = 0;

  syncNeckAndSeatedVisibility();
  loco.manualOverride = false;
  loco.driveSpeed = 0;
  loco.steerAngle = 0;

  const targetClip = getDefaultRestClip();
  if (actions.has(targetClip)) playClip(targetClip, 0.18);

  if (autoFrame) {
    applyCameraPreset(loco.vehicle === 'none' ? 'front' : 'vehicle');
  }
  refreshPileIfActive();
  updateStatusText();
}

const presets = ['clean', 'boy', 'girl', 'kai', 'scout', 'cat', 'fox', 'dragon', 'imp', 'pro'];
const presetLabels = {
  clean: 'Clean',
  boy:   'Leo Explorer',
  girl:  'Maya Skater',
  kai:   'Kai Moto',
  scout: 'Mecha Scout',
  cat:   'Whisker Cat Scooter',
  fox:   'Fox Scooter',
  dragon: 'Drake Dragon',
  imp:   'Yeti Imp',
  pro:   'Bolt Pro 8+',
};
let presetIdx = 0;

function applyPreset(name) {
  clearAllCustomMounts();
  const norm = (name === 'all' || name === 'snap') ? 'boy' : name;
  presetIdx = Math.max(0, presets.indexOf(norm));
  const p = presets[presetIdx];
  if (p === 'clean') {
    setVehicleMode('none', false);
    setHeadMode('kid'); setSkinTone('warm_peach'); setHairColor('chestnut');
    setShirtMode('off'); setPantsMode('off');
    setFaceInsertMode('sculpted');
    setHairMode('off'); setFaceMode('spark'); setCrownMode('buds');
    setBackMode('off'); setTailMode('off'); setPropMode('off');
  } else if (p === 'boy') {
    setVehicleMode('none', false);
    setHeadMode('kid'); setSkinTone('warm_peach'); setHairColor('chestnut');
    setShirtMode('spark_tee'); setPantsMode('cargo_shorts');
    setFaceInsertMode('sculpted');
    setHairMode('short_swept'); setCrownMode('ranger'); setFaceMode('spark');
    setBackMode('explorer'); setTailMode('off'); setPropMode('wrench');
  } else if (p === 'girl') {
    setVehicleMode('none', false);
    setHeadMode('chibi'); setSkinTone('golden_tan'); setHairColor('berry_spark');
    setShirtMode('varsity'); setPantsMode('jeans');
    setFaceInsertMode('vinyl');
    setHairMode('twin_braids'); setCrownMode('beanie'); setFaceMode('button');
    setBackMode('wings'); setTailMode('off'); setPropMode('skateboard');
  } else if (p === 'kai') {
    setHeadMode('tall'); setSkinTone('soft_ivory'); setHairColor('cobalt');
    setShirtMode('track_top'); setPantsMode('joggers');
    setFaceInsertMode('flat');
    setHairMode('pompadour'); setCrownMode('buds'); setFaceMode('cool');
    setBackMode('jetpack'); setTailMode('off'); setPropMode('off');
    setVehicleCovers(true);
    setVehicleMode('moto', false);
  } else if (p === 'scout') {
    setVehicleMode('none', false);
    setHeadMode('scout'); setSkinTone('vinyl_cream'); setHairMode('off');
    setShirtMode('off'); setPantsMode('off');
    setFaceMode('spark'); setCrownMode('buds');
    setBackMode('jetpack'); setTailMode('off'); setPropMode('off');
  } else if (p === 'cat') {
    setHeadMode('cat'); setSkinTone('vinyl_cream'); setHairMode('off');
    setShirtMode('hoodie'); setPantsMode('joggers');
    setFaceMode('happy'); setCrownMode('ears');
    setBackMode('off'); setTailMode('wag'); setPropMode('off');
    setVehicleCovers(true);
    setVehicleMode('scooter', false);
  } else if (p === 'dragon') {
    setVehicleMode('none', false);
    setHeadMode('dragon'); setSkinTone('vinyl_cream'); setHairMode('off');
    setShirtMode('track_top'); setPantsMode('cargo_shorts');
    setFaceMode('spark'); setCrownMode('buds');
    setBackMode('wings'); setTailMode('wag'); setPropMode('off');
  } else if (p === 'imp') {
    setVehicleMode('none', false);
    setHeadMode('imp'); setSkinTone('vinyl_cream'); setHairMode('off');
    setShirtMode('stripe_tee'); setPantsMode('sport_shorts');
    setFaceMode('surprised'); setCrownMode('horns');
    setBackMode('explorer'); setTailMode('wag'); setPropMode('wrench');
  } else if (p === 'fox') {
    setHeadMode('fox'); setSkinTone('vinyl_cream'); setHairMode('off');
    setShirtMode('stripe_tee'); setPantsMode('sport_shorts');
    setFaceMode('happy'); setCrownMode('ears');
    setBackMode('explorer'); setTailMode('wag'); setPropMode('off');
    setVehicleCovers(true);
    setVehicleMode('scooter', false);
  } else if (p === 'pro') {
    setVehicleMode('none', false);
    setHeadMode('robot'); setSkinTone('vinyl_cream'); setHairMode('off');
    setShirtMode('off'); setPantsMode('off');
    setFaceMode('spark'); setCrownMode('horns');
    setBackMode('jetpack'); setTailMode('pro'); setPropMode('shaft');
  }
}

function toggleRefSkeleton() {
  const on = !refSkeletonGroup.visible;
  refSkeletonGroup.visible = on;
  kip.skelHelper.visible = on;
}

const speeds = [1.0, 0.5, 0.25, 1.5];
let speedIdx = 0;
function setSpeedScale(scale) {
  speedIdx = Math.max(0, speeds.indexOf(scale));
  loco.speedScale = speeds[speedIdx];
  if (activeClipName && actions.has(activeClipName)) {
    actions.get(activeClipName).setEffectiveTimeScale(loco.speedScale);
  }
  if (activeClipName && refActions.has(activeClipName)) {
    refActions.get(activeClipName).setEffectiveTimeScale(loco.speedScale);
  }
}

// --- PHASE 3: CONFORMING LLM PART-MAKER SDK MODAL & CUSTOM .STL MOUNTING ---
const modalLlm = $el('modal-llm');
$el('btn-close-llm').addEventListener('click', () => modalLlm.classList.remove('open'));
modalLlm.addEventListener('click', e => { if (e.target === modalLlm) modalLlm.classList.remove('open'); });

$el('btn-copy-prompt').addEventListener('click', async () => {
  const statusSpan = $el('llm-copy-status');
  try {
    const resp = await fetch('/kip/LLM_PART_PROMPT.md');
    const txt = await resp.text();
    await navigator.clipboard.writeText(txt);
    statusSpan.innerHTML = '✅ <b>Copied 1-Page PartSpec v2 LLM Prompt to clipboard!</b>';
  } catch (err) {
    statusSpan.textContent = `Prompt available at /kip/LLM_PART_PROMPT.md (${err.message})`;
  }
});

// Memory-only custom STL bytes & Photo-Forge craft slot state for the print pack (never persisted or sent over network). The one exception is the part a child
// made from words (text-to-part): it is kept in this browser so it survives a reload; see "Text to part, kept across a reload" below.
const customStlSlots = { crown: null, hand: null, back: null, head: null, hood: null };
const photoAccessorySlots = { crown: null, wings: null, hand: null, hood: null };
// A household library item in the hand (docs/specs/household-library-spec.md): digital only, so it is NOT in the slots the print pack reads.
const householdSlots = { hand: null }; // { id, label } or null
let customHoodMode = 'none'; // 'none' | 'sdkCrest' | 'customStl' | 'photo'

function clearAllCustomMounts() {
  kip.exp.customCrownContainer.clear();
  kip.exp.customHandContainer.clear();
  kip.exp.customBackContainer.clear();
  kip.exp.customHeadContainer.clear();
  kip.exp.customHoodContainer.clear();
  kip.exp.customHoodGroup.visible = false;
  kip.exp.carHoodScoopAddon.slot.visible = loco.racerKit;
  loco.hasPhotoAccessory = false;
  loco.photoWingGroup = null;
  for (const k of Object.keys(customStlSlots)) customStlSlots[k] = null;
  for (const k of Object.keys(photoAccessorySlots)) photoAccessorySlots[k] = null;
  householdSlots.hand = null;
  customHoodMode = 'none';
}

function equipSdkDemo(which) {
  if (which === 'hat' || which === 'wizard') {
    customStlSlots.crown = null;
    photoAccessorySlots.crown = null;
    setCrownMode('wizardHat');
  } else if (which === 'wand') {
    customStlSlots.hand = null;
    photoAccessorySlots.hand = null;
    householdSlots.hand = null;
    setPropMode('wand');
  } else if (which === 'hood' || which === 'crest') {
    setVehicleMode('car', true);
    kip.exp.customHoodContainer.clear();
    kip.exp.customHoodContainer.add(scadMesh(kip.exp.expGeos.customHoodCrest, kip.exp.expMats.sun));
    kip.exp.customHoodGroup.visible = true;
    kip.exp.carHoodScoopAddon.slot.visible = false;
    customStlSlots.hood = null;
    photoAccessorySlots.hood = null;
    customHoodMode = 'sdkCrest';
  }
  modalLlm.classList.remove('open');
  updateStatusText();
}

$el('btn-ex-hat').addEventListener('click', () => equipSdkDemo('hat'));
$el('btn-ex-wand').addEventListener('click', () => equipSdkDemo('wand'));
$el('btn-ex-hood').addEventListener('click', () => equipSdkDemo('hood'));
$el('btn-clear-custom').addEventListener('click', () => {
  clearAllCustomMounts();
  setCrownMode('buds');
  setPropMode('off');
  if (loco.back === 'custom') setBackMode('off');
  if (loco.head === 'custom') setHeadMode('kid');
  updateStatusText();
});

async function loadCustomStlFile(file, slotOverride = null) {
  const slot = slotOverride || $el('sel-llm-slot').value || 'crown';
  const colorHex = $el('col-llm-stl').value || '#7c4dff';
  const buf = await file.arrayBuffer();
  const rawGeo = stlLoader.parse(buf);
  const merged = mergeVertices(rawGeo, 1e-4);
  const geo = toCreasedNormals(merged, THREE.MathUtils.degToRad(34));
  geo.computeBoundingBox();

  const mat = kip.exp.expMats.custom.clone();
  mat.color.set(colorHex);
  loco.hasPhotoAccessory = false;
  if (slot in customStlSlots) {
    customStlSlots[slot] = { bytes: new Uint8Array(buf.slice(0)), colorHex, name: file.name || slot };
  }
  if (slot === 'crown') photoAccessorySlots.crown = null;
  else if (slot === 'hand') { photoAccessorySlots.hand = null; householdSlots.hand = null; }
  else if (slot === 'back') photoAccessorySlots.wings = null;
  else if (slot === 'hood') {
    photoAccessorySlots.hood = null;
    customHoodMode = 'customStl';
  }

  if (slot === 'crown') {
    kip.exp.customCrownContainer.clear();
    kip.exp.customCrownContainer.add(scadMesh(geo, mat));
    setCrownMode('custom');
  } else if (slot === 'hand') {
    kip.exp.customHandContainer.clear();
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.position.set(0, 14.0, -3.0);
    g.add(m);
    g.rotation.z = Math.PI / 2;
    g.position.set(0, -11.4, 2.3);
    kip.exp.customHandContainer.add(g);
    setPropMode('custom');
  } else if (slot === 'back') {
    kip.exp.customBackContainer.clear();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.rotation.y = Math.PI;
    kip.exp.customBackContainer.add(m);
    setBackMode('custom');
  } else if (slot === 'head') {
    kip.exp.customHeadContainer.clear();
    kip.exp.customHeadContainer.add(scadMesh(geo, mat));
    setHeadMode('custom');
  } else if (slot === 'hood') {
    kip.exp.customHoodContainer.clear();
    kip.exp.customHoodContainer.add(scadMesh(geo, mat));
    kip.exp.customHoodGroup.visible = true;
    kip.exp.carHoodScoopAddon.slot.visible = false;
    setVehicleMode('car', true);
  }
  modalLlm.classList.remove('open');
  updateStatusText();
}

$el('llm-stl-input').addEventListener('change', e => {
  if (e.target.files[0]) loadCustomStlFile(e.target.files[0]);
});

// --- PHASE 4: PHOTO-TO-ACCESSORY FORGE (`prints: false` Digital Accessories) ---
const modalPhoto = $el('modal-photo');
const photoSrcCanvas = $el('photo-src-canvas');
const photoMaskCanvas = $el('photo-mask-canvas');
const photoVideo = $el('photo-webcam');
const photoStatus = $el('photo-forge-status');
const rngPhotoThr = $el('rng-photo-thr');
const rngPhotoDepth = $el('rng-photo-depth');
const selPhotoSlot = $el('sel-photo-slot');

let currentPhotoSeg = null;
let currentPhotoMeta = KID_DRAWING_PRESETS.sword;
let webcamStream = null;

function stopWebcamIfActive() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  photoVideo.style.display = 'none';
  photoSrcCanvas.style.display = 'block';
  $el('btn-cam-snap').style.display = 'none';
}

function openPhotoModal() {
  modalPhoto.classList.add('open');
  refreshPhotoSegmentation();
}
$el('btn-close-photo').addEventListener('click', () => {
  stopWebcamIfActive();
  modalPhoto.classList.remove('open');
});
modalPhoto.addEventListener('click', e => {
  if (e.target === modalPhoto) {
    stopWebcamIfActive();
    modalPhoto.classList.remove('open');
  }
});

function refreshPhotoSegmentation() {
  const t0 = performance.now();
  const thr = parseInt(rngPhotoThr.value, 10) || 38;
  currentPhotoSeg = segmentForegroundMask(photoSrcCanvas, thr);
  const ms = (performance.now() - t0).toFixed(1);
  const mctx = photoMaskCanvas.getContext('2d');
  mctx.clearRect(0, 0, photoMaskCanvas.width, photoMaskCanvas.height);
  mctx.drawImage(currentPhotoSeg.previewCanvas, 0, 0);
  $el('photo-seg-label').textContent = `Cutout (${ms} ms · ${currentPhotoSeg.fgCount} px)`;
}

function loadKidSketchIntoForge(presetKey) {
  stopWebcamIfActive();
  const preset = KID_DRAWING_PRESETS[presetKey] || KID_DRAWING_PRESETS.sword;
  currentPhotoMeta = preset;
  const c = renderKidPresetToCanvas(preset.id);
  const ctx = photoSrcCanvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.drawImage(c, 0, 0, 256, 256);
  selPhotoSlot.value = preset.slot;
  for (const id of ['sword', 'wings', 'crest']) {
    $el(`btn-kid-${id}`).classList.toggle('spark-active', id === preset.id);
  }
  refreshPhotoSegmentation();
  photoStatus.innerHTML = `Loaded kid sketch <b>${preset.name}</b> — ready to extrude into 3D (<code>prints: false</code>)!`;
}

$el('btn-kid-sword').addEventListener('click', () => loadKidSketchIntoForge('sword'));
$el('btn-kid-wings').addEventListener('click', () => loadKidSketchIntoForge('wings'));
$el('btn-kid-crest').addEventListener('click', () => loadKidSketchIntoForge('crest'));
rngPhotoThr.addEventListener('input', refreshPhotoSegmentation);

$el('photo-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  stopWebcamIfActive();
  const img = new Image();
  img.onload = () => {
    const ctx = photoSrcCanvas.getContext('2d');
    ctx.fillStyle = '#fcfaf5';
    ctx.fillRect(0, 0, 256, 256);
    const scale = Math.min(232 / img.width, 232 / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (256 - w) * 0.5, (256 - h) * 0.5, w, h);
    currentPhotoMeta = {
      id: 'upload',
      name: file.name.replace(/\.[^.]+$/, ''),
      slot: selPhotoSlot.value,
      scaleMm: 54,
      stats: { speed: 2, spin: 1, torque: 1, glow: 2 },
    };
    refreshPhotoSegmentation();
    photoStatus.innerHTML = `Segmented <b>${file.name}</b> — click <b>Equip on Kip!</b>`;
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
});

$el('btn-cam-start').addEventListener('click', async () => {
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 512, height: 512 } });
    photoVideo.srcObject = webcamStream;
    photoVideo.style.display = 'block';
    photoSrcCanvas.style.display = 'none';
    $el('btn-cam-snap').style.display = 'inline-flex';
    photoStatus.textContent = 'Hold your drawing or toy up to the camera and click Snap Photo!';
  } catch (err) {
    photoStatus.textContent = `Camera unavailable (${err.message}) — try uploading an image or picking a Kid Sketch!`;
  }
});

$el('btn-cam-snap').addEventListener('click', () => {
  const ctx = photoSrcCanvas.getContext('2d');
  const vw = photoVideo.videoWidth || 256, vh = photoVideo.videoHeight || 256;
  const side = Math.min(vw, vh);
  ctx.drawImage(photoVideo, (vw - side) * 0.5, (vh - side) * 0.5, side, side, 0, 0, 256, 256);
  stopWebcamIfActive();
  currentPhotoMeta = {
    id: 'webcam',
    name: 'Webcam Snap Toy',
    slot: selPhotoSlot.value,
    scaleMm: 54,
    stats: { speed: 2, spin: 2, torque: 1, glow: 2 },
  };
  refreshPhotoSegmentation();
  photoStatus.innerHTML = 'Snapped webcam frame! Adjust BG Cutoff if needed, then click <b>Equip on Kip!</b>';
});

$el('btn-sam-scan').addEventListener('click', async () => {
  photoStatus.textContent = 'Querying /api/scan (SAM 3.1)…';
  const res = await trySamScanEndpoint(photoSrcCanvas);
  refreshPhotoSegmentation();
  photoStatus.textContent = res.message;
});

function equipPhotoAccessoryFromForge(closeModal = true) {
  if (!currentPhotoSeg) refreshPhotoSegmentation();
  const slot = selPhotoSlot.value || 'hand';
  const depthMm = parseFloat(rngPhotoDepth.value) || 5.0;
  const scaleMm = currentPhotoMeta?.scaleMm || (slot === 'crown' ? 38 : 54);
  const meshGrp = buildPhotoAccessoryMesh(THREE, photoSrcCanvas, currentPhotoSeg, {
    slot,
    thicknessMm: depthMm,
    scaleMm,
    rimColor: '#ff6b4a',
    stats: currentPhotoMeta?.stats || { speed: 2, spin: 1, torque: 1, glow: 2 },
  });

  loco.hasPhotoAccessory = true;
  const photoEntry = { label: currentPhotoMeta?.name || slot };
  if (slot === 'hand') {
    customStlSlots.hand = null;
    householdSlots.hand = null;
    photoAccessorySlots.hand = photoEntry;
    kip.exp.customHandContainer.clear();
    kip.exp.customHandContainer.add(meshGrp);
    setPropMode('custom');
  } else if (slot === 'wings') {
    customStlSlots.back = null;
    photoAccessorySlots.wings = photoEntry;
    kip.exp.customBackContainer.clear();
    kip.exp.customBackContainer.add(meshGrp);
    setBackMode('custom');
    loco.photoWingGroup = meshGrp;
  } else if (slot === 'crown') {
    customStlSlots.crown = null;
    photoAccessorySlots.crown = photoEntry;
    kip.exp.customCrownContainer.clear();
    kip.exp.customCrownContainer.add(meshGrp);
    setCrownMode('custom');
  } else if (slot === 'hood') {
    customStlSlots.hood = null;
    photoAccessorySlots.hood = photoEntry;
    customHoodMode = 'photo';
    kip.exp.customHoodContainer.clear();
    kip.exp.customHoodContainer.add(meshGrp);
    kip.exp.customHoodGroup.visible = true;
    kip.exp.carHoodScoopAddon.slot.visible = false;
    setVehicleMode('car', true);
  }

  photoStatus.innerHTML = `Equipped <b>${currentPhotoMeta?.name || 'Photo Accessory'}</b> (${meshGrp.userData.triCount} tris · <code>prints: false</code>)!`;
  if (closeModal) {
    stopWebcamIfActive();
    modalPhoto.classList.remove('open');
  }
  updateStatusText();
}

$el('btn-equip-photo').addEventListener('click', () => equipPhotoAccessoryFromForge(true));

/**
 * The age band a grown-up chose in the app (the `ageBand` in the progression record, src/lib/age.ts: 0 = 2-3 up to 5 = 13+), or undefined when none is
 * set or storage cannot be read. The print panel uses it to leave out library items held back for older children; the photo plate is never held back.
 */
function readAgeBand() {
  try {
    const rec = JSON.parse(localStorage.getItem('toyforge:progression:v1') || 'null');
    const b = rec && rec.ageBand;
    return Number.isInteger(b) && b >= 0 && b <= 5 ? b : undefined;
  } catch {
    return undefined;
  }
}

// How a household item is shown: held up in front of Kip in the existing "Inspect" clip. In that hold the hand's frame is a quarter turn from a
// photo plate's, so the item is turned a quarter more about its up axis and its front (+y in the library) meets the camera.
const HOUSEHOLD_HOLD_CLIP = 'prop_magnifier';
const HOUSEHOLD_HOLD_YAW = Math.PI / 2;

/**
 * Put a household library item in the hand (the print panel's offer, or a test). The GLB is fetched from the catalog's own file name; nothing
 * typed by a child reaches the address. Digital only: the print pack does not see it. With `extras.skin` (the photo cut to the object's outline) the
 * item is coloured from the photo (the game asset only; a print stays single-colour) and a small chip lets the child switch back to its own colours.
 * Resolves `{ ok, coloured }`, never throws.
 */
async function equipHouseholdItem(item, extras = {}) {
  const file = item && typeof item.glb === 'string' && /^[a-z][a-z0-9_]{0,40}\.glb$/.test(item.glb) ? item.glb : null;
  if (!file) return { ok: false };
  try {
    const gltf = await gltfLoader.loadAsync(`/kip/household/${file}`);
    if (disposed) return { ok: false };
    const meshGrp = buildHouseholdHandMesh(THREE, gltf.scene, { id: item.id, label: item.label, rimColor: '#ff6b4a', yaw: HOUSEHOLD_HOLD_YAW });
    let skinCtl = null;
    if (extras && extras.skin) {
      try { skinCtl = applyHouseholdSkin(THREE, meshGrp, extras.skin, { mode: extras.skinMode }); } catch (err) { console.error(err); skinCtl = null; } // a skin that fails leaves the zone colours
    }
    customStlSlots.hand = null;
    photoAccessorySlots.hand = null;
    householdSlots.hand = { id: item.id, label: item.label };
    householdView = { id: item.id, label: item.label, ctl: skinCtl };
    kip.exp.customHandContainer.clear();
    kip.exp.customHandContainer.add(meshGrp);
    setPropMode('custom');
    // A custom prop has no clip of its own, and at rest the hand hangs with the item pointing backwards behind Kip, so a child would see a bare
    // handle. The "Inspect" clip (magnifier) holds a prop up in front of Kip; the item's turn above is set for it. On foot only.
    if (loco.vehicle === 'none' && loco.buildMode === 'assembled' && actions.has(HOUSEHOLD_HOLD_CLIP)) triggerClip(HOUSEHOLD_HOLD_CLIP);
    updateStatusText();
    return { ok: true, coloured: skinCtl !== null };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

// Text to part (F1, kip-forge-make.js): "Wear it" puts the part the child just made on Kip. The Worker's first look is a GLB in glTF's y-up space, which
// is the space scadMesh turns an STL part into, so it goes into the same custom crown / custom head containers a loaded .stl uses, with no rotation of
// its own; but it is in metres where the bench works in millimetres, so it is scaled up by 1000 (found on the real page: it was drawn 1000 times too small).
// Text to part, kept across a reload (Dan, 2026-11-03: "local storage for now"). The part Kip wears from the Make-from-words panel is saved in this browser only:
// one record per slot (crown, head) holding the generated part's file, its generated name and its colour, never the child's words and never sent anywhere. The
// record always says what Kip is wearing NOW: updateStatusText() runs syncForgeStorage(), which drops a record the moment the slot holds anything else (another
// hat or head, an imported file, a photo part, a reset). A #toy= link or an explicit ?head= / ?crown= / ?hat= / ?loadout= / ?preset= is the child (or a link) asking for
// a look, so the saved part is not put on over it, and it is NOT erased either: it stays saved for the next plain visit (a Toybox link must never cost a child
// the part they made). It is tracked again once the child makes or wears a part made from words in that visit. `var`, not `let`: updateStatusText runs during init.
var FORGE_PART_KEYS = { crown: 'toyforge:kip:forge-part:crown:v1', head: 'toyforge:kip:forge-part:head:v1' };
var FORGE_PART_MAX_B64 = 600000; // a real part is 25 to 50 kB of base64; refuse anything absurd
var forgeSaved = { crown: false, head: false }; // a record for the slot is in storage (this page wrote it, or is restoring it)
var forgeRestoring = false; // while a saved part is being put back, nothing is dropped
function forgeStoreGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function saveForgePart(slot, rec) {
  try {
    localStorage.setItem(FORGE_PART_KEYS[slot], JSON.stringify({ v: 1, slot, name: rec.name, colorHex: rec.colorHex, glbBase64: rec.glbBase64, savedAt: Date.now() }));
    forgeSaved[slot] = true;
  } catch { forgeSaved[slot] = false; } // private window or no room: Kip still wears it, it just will not be there after a reload
}
function forgetForgePart(slot) {
  try { localStorage.removeItem(FORGE_PART_KEYS[slot]); } catch { /* nothing to forget */ }
  forgeSaved[slot] = false;
}
/** True when the slot holds the part made from words (its group is named `forge:`), and Kip is in custom mode for it. */
function forgePartWorn(slot) {
  const box = slot === 'crown' ? kip.exp.customCrownContainer : kip.exp.customHeadContainer;
  const custom = slot === 'crown' ? loco.hat === 'custom' : loco.head === 'custom';
  return custom && box.children.length === 1 && String(box.children[0].name || '').startsWith('forge:');
}
function syncForgeStorage() {
  if (forgeRestoring || !kip || !kip.exp) return;
  for (const slot of ['crown', 'head']) if (forgeSaved[slot] && !forgePartWorn(slot)) forgetForgePart(slot);
}
/** A saved record, checked field by field (it came from storage, so it is data): null when it is missing or not a part this bench wrote. */
function readForgePart(slot) {
  const raw = forgeStoreGet(FORGE_PART_KEYS[slot]);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    if (!r || r.v !== 1 || r.slot !== slot || typeof r.glbBase64 !== 'string' || r.glbBase64.length < 20 || r.glbBase64.length > FORGE_PART_MAX_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(r.glbBase64)) return null;
    return { slot, glbBase64: r.glbBase64, name: typeof r.name === 'string' ? r.name.slice(0, 40) : slot, colorHex: /^#[0-9a-f]{6}$/i.test(r.colorHex || '') ? r.colorHex : undefined };
  } catch { return null; }
}
async function restoreForgeParts() {
  forgeRestoring = true;
  try {
    for (const slot of ['head', 'crown']) { // the head first: the hat goes on the head last
      if (forgeStoreGet(FORGE_PART_KEYS[slot]) === null) continue;
      const rec = readForgePart(slot);
      if (!rec) { forgetForgePart(slot); continue; } // not a record this bench wrote: drop it
      forgeSaved[slot] = true;
      const r = await equipForgePart({ ...rec, restore: true });
      if (disposed) return;
      if (!r.ok) forgetForgePart(slot); // a file that will not load is not retried on every visit
    }
  } finally {
    forgeRestoring = false;
    if (!disposed) syncForgeStorage();
  }
}

async function equipForgePart({ slot, glbBase64, name, colorHex, restore = false }) {
  if ((slot !== 'crown' && slot !== 'head') || typeof glbBase64 !== 'string' || !glbBase64) return { ok: false };
  try {
    const bin = atob(glbBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const gltf = await gltfLoader.parseAsync(bytes.buffer, '');
    if (disposed) return { ok: false };
    const mat = kip.exp.expMats.custom.clone();
    const hex = /^#[0-9a-f]{6}$/i.test(colorHex || '') ? colorHex : '#7c4dff'; // the child's colour (shared/forgeColors.ts), or the custom-part purple
    mat.color.set(hex);
    const group = new THREE.Group();
    group.name = `forge:${String(name || slot).slice(0, 40)}`;
    gltf.scene.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; } });
    group.add(gltf.scene);
    group.scale.setScalar(1000); // the web GLB is Y-up metres (optimize_assets.py: (x, z, -y) * 0.001); the bench is in millimetres, like an .stl
    loco.hasPhotoAccessory = false;
    if (slot === 'crown') {
      if ('crown' in customStlSlots) customStlSlots.crown = null;
      photoAccessorySlots.crown = null;
      kip.exp.customCrownContainer.clear();
      kip.exp.customCrownContainer.add(group);
      setCrownMode('custom');
    } else {
      if ('head' in customStlSlots) customStlSlots.head = null;
      kip.exp.customHeadContainer.clear();
      kip.exp.customHeadContainer.add(group);
      setHeadMode('custom');
    }
    if (!restore && glbBase64.length <= FORGE_PART_MAX_B64) saveForgePart(slot, { name: String(name || slot).slice(0, 40), colorHex: hex, glbBase64 });
    updateStatusText();
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

// Text to part, the fallback (shared/forgeFallback.ts): when a wish cannot be made, the panel offers the nearest ready-made hat or head, and this wears it with the
// bench's own setters (the ids are HAT_OPTIONS and WARDROBE_HEADS; setCrownMode and setHeadMode refuse an unknown id by falling back to a safe one, so a stale id is never a crash).
function equipReadyMade({ kind, id }) {
  try {
    if (kind === 'hat' && HAT_OPTIONS.some((h) => h.id === id)) setCrownMode(id);
    else if (kind === 'head' && WARDROBE_HEADS.some((h) => h.id === id)) setHeadMode(id);
    else return { ok: false };
    updateStatusText();
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

// The text-to-part panel (F1, kip-forge-make.js): loaded on the first click, so the bench loads the same with or without its bundle.
let forgeMake = null;
async function openForgeMake() {
  try {
    if (!forgeMake) {
      const { createForgeMake } = await import('/kip/kip-forge-make.js?v=10.0');
      if (disposed) return;
      forgeMake = createForgeMake({ root: benchRoot, onWear: equipForgePart, onReadyMade: equipReadyMade, downloads: forgeFilesOn });
      globals.kipForgeMake = forgeMake;
    }
    forgeMake.open();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'The make-from-words panel could not be loaded. Try again in a minute.';
  }
}

// The way back from the photo's colours: a small chip over the stage while a coloured library item is in the hand. `var`, not `let`: updateStatusText
// (which keeps the chip in step) runs during init, before this part of the file does.
var householdView = null; // { id, label, ctl } for the item in the hand, ctl null when it kept its own colours
var householdChip = null; // { root, text, btn }
function householdLook() {
  const held = householdView && householdSlots.hand && loco.prop === 'custom' && !customStlSlots.hand && !photoAccessorySlots.hand ? householdView : null;
  return held && held.ctl ? held.ctl.look() : null;
}
function setHouseholdLook(look) {
  if (!householdLook()) return false;
  householdView.ctl.setLook(look);
  syncHouseholdChip();
  return true;
}
function syncHouseholdChip() {
  const look = householdLook();
  if (!look) { if (householdChip) householdChip.root.hidden = true; return; }
  if (!householdChip) {
    const root = document.createElement('div');
    root.className = 'khh-chip';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', '3D item colours');
    const css = document.createElement('style');
    css.textContent = '.khh-chip{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:8px;background:rgba(251,249,245,.94);color:#1b2238;border:1px solid rgba(27,34,56,.15);border-radius:999px;padding:5px 6px 5px 14px;font:700 12.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 8px 24px rgba(27,34,56,.22)}.khh-chip[hidden]{display:none}.khh-chip button{font:inherit;color:#fff;background:#1fa97c;border:0;border-radius:999px;padding:5px 12px;cursor:pointer}';
    const text = document.createElement('span');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.addEventListener('click', () => setHouseholdLook(householdLook() === 'photo' ? 'standard' : 'photo'));
    root.append(css, text, btn);
    benchRoot.append(root);
    householdChip = { root, text, btn };
  }
  householdChip.text.textContent = `3D ${householdView.label.toLowerCase()}: ${look === 'photo' ? 'coloured from your photo' : 'its own colours'}`;
  householdChip.btn.textContent = look === 'photo' ? 'Its own colours' : 'Photo colours';
  householdChip.root.hidden = false;
}

// The print panel (F2b, kip-photo-print.js): loaded on the first click, so the bench loads the same with or without its bundle.
let photoPrint = null;
if (!downloadsOn) $el('btn-print-photo').hidden = true; // the photo plate is a file to print
$el('btn-print-photo').addEventListener('click', async () => {
  stopWebcamIfActive();
  modalPhoto.classList.remove('open');
  try {
    if (!photoPrint) {
      const { createPhotoPrint } = await import('/kip/kip-photo-print.js?v=10.0');
      if (disposed) return;
      photoPrint = createPhotoPrint({ root: benchRoot, onLibraryItem: equipHouseholdItem, ageBand: readAgeBand });
      globals.kipPhotoPrint = photoPrint;
    }
    photoPrint.open();
  } catch (err) {
    console.error(err);
    photoStatus.textContent = 'The print panel could not be loaded. Try again in a minute.';
    modalPhoto.classList.add('open');
  }
});

$el('btn-sync-hash').addEventListener('click', () => {
  const hash = encodeToyContractHash({
    head: loco.head,
    name: currentPhotoMeta?.name ? `Kip + ${currentPhotoMeta.name}` : 'Kip Custom Loadout',
    vehicle: loco.vehicle,
    hasPhotoAccessory: loco.hasPhotoAccessory,
    parts: [
      `head_${loco.head}`,
      HUMAN_HEAD_IDS.has(loco.head) ? `insert_${loco.faceInsert}` : null,
      HUMAN_HEAD_IDS.has(loco.head) ? `faceplate_${loco.expr}` : null,
      `skin_${loco.skin}`,
      loco.shirt !== 'off' ? `shirt_${loco.shirt}` : null,
      loco.pants !== 'off' ? `pants_${loco.pants}` : null,
      loco.hair !== 'off' ? `hair_${loco.hair}` : null,
      `crown_${loco.hat}`,
      loco.back !== 'off' ? `back_${loco.back}` : null,
      loco.prop !== 'off' ? `prop_${loco.prop}` : null,
      loco.vehicle !== 'none' ? `veh_${loco.vehicle}` : null,
    ].filter(Boolean),
    stats: currentPhotoMeta?.stats || { speed: 3, spin: 2, torque: 2, glow: 2 },
  });
  replaceHash(hash);
  photoStatus.innerHTML = `Synced URL <code>#toy=</code> contract (<code>prints: ${!loco.hasPhotoAccessory}</code>)!`;
});

// Unified file loader: `.stl` -> Custom PartSpec mount; `.fbx/.glb/.gltf` -> Mixamo retargeting!
async function loadCustomMixamoOrStlFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'stl') {
    await loadCustomStlFile(file);
    return;
  }
  const url = URL.createObjectURL(file);
  const baseName = file.name.replace(/\.[^.]+$/, '');
  statusEl.innerHTML = `Importing <b>${file.name}</b>…`;
  try {
    let root, clips;
    if (ext === 'fbx') {
      root = await fbxLoader.loadAsync(url);
      clips = root.animations || [];
    } else {
      const gltf = await gltfLoader.loadAsync(url);
      root = gltf.scene;
      clips = gltf.animations || [];
    }
    if (!clips.length) return;
    let firstAdded = null;
    clips.forEach((rawClip, idx) => {
      const clipKey = clips.length === 1 ? baseName : `${baseName}_${idx + 1}`;
      const baked = retargetMixamoClipToKip(rawClip, root, { name: clipKey, inPlace: false });
      if (baked) {
        actions.set(clipKey, kipMixer.clipAction(baked));
        registerClip(clipKey, clipKey);
        if (!firstAdded) firstAdded = clipKey;
      }
    });
    if (firstAdded) {
      if (loco.buildMode !== 'assembled') exitPileMode();
      loco.manualOverride = true;
      playClip(firstAdded);
    }
  } catch (err) {
    console.error(err);
  } finally {
    URL.revokeObjectURL(url);
  }
}

listen(window, 'dragover', e => { e.preventDefault(); benchRoot.classList.add('dragging'); });
listen(window, 'dragleave', e => { if (e.relatedTarget === null) benchRoot.classList.remove('dragging'); });
listen(window, 'drop', e => {
  e.preventDefault();
  benchRoot.classList.remove('dragging');
  if (e.dataTransfer.files[0]) loadCustomMixamoOrStlFile(e.dataTransfer.files[0]);
});

// --- 6. SNAP (4-8) 1-PIECE LIMB CONSTRAINTS, STANCE-PINNED ZERO-SLIP GROUNDING & EXPLODE/PILE ENGINE ---
listen(window, 'keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'h' && !e.repeat) { benchRoot.classList.toggle('clean-ui'); return; }
  if (k === 'e' && !e.repeat) { setExplodeAmount(loco.explodeTarget < 0.5 ? 1.0 : 0.0, false); return; }
  if (k === 'b' && !e.repeat) { startPileToBuild(); return; }
  if (e.code === 'Space' && loco.jumpY <= 0.01 && loco.buildMode === 'assembled') {
    loco.jumpVel = 360;
  }
  keys.add(k);
  if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) {
    if (loco.buildMode !== 'assembled') exitPileMode();
    loco.manualOverride = false;
  }
});
listen(window, 'keyup', e => keys.delete(e.key.toLowerCase()));

const snapCuffQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-11), 0, 0));
// `snap_arm.stl` already has ~15 deg of natural forward elbow bend sculpted into its rest molding;
// subtracting that rest bend when flexing keeps Snap Kip's hands aligned 1:1 with Pro Kip on steering wheels & handlebars!
const snapArmRestInvQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(15), 0, 0));
const tmpSnapQ = new THREE.Quaternion();
const tmpSnapRelQ = new THREE.Quaternion();
const tmpSnapFlexQ = new THREE.Quaternion();
const tmpSnapCuffQ = new THREE.Quaternion();
const tmpSnapVec = new THREE.Vector3();

// In Snap (`3+`) mode, physical `snap_arm.stl` & `snap_leg.stl` stay 1-piece moldings for 3D printing & Exploded/Pile views,
// while smoothly flexing mid-limb digital "fake joints" (`makeFlexSnapLimb`) during character & vehicle animations!
function applySnapJointOverrides() {
  if (!kip || loco.edition !== 'snap') return;
  const canFlex = loco.buildMode === 'assembled' && activeClipName !== 'TPose';
  const flexFactor = canFlex ? (1.0 - loco.explodeAmount) * 0.94 : 0.0;

  for (const tag of ['Left', 'Right']) {
    const arm = kip.joints[`${tag}Arm`];
    const fore = kip.joints[`${tag}ForeArm`];
    const hand = kip.joints[`${tag}Hand`];

    // Blend residual `(1 - flexFactor)` into shoulder + wrist when rigid, while `qElbow` drives smooth mid-arm flex!
    tmpSnapQ.identity().slerp(fore.quaternion, (1.0 - flexFactor) * 0.55);
    arm.quaternion.multiply(tmpSnapQ);
    hand.quaternion.premultiply(tmpSnapQ);

    tmpSnapRelQ.multiplyQuaternions(snapArmRestInvQuat, fore.quaternion);
    tmpSnapFlexQ.identity().slerp(tmpSnapRelQ, flexFactor);
    if (kip.flexArms[tag]) kip.flexArms[tag].deform(tmpSnapFlexQ);

    // Distal wrist cuff center: pivot `(0, -17.5, 1.2)` + rotated `(0, -17.5, 2.6)` (`rest = (0, -35.0, 3.8)`)
    tmpSnapVec.set(0, -17.5, 2.6).applyQuaternion(tmpSnapFlexQ);
    tmpSnapVec.y += -17.5;
    tmpSnapVec.z += 1.2;
    tmpSnapCuffQ.multiplyQuaternions(tmpSnapFlexQ, snapCuffQuat);

    if (kip.snapWriAnchors[tag]) {
      kip.snapWriAnchors[tag].position.copy(tmpSnapVec);
      kip.snapWriAnchors[tag].quaternion.copy(tmpSnapCuffQ);
    }
    fore.position.copy(tmpSnapVec);
    fore.quaternion.copy(tmpSnapCuffQ);
    hand.position.set(0, -0.5, 0);

    // Leg: smooth mid-limb knee flex around `(0, -19.6, 0.0)` + residual hip/ankle transfer when rigid!
    const upLeg = kip.joints[`${tag}UpLeg`];
    const leg = kip.joints[`${tag}Leg`];
    const foot = kip.joints[`${tag}Foot`];

    tmpSnapQ.identity().slerp(leg.quaternion, (1.0 - flexFactor) * 0.35);
    upLeg.quaternion.multiply(tmpSnapQ);
    foot.quaternion.premultiply(tmpSnapQ);

    tmpSnapFlexQ.identity().slerp(leg.quaternion, flexFactor);
    if (kip.flexLegs[tag]) kip.flexLegs[tag].deform(tmpSnapFlexQ);

    // Distal ankle cuff center: pivot `(0, -19.6, 0.0)` + rotated `(0, -19.6, 0.0)` (`rest = (0, -39.2, 0.0)`)
    tmpSnapVec.set(0, -19.6, 0.0).applyQuaternion(tmpSnapFlexQ);
    tmpSnapVec.y += -19.6;

    if (kip.snapAnkAnchors[tag]) {
      kip.snapAnkAnchors[tag].position.copy(tmpSnapVec);
      kip.snapAnkAnchors[tag].quaternion.copy(tmpSnapFlexQ);
    }
    leg.position.copy(tmpSnapVec);
    leg.quaternion.copy(tmpSnapFlexQ);
    foot.position.set(0, -0.4, -1.5);
  }
}

const SOLE_PROBES = [
  new THREE.Vector3(-7, -13.6, -8),
  new THREE.Vector3( 7, -13.6, -8),
  new THREE.Vector3(-7, -13.6, 16),
  new THREE.Vector3( 7, -13.6, 16),
];
const SOLE_CENTER = new THREE.Vector3(0, -13.6, 3.0);
const probeWorld = new THREE.Vector3();
const soleLocalL = new THREE.Vector3();
const soleLocalR = new THREE.Vector3();
const moverInvMat = new THREE.Matrix4();

// Zero-Slip Stance-Foot Pinning + Exact Vertical Sole / Vehicle / Skateboard Grounding!
// Returns world (dx, dz) root displacement driven by Kip's planted stance sneaker or active vehicle!
function pinAndGroundKipFeet(isLocomoting, dt = 0) {
  const lift = loco.jumpY + loco.explodeAmount * 64;

  // --- V2 VEHICLE SEATED / STRADDLE GROUNDING (`car`, `truck`, `scooter`, `moto`) ---
  if (loco.vehicle !== 'none') {
    if (loco.vehicle === 'car') {
      kip.grounder.position.set(0, -23.2 + lift, -1.5);
    } else if (loco.vehicle === 'truck') {
      kip.grounder.position.set(0, -19.2 + lift, -1.5);
    } else {
      // V2 2-Wheel Inline Motor Scooter & Sport Motorbike (`bikeY = 11.75`, rear saddle at `y = 38.25, z = -25.0`)
      kip.grounder.position.set(0, -10.2 + lift, -22.5);
    }
    kip.grounder.rotation.z = (loco.vehicle === 'scooter' || loco.vehicle === 'moto')
      ? kip.exp.bikeLeanGroup.rotation.z
      : 0;
    kip.exp.carGroup.position.y   = loco.jumpY;
    kip.exp.truckGroup.position.y = loco.jumpY;
    kip.exp.bikeGroup.position.y  = loco.jumpY;

    loco.hasPrevStance = false;
    const dForward = loco.driveSpeed * dt * loco.speedScale;
    return {
      stepDx: Math.sin(loco.heading) * dForward,
      stepDz: Math.cos(loco.heading) * dForward,
      dDist: dForward,
    };
  }

  kip.grounder.rotation.z = 0;
  kip.grounder.position.set(0, 0, 0);
  kip.mover.updateMatrixWorld(true);
  moverInvMat.copy(kip.mover.matrixWorld).invert();

  let minYL = Infinity, minYR = Infinity;
  for (const p of SOLE_PROBES) {
    probeWorld.copy(p).applyMatrix4(kip.joints.LeftFoot.matrixWorld);
    if (probeWorld.y < minYL) minYL = probeWorld.y;
    probeWorld.copy(p).applyMatrix4(kip.joints.RightFoot.matrixWorld);
    if (probeWorld.y < minYR) minYR = probeWorld.y;
  }
  const minY = Math.min(minYL, minYR);

  soleLocalL.copy(SOLE_CENTER).applyMatrix4(kip.joints.LeftFoot.matrixWorld).applyMatrix4(moverInvMat);
  soleLocalR.copy(SOLE_CENTER).applyMatrix4(kip.joints.RightFoot.matrixWorld).applyMatrix4(moverInvMat);

  let stepDx = 0, stepDz = 0, dDist = 0;

  if (loco.prop === 'skateboard') {
    // Skateboard deck top studs sit at y = 16.25 mm above floor!
    loco.hasPrevStance = false;
    const wSum = 2.0;
    kip.grounder.position.x = -(soleLocalL.x + soleLocalR.x) / wSum;
    kip.grounder.position.z = -(soleLocalL.z + soleLocalR.z) / wSum;
    if (Number.isFinite(minY)) {
      kip.grounder.position.y = -minY + 16.25 + lift;
    }
    kip.exp.skateboardGroup.position.y = loco.jumpY;
    dDist = loco.driveSpeed * dt * loco.speedScale;
    stepDx = Math.sin(loco.heading) * dDist;
    stepDz = Math.cos(loco.heading) * dDist;
    return { stepDx, stepDz, dDist };
  }

  if (isLocomoting && loco.jumpY <= 0.05) {
    // Pick whichever sneaker is currently planted lowest on the floor (with 0.5 mm hysteresis)
    const hL = minYL - minY;
    const hR = minYR - minY;
    if (loco.stanceIdx === 0 && hR < hL - 0.5) loco.stanceIdx = 1;
    else if (loco.stanceIdx === 1 && hL < hR - 0.5) loco.stanceIdx = 0;

    const curSole = loco.stanceIdx === 0 ? soleLocalL : soleLocalR;
    if (loco.hasPrevStance && loco.prevStanceIdx === loco.stanceIdx) {
      // As the planted foot sweeps backward (-Z in mover space), advance mover forward by the EXACT same distance!
      const dForward = THREE.MathUtils.clamp(-(curSole.z - loco.prevStanceLocal.z), 0, 35);
      dDist = dForward;
      stepDx = Math.sin(loco.heading) * dForward;
      stepDz = Math.cos(loco.heading) * dForward;
    }
    loco.prevStanceIdx = loco.stanceIdx;
    loco.prevStanceLocal.copy(curSole);
    loco.hasPrevStance = true;
  } else {
    loco.hasPrevStance = false;
    // Stationary clips: keep weighted stance midpoint horizontally anchored inside mover so sways never skate!
    if (activeClipName !== 'SambaDance' && loco.jumpY <= 0.05) {
      // A clip with its feet already planted gets EQUAL weights. The weighting below follows whichever foot is lower, which is right for a clip whose feet slip; for a planted
      // clip it is the cause of slipping: each time a foot lifts the weights swing, the body jumps toward the planted foot (up to 8 mm in a frame) and that foot slides about
      // 20 mm across the floor. The midpoint of two feet that stay put does not move, so equal weights hold the body still over them.
      const planted = plantedClips.has(activeClipName);
      const wL = planted ? 1 : Math.exp(-Math.max(0, minYL - minY) * 0.6);
      const wR = planted ? 1 : Math.exp(-Math.max(0, minYR - minY) * 0.6);
      const wSum = wL + wR;
      if (wSum > 1e-4) {
        kip.grounder.position.x = -(soleLocalL.x * wL + soleLocalR.x * wR) / wSum;
        kip.grounder.position.z = -(soleLocalL.z * wL + soleLocalR.z * wR) / wSum;
      }
    }
  }

  if (Number.isFinite(minY)) {
    kip.grounder.position.y = -minY + lift;
  }
  return { stepDx, stepDz, dDist };
}

// Apply Exploded View OR Tabletop Pile -> Build transforms to all leaf partSlots!
const tmpTargetW = new THREE.Vector3();
const tmpParentQ = new THREE.Quaternion();
const tmpCurWPos = new THREE.Vector3();
const tmpCurWQuat = new THREE.Quaternion();
const slotCenterMap = new Map();
const tmpBox = new THREE.Box3();

function updateExplodeAndPileTransforms(dt) {
  // Fast path: normal assembled character
  if (loco.buildMode === 'assembled' && loco.explodeAmount <= 0.001) {
    explodeLines.visible = false;
    return;
  }

  // First reset all leaf partSlots to rest identity to measure exact assembled world transforms!
  for (const s of kip.partSlots) {
    s.grp.position.set(0, 0, 0);
    s.grp.quaternion.identity();
  }
  kip.mover.updateMatrixWorld(true);

  for (const s of kip.partSlots) {
    s.grp.getWorldPosition(s.assembledWorldPos);
    s.grp.getWorldQuaternion(s.assembledWorldQuat);
  }

  if (loco.buildMode === 'pile' || loco.buildMode === 'building') {
    explodeLines.visible = false;
    if (loco.buildMode === 'building') {
      loco.buildTime += dt * loco.speedScale;
      if (loco.buildTime >= loco.buildTotalDur) {
        exitPileMode();
        loco.jumpVel = 230; // celebratory snap-together hop!
        loco.manualOverride = true;
        playClip(loco.vehicle !== 'none' ? getDefaultRestClip() : 'HeroWave', 0.15);
        return;
      }
    }

    for (const s of kip.partSlots) {
      if ((s.edition !== 'both' && s.edition !== loco.edition) || !slotIsEffectivelyVisible(s)) continue;
      const u = loco.buildMode === 'pile'
        ? 0
        : THREE.MathUtils.clamp((loco.buildTime - s.t0) / s.dur, 0, 1);

      if (u >= 0.999) continue; // already snapped into exact assembled seat!

      // Smooth cubic ease + crisp final snap-click overshoot!
      const ease = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const snapRecoil = Math.sin(u * Math.PI) * (u > 0.78 ? Math.sin((u - 0.78) / 0.22 * Math.PI) * 0.04 : 0);
      const blend = Math.min(1, ease + snapRecoil);

      // Interpolate geometric center-of-mass along hop arc so every piece spins cleanly around its own center!
      tmpTargetW.copy(s.localCentroid).applyQuaternion(s.assembledWorldQuat).add(s.assembledWorldPos);
      tmpCurWPos.lerpVectors(s.pileCentroid, tmpTargetW, blend);
      tmpCurWPos.y += Math.sin(Math.PI * u) * (32 + s.arcExtra);
      tmpCurWQuat.slerpQuaternions(s.pileQuat, s.assembledWorldQuat, ease);
      tmpTargetW.copy(s.localCentroid).applyQuaternion(tmpCurWQuat);
      tmpCurWPos.sub(tmpTargetW);

      s.parent.updateMatrixWorld(true);
      s.grp.position.copy(s.parent.worldToLocal(tmpCurWPos.clone()));
      s.parent.getWorldQuaternion(tmpParentQ);
      s.grp.quaternion.copy(tmpParentQ.invert().multiply(tmpCurWQuat));
    }
    return;
  }

  // Exploded View mode: offset each active leaf partSlot along its true physical assembly vector!
  slotCenterMap.clear();
  for (const s of kip.partSlots) {
    if ((s.edition !== 'both' && s.edition !== loco.edition) || !slotIsEffectivelyVisible(s)) continue;
    tmpTargetW.copy(s.explodeVec).multiplyScalar(loco.explodeAmount * 0.76).applyQuaternion(kip.mover.quaternion);
    tmpCurWPos.copy(s.assembledWorldPos).add(tmpTargetW);
    s.grp.position.copy(s.parent.worldToLocal(tmpCurWPos.clone()));
    s.grp.updateMatrixWorld(true);
    tmpBox.setFromObject(s.grp);
    if (!tmpBox.isEmpty()) {
      slotCenterMap.set(s.id, tmpBox.getCenter(new THREE.Vector3()));
    }
  }

  // Update dashed Coral Spark assembly guide lines!
  const torsoId = loco.edition === 'pro' ? 'torso_pro' : 'torso_snap';
  const neckId  = 'neck_turret_2x1';
  slotCenterMap.set('torso_anchor', slotCenterMap.get(torsoId) || kip.hips.getWorldPosition(new THREE.Vector3()));
  slotCenterMap.set('neck_anchor',  slotCenterMap.get(neckId)  || kip.hips.getWorldPosition(new THREE.Vector3()));

  let segCount = 0;
  for (const s of kip.partSlots) {
    if (!s.guideTo || !slotCenterMap.has(s.id) || !slotCenterMap.has(s.guideTo)) continue;
    const a = slotCenterMap.get(s.id);
    const b = slotCenterMap.get(s.guideTo);
    const base = segCount * 6;
    if (base + 5 >= explodeLinePositions.length) break;
    explodeLinePositions[base + 0] = a.x; explodeLinePositions[base + 1] = a.y; explodeLinePositions[base + 2] = a.z;
    explodeLinePositions[base + 3] = b.x; explodeLinePositions[base + 4] = b.y; explodeLinePositions[base + 5] = b.z;
    segCount++;
  }
  explodeLineGeo.setDrawRange(0, segCount * 2);
  explodeLineGeo.attributes.position.needsUpdate = true;
  explodeLines.computeLineDistances();
  explodeLines.visible = segCount > 0;
}

const clock = new THREE.Clock();
const camForward = new THREE.Vector3();
const camRight = new THREE.Vector3();
const moveDir = new THREE.Vector3();

let frameCount = 0;
const isScreenshotMode = params.get('screenshot') === '1';

function animate() {
  if (disposed) return;
  if (!hosted && (!isScreenshotMode || frameCount < 4)) {
    raf = requestAnimationFrame(animate);
  }
  frameCount++;
  const dt = isScreenshotMode ? 0.0 : Math.min(clock.getDelta(), 0.05);
  loco.animClock += dt * loco.speedScale;

  let ix = 0, iz = 0;
  if (loco.buildMode === 'assembled') {
    if (keys.has('w') || keys.has('arrowup'))    iz += 1;
    if (keys.has('s') || keys.has('arrowdown'))  iz -= 1;
    if (keys.has('a') || keys.has('arrowleft'))  ix -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
  }

  const isRunning = keys.has('shift');
  const keyMoving = (ix !== 0 || iz !== 0);
  const inVehicle = loco.vehicle !== 'none';
  const onSkate   = !inVehicle && loco.prop === 'skateboard';

  let headingTurnRate = 0;
  if (keyMoving) {
    camera.getWorldDirection(camForward);
    camForward.y = 0;
    camForward.normalize();
    camRight.crossVectors(camForward, THREE.Object3D.DEFAULT_UP).normalize();
    moveDir.set(0, 0, 0).addScaledVector(camForward, iz).addScaledVector(camRight, ix).normalize();

    const targetHeading = Math.atan2(moveDir.x, moveDir.z);
    let diff = targetHeading - loco.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    headingTurnRate = THREE.MathUtils.clamp(diff, -1.2, 1.2);
    loco.heading += diff * Math.min(1, dt * (inVehicle ? 6.5 : 12));
    kip.mover.rotation.y = loco.heading;

    if (inVehicle || onSkate) {
      const topSpeed = isRunning ? 310 : 195;
      loco.driveSpeed += (topSpeed - loco.driveSpeed) * Math.min(1, dt * 7.5);
      playClip(getDefaultRestClip(), 0.16);
    } else {
      playClip(isRunning ? 'run' : 'walk', 0.16);
    }
  } else {
    // Allow clicking Walk / Run buttons while in a vehicle or on skateboard to cruise forward automatically!
    const autoCruise = (inVehicle || onSkate) && (activeClipName === 'walk' || activeClipName === 'run');
    const targetSpeed = autoCruise ? (activeClipName === 'run' ? 280 : 165) : 0;
    loco.driveSpeed += (targetSpeed - loco.driveSpeed) * Math.min(1, dt * 6.0);
    if (Math.abs(loco.driveSpeed) < 0.5) loco.driveSpeed = 0;

    const restClip = getDefaultRestClip();
    if (!loco.manualOverride && activeClipName !== restClip && loco.buildMode === 'assembled') {
      playClip(restClip, 0.22);
    }
  }

  // Smooth steering wheel / handlebar turn + dynamic 2-wheel lean!
  loco.steerAngle += (headingTurnRate * 0.48 - loco.steerAngle) * Math.min(1, dt * 10);
  kip.exp.carSteerPivot.rotation.y   = loco.steerAngle * 1.1;
  kip.exp.truckSteerPivot.rotation.y = loco.steerAngle * 1.1;
  kip.exp.bikeForkPivot.rotation.y   = loco.steerAngle * 0.85;
  kip.exp.bikeLeanGroup.rotation.z   = -loco.steerAngle * (loco.vehicle === 'moto' ? 0.52 : 0.36);

  // Hop physics
  if (loco.jumpY > 0 || loco.jumpVel !== 0) {
    loco.jumpY += loco.jumpVel * dt;
    loco.jumpVel -= 1150 * dt;
    if (loco.jumpY <= 0) { loco.jumpY = 0; loco.jumpVel = 0; }
  }

  // Smooth springy interpolation toward explodeTarget BEFORE Snap flex & foot grounding!
  const prevExplode = loco.explodeAmount;
  loco.explodeAmount += (loco.explodeTarget - loco.explodeAmount) * Math.min(1, dt * 9.5);
  if (Math.abs(loco.explodeTarget - loco.explodeAmount) < 0.001) loco.explodeAmount = loco.explodeTarget;
  if (Math.abs(prevExplode - loco.explodeAmount) > 0.005) updateStatusText();

  // Advance skeletal animation + Snap 3+ digital fake-joint limb flex
  const mixerDt = (loco.buildMode === 'assembled') ? dt : 0;
  partyApi?.update(dt); // party mode holds its dance at the song's beat BEFORE the mixer evaluates it
  if (kipMixer) kipMixer.update(mixerDt);
  if (refMixer) refMixer.update(mixerDt);
  applySnapJointOverrides();

  // Zero-slip stance-foot pinning or Vehicle/Skateboard propulsion!
  const isLocomoting = (loco.buildMode === 'assembled') && (keyMoving || LOCO_CLIPS.has(activeClipName) || Math.abs(loco.driveSpeed) > 2);
  const { stepDx, stepDz, dDist } = pinAndGroundKipFeet(isLocomoting, dt);

  // Physically accurate wheel rotation (`dTheta = dDist / R` around local X)!
  if (dDist !== 0) {
    if (loco.vehicle === 'car') {
      for (const w of kip.exp.carWheels) w.rotation.x += dDist / 18.0;
    } else if (loco.vehicle === 'truck') {
      for (const w of kip.exp.truckWheels) w.rotation.x += dDist / 22.0;
    } else if (loco.vehicle === 'scooter' || loco.vehicle === 'moto') {
      for (const w of kip.exp.bikeWheels) w.rotation.x += dDist / 18.0;
    } else if (onSkate) {
      for (const w of kip.exp.skateWheels) w.rotation.x += dDist / 9.0;
    }
  }

  if (stepDx !== 0 || stepDz !== 0) {
    kip.mover.position.x += stepDx;
    kip.mover.position.z += stepDz;
    controls.target.x += stepDx;
    controls.target.z += stepDz;
    camera.position.x += stepDx;
    camera.position.z += stepDz;
  }

  // Keep world-aligned 100 mm TU grid centered seamlessly under Kip forever (zero visual grid jump!)
  const gx = Math.round(kip.mover.position.x / 100) * 100;
  const gz = Math.round(kip.mover.position.z / 100) * 100;
  minorGrid.position.x = gx; minorGrid.position.z = gz;
  majorGrid.position.x = gx; majorGrid.position.z = gz;
  floorShadow.position.x = gx; floorShadow.position.z = gz;

  keyLight.position.set(kip.mover.position.x + 170, 260, kip.mover.position.z + 175);
  keyLight.target.position.copy(kip.mover.position);

  if (refSkeletonGroup && refSkeletonGroup.visible) {
    refSkeletonGroup.position.set(kip.mover.position.x - 115, 0, kip.mover.position.z);
    refSkeletonGroup.rotation.y = loco.heading;
  }

  // Secondary accessory motion (Pro gears, tail wag, and Photo-to-Accessory flapping wings!)
  const spinRate = (isLocomoting ? (activeClipName === 'run' ? 4.5 : 2.4) : 0.9) * dt * loco.speedScale;
  if (kip.proBackGroup.visible) {
    kip.gearBig.rotation.z += spinRate;
    kip.gearSml.rotation.z -= spinRate * 2.0;
  }
  if (kip.proStaffGroup.visible) kip.tipGear.rotation.z += spinRate * 2.5;
  if (kip.proTailGroup.visible)  kip.tailWheel.rotation.z += (isLocomoting ? 5.5 : 0.6) * dt * loco.speedScale;
  if (kip.snapTailGroup.visible) {
    const isSad = (activeClipName === 'sad_pose');
    const wagAmp = isSad ? 0.06 : (isLocomoting || activeClipName === 'HeroWave' || activeClipName === 'SambaDance' ? 0.28 : 0.14);
    const wagFreq = isSad ? 1.6 : (activeClipName === 'run' ? 9.0 : 5.2);
    kip.snapTailPivot.rotation.y = Math.sin(loco.animClock * wagFreq) * wagAmp;
    kip.snapTailPivot.rotation.x = isSad ? -0.45 : -0.22;
  }
  if (loco.photoWingGroup && loco.photoWingGroup.userData.leftPivot) {
    const flapFreq = isLocomoting ? 8.5 : 3.4;
    const flapAmp = isLocomoting ? 0.42 : 0.20;
    const ang = Math.sin(loco.animClock * flapFreq) * flapAmp;
    loco.photoWingGroup.userData.leftPivot.rotation.y  =  0.22 + ang;
    loco.photoWingGroup.userData.rightPivot.rotation.y = -0.22 - ang;
  }

  // Apply Exploded View or Tabletop Part-Pile -> Build choreography
  updateExplodeAndPileTransforms(dt);

  controls.update();
  renderer.render(scene, camera);
}

if (!hosted) { // a hosted bench is sized by the stage
  listen(window, 'resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// --- SIDE MENU: the page's only control surface (it replaced the bottom dock; kip-menu.js DOCK_PARITY maps every old control) ---
// The panel owns no state: it re-reads `loco` (and the few readers below) every tick and calls the same
// setters the dock buttons call. The adapter below is the only place it touches this script's scope.
// Plate view: the character's parts packed flat for printing (kip-print.js does the maths, this just feeds it).
const getPrintState = () => ({
  edition: loco.edition,
  category: loco.category,
  head: loco.head,
  faceInsert: loco.faceInsert,
  expr: loco.expr,
  selfie: loco.expr === 'selfie',
  skin: loco.skin,
  shirt: loco.shirt,
  pants: loco.pants,
  hair: loco.hair,
  hairColor: loco.hairColor,
  hat: loco.hat,
  hatColor: loco.hatColor,
  back: loco.back,
  prop: loco.prop,
  vehicle: loco.vehicle,
  vehCovers: loco.vehCovers,
  racerKit: loco.racerKit,
  tail: tailModes[tailIdx],
  hasPhotoAccessory: loco.hasPhotoAccessory,
  customHoodMode,
  customStlSlots: { ...customStlSlots },
  photoAccessorySlots: { ...photoAccessorySlots },
  baseColors: Object.fromEntries(
    Object.entries(mats).map(([k, m]) => [k, `#${m.color.getHexString(THREE.SRGBColorSpace)}`])
  ),
});
const canvasToRgba = (c) => {
  if (!c || !c.width || !c.height) return null;
  const g = c.getContext('2d');
  if (!g) return null;
  return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
};
const renderStickerSources = (state, bom, bonusExprs = []) => {
  const out = {};
  const skinObj = SKIN_TONES.find(s => s.id === state.skin) || SKIN_TONES[0];
  for (const dec of bom?.decals || []) {
    if (dec.kind === 'selfie_face') {
      out['face:selfie'] = canvasToRgba(createDecalExpressionCanvas('selfie', state.head, 'flat', { onPlate: true }));
      for (const bExpr of bonusExprs) {
        out[`face:${bExpr}:flat`] = canvasToRgba(createDecalExpressionCanvas(bExpr, state.head, 'flat', { onPlate: true }));
      }
    } else if (dec.kind === 'human_face') {
      const ins = dec.faceInsert || 'sculpted';
      out[`face:${dec.expr || 'spark'}:${ins}`] = canvasToRgba(createDecalExpressionCanvas(dec.expr || 'spark', state.head, ins, { onPlate: true }));
      if (ins === 'flat') {
        for (const bExpr of bonusExprs) {
          out[`face:${bExpr}:flat`] = canvasToRgba(createDecalExpressionCanvas(bExpr, state.head, 'flat', { onPlate: true }));
        }
      }
    } else if (dec.kind === 'creature_face') {
      const hd = dec.head || state.head || 'fox';
      out[`creature:${hd}:${dec.expr || 'spark'}`] = canvasToRgba(createDecalExpressionCanvas(dec.expr || 'spark', hd, 'sculpted', { onPlate: false }));
    } else if (dec.kind === 'shirt') {
      out[`shirt:${dec.shirtId}`] = canvasToRgba(createTorsoOutfitDecalCanvas(dec.shirtId, state.pants || 'off', skinObj.hex));
    } else if (dec.kind === 'craft_cutout') {
      const raw = canvasToRgba(photoSrcCanvas);
      if (raw && currentPhotoSeg?.mask && currentPhotoSeg.w === raw.w && currentPhotoSeg.h === raw.h) {
        const masked = new Uint8ClampedArray(raw.data);
        for (let i = 0; i < currentPhotoSeg.mask.length; i++) {
          if (!currentPhotoSeg.mask[i]) masked[i * 4 + 3] = 0;
        }
        out[`craft:${dec.slot || 'hand'}`] = { w: raw.w, h: raw.h, data: masked };
      } else if (raw) {
        out[`craft:${dec.slot || 'hand'}`] = raw;
      }
    }
  }
  return out;
};
// Print: hosted in the Workshop the view is the shell's ONE (`env.sharedPrint`) and this bench offers it its source (stage 4c); mounted on its own the bench mounts its own.
const printSource = {
  scene,
  getState: getPrintState,
  renderStickerSources,
  setCharacterVisible: on => { kip.mover.visible = on; originRing.visible = on; },
};
const sharedPrint = env.sharedPrint ?? null;
const printView = sharedPrint ? sharedPrint.view : mountPrintView({ THREE, camera, controls, ...printSource });
const unregisterPrint = sharedPrint ? sharedPrint.register('kip', printSource) : null;
globals.kipPrint = printView;
globals.kipRig = () => ({ THREE, kip, mats });
// Test and contact-sheet hook for kip-clips.js: freeze the rig at time t of a clip (a registered id, or an AnimationClip the caller built). Not used by the page.
globals.kipClips = {
  entries: KIP_CLIPS,
  scrub(clipOrId, t) {
    const id = typeof clipOrId === 'string' ? clipOrId : clipOrId.name;
    if (!actions.has(id)) actions.set(id, kipMixer.clipAction(clipOrId));
    triggerClip(id); // the menu's own path: it sets manualOverride, without which the loop snaps back to the rest clip next frame
    const a = actions.get(id);
    for (const [k, other] of actions) if (k !== id) other.stop();
    a.paused = true; a.time = t; a.setEffectiveWeight(1);
    kipMixer.update(0);
    return id;
  },
};
// Party mode (parts/kip/viewer/kip-party.js; docs/specs/dance-party-spec.md phase 3): a practice beat, Kip in the headphones dancing ON the beat, the cups and the
// floor ring flashing on it, and tap-along by age band. The bench only supplies what it owns (the rig); the decisions are pure and tested.
function readAgeBand() { // the band a grown-up set (src/lib/age.ts, stored in progression:v1); none chosen reads as the youngest
  try {
    const b = JSON.parse(localStorage.getItem('progression:v1') || 'null')?.ageBand;
    return Number.isInteger(b) && b >= 0 && b <= 5 ? b : 0;
  } catch { return 0; }
}
const PARTY_HUES = [0.92, 0.55, 0.14, 0.36]; // the cups change colour with each beat of the bar
// "My songs": the theme songs a child made in Describe & build, measured in the page (kip-my-songs.js) and offered in the Song picker beside the starter library.
const mySongs = createMySongs({ onChange: () => { partyApi?.refreshSongs?.(); } });
globals.kipMySongs = mySongs;
partyApi = mountParty({
  AudioContextClass: window.AudioContext || window.webkitAudioContext,
  stage: renderer.domElement,
  band: readAgeBand,
  // the starter library (public/kip/songs/, scripts/song-ingest.ts) plus the child's own songs: the party checks the index before it plays anything from it
  loadSongIndex: async () => {
    const r = await fetch('/kip/songs/index.json').catch(() => null);
    const base = r && r.ok ? await r.json().catch(() => null) : null;
    const mine = mySongs.entries();
    if (!mine.length) return base;
    return { v: 1, ...(base && typeof base === 'object' ? base : {}), songs: [...(Array.isArray(base?.songs) ? base.songs : []), ...mine] };
  },
  loadSongData: async (file) => {
    if (String(file).startsWith('my_')) return mySongs.data(file);   // a theme song: cut to its bars in the page, never a file of ours
    const r = await fetch(`/kip/songs/${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(`song ${file}: HTTP ${r.status}`);
    return r.arrayBuffer();
  },
  dances: () => danceTempos,
  label: id => (clipChoices.find(c => c.id === id) || {}).label || id,
  playClip: id => triggerClip(id),
  holdClip: (id, t) => { const a = actions.get(id); if (a) { a.paused = true; a.time = t; } },
  releaseClip: id => { const a = actions.get(id); if (a) a.paused = false; loco.manualOverride = false; },
  activeClip: () => activeClipName,
  headphones: {
    wear() { // false on a head that cannot wear them: the party is then lights only
      const before = { hat: loco.hat, hair: loco.hair };
      setCrownMode('headphones');
      if (loco.hat !== 'headphones') return false;
      partyCrownBefore = before;
      return true;
    },
    restore() {
      const b = partyCrownBefore;
      partyCrownBefore = null;
      if (!b) return;
      setCrownMode(b.hat);
      if (loco.hair !== b.hair) setHairMode(b.hair);
    },
  },
  glow(level, beatIndex) {
    const m = kip?.exp?.hatMeshes?.headphones?.material;
    if (!m) return;
    if (level <= 0) { m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 0; return; }
    if (loco.hat !== 'headphones') return;
    m.emissive.setHSL(PARTY_HUES[((beatIndex % 4) + 4) % 4], 1, 0.55);
    m.emissiveIntensity = 1.4 * level;
  },
  ring(level, downbeat) {
    originRing.material.opacity = 0.45 + 0.45 * level;
    const k = 1 + (downbeat ? 0.14 : 0.07) * level;
    originRing.scale.set(k, k, 1);
  },
});
globals.kipParty = partyApi;
// Describe & build (parts/kip/viewer/kip-describe-contract.md): type what to build, see it as an exploded view, watch it go together. It owns its panel
// and toggle button and draws in its own group; while it is open the character is hidden. `kip` is only set once init() has run, hence the guard.
const describeTab = mountDescribe({
  THREE, STLLoader, mergeVertices, toCreasedNormals, scene, camera, controls, container: benchRoot,
  themeOptions: { onSong: song => mySongs.add(song) },   // a new theme song is measured at once, so it is in the party's Song picker when the child gets there
  setCharacterVisible: on => { if (kip) kip.mover.visible = on; originRing.visible = on; },
});
globals.kipDescribe = describeTab;
mySongs.catchUp().catch(() => { /* songs made before, measured quietly in the background; a failure just leaves them off the picker */ });
// Selfie face (memory only, never in the URL or storage): wears a photo on the flat face insert and puts the
// previous face back on Remove. Anything that would leave a human head first removes it, so a photo never lingers.
let selfieBefore = null;
const selfie = mountSelfie({
  root: benchRoot,
  downloads: downloadsOn,
  askGrownUp,
  cloud: env.features?.cloud ?? undefined,
  plateColor: () => (SKIN_TONES.find(s => s.id === loco.skin) || SKIN_TONES[0]).hex,
  apply: canvas => {
    if (loco.expr !== 'selfie') selfieBefore = { expr: loco.expr, insert: loco.faceInsert };
    setSelfieCanvas(canvas);
    loco.expr = 'selfie';
    setFaceInsertMode('flat');
  },
  restore: () => {
    setSelfieCanvas(null);
    if (loco.expr === 'selfie') loco.expr = selfieBefore?.expr ?? 'spark';
    setFaceInsertMode(selfieBefore?.insert ?? 'sculpted');
    selfieBefore = null;
  },
});
globals.kipSelfie = selfie;
const leaveSelfie = () => { if (loco.expr === 'selfie') selfie.remove(); };
// The menu: one panel for every bench (stage 4c). Hosted, the Workshop's panel (`env.sharedMenu`) shows this bench's declaration while it is active; mounted on its own the bench has its own.
const kipMenuCtx = {
  loco,
  camera,
  viewSize: () => (hosted ? stage.size() : { width: window.innerWidth, height: window.innerHeight }),
  isActive: () => active,
  selfie: { open: selfie.open, remove: selfie.remove },
  party: partyApi.menu,
  print: {
    isOn: printView.isOn, busy: printView.isBusy, summary: printView.summary,
    setOn: on => (on ? printView.enter() : printView.exit()),
    plateCount: printView.plateCount, plateIndex: printView.plateIndex,
    plateLabel: printView.plateLabel, setPlate: printView.setPlate,
    profile: printView.profile, setPreset: printView.setPreset, updateProfile: printView.updateProfile,
    supportCheck: printView.supportCheck, setSupportCheck: printView.setSupportCheck,
    splitByColour: printView.splitByColour, setSplitByColour: printView.setSplitByColour,
    download: printView.download,
  },
  ready: () => globals.__KIP_READY__ === true,
  speeds,
  presets: presets.map(id => ({ id, label: presetLabels[id] })),
  clips: () => clipChoices,
  read: {
    tail: () => tailModes[tailIdx],
    preset: () => presets[presetIdx],
    speed: () => loco.speedScale,
    clip: () => activeClipName,
    refOn: () => refSkeletonGroup?.visible === true,
    explodeOn: () => loco.explodeTarget >= 0.5,
    pileOn: () => loco.buildMode === 'pile',
    household: () => (loco.prop === 'custom' && !customStlSlots.hand && !photoAccessorySlots.hand && householdSlots.hand ? { ...householdSlots.hand } : null), // only while it is the thing in the hand
    householdLook,
    householdMode: () => (householdLook() ? householdView.ctl.mode : null),
  },
  act: {
    setCategory: id => { if (id !== 'human') leaveSelfie(); setCategoryMode(id); },
    setHead: id => {
      if (!HUMAN_HEAD_IDS.has(id)) leaveSelfie();
      setHeadMode(id);
      // Stepping onto the chibi head switches to the vinyl insert; a photo must stay on the flat one.
      if (loco.expr === 'selfie' && loco.faceInsert !== 'flat') setFaceInsertMode('flat');
    },
    setFace: id => { leaveSelfie(); setFaceMode(id); },
    setFaceInsert: id => { if (id !== 'flat') leaveSelfie(); setFaceInsertMode(id); }, setSkin: setSkinTone, setHair: setHairMode,
    setHairColor, setHat: setCrownMode, setHatColor, setShirt: setShirtMode,
    setPants: setPantsMode, setBack: setBackMode, setTail: setTailMode,
    setProp: setPropMode, setVehicle: id => setVehicleMode(id, true),
    setCovers: setVehicleCovers, setRacerKit, setEdition, applyPreset: name => { leaveSelfie(); applyPreset(name); },
    playClip: triggerClip, setSpeed: setSpeedScale,
    toggleExplode, setExplode: v => setExplodeAmount(v, true), togglePile: togglePartPile,
    startBuild: () => startPileToBuild(true), toggleRef: toggleRefSkeleton,
    openLlm: () => modalLlm.classList.add('open'),
    openPhoto: openPhotoModal,
    openForgeMake,
    loadFile: loadCustomMixamoOrStlFile,
    equipHousehold: equipHouseholdItem,
    setHouseholdLook,
  },
};
if (!printOn) delete kipMenuCtx.print; // no Print group in the menu
const sharedMenu = env.sharedMenu ?? null;
const menuHost = sharedMenu ?? createMenuHost();
// The published handle is the panel's, except that `.ctx` stays THIS bench's (its loco, read and act) even while another bench holds the shared panel.
const showMenu = () => { globals.kipMenu = Object.create(menuHost.show('kip', kipMenuCtx, { root: benchRoot }), { ctx: { get: () => kipMenuCtx, enumerable: true } }); };
if (!hosted) showMenu(); // hosted: setActive() shows it when this bench becomes the active one

const ready = init().catch(err => {
  console.error(err);
  statusEl.textContent = `Error: ${err.message}`;
});

const PUBLISHED = ["__KIP_READY__", "kipClips", "kipDescribe", "kipForgeMake", "kipMenu", "kipParty", "kipPhotoPrint", "kipPrint", "kipRig", "kipSelfie"];
function teardown() {
  householdChip?.root.remove();
  householdChip = null;
  unregisterKipSync?.();
  unregisterKipSync = null;
  unregisterKipPrintState?.();
  unregisterKipPrintState = null;
  kipSession.releaseRef('kip');
  if (sharedMenu) sharedMenu.hide('kip'); else menuHost.destroy();
  partyApi?.dispose();
  partyApi = null;
  globals.kipSelfie?.dispose?.();
  globals.kipDescribe?.dispose?.();
  if (sharedPrint) unregisterPrint(); else globals.kipPrint?.dispose?.();
  photoPrint?.dispose?.();
  photoPrint = null;
  forgeMake?.dispose?.();
  forgeMake = null;
  webcamStream?.getTracks().forEach((t) => t.stop());
  disposeThreeScene({ scene, renderer: hosted ? null : renderer, controls: hosted ? null : controls, pmrem });
}
function dispose() {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(raf);
  for (const off of offs.splice(0)) off();
  teardown();
  for (const name of PUBLISHED) delete globals[name];
  if (hosted) {
    if (active) { camera.clearViewOffset(); camera.updateProjectionMatrix(); }
    if (benchRoot.contains(renderer.domElement)) renderer.domElement.remove(); // the shared canvas must outlive this bench's root
  }
  benchRoot.remove();
  if (ownsStyle) styleEl.remove();
}
/** One frame of this bench; the stage's loop calls it for the active bench only. */
function frame() {
  if (!active || disposed) return;
  if (started) animate();
  else { controls.update(); renderer.render(scene, camera); } // still loading: the empty studio, not the previous bench's last picture
}
/** The stage's switch: show or hide this bench; on the way in put the shared canvas under it and apply its look. */
function setActive(on) {
  if (!hosted || disposed || on === active) return;
  active = on;
  benchRoot.hidden = !on;
  if (on) {
    vp.appendChild(renderer.domElement);
    applyLook();
    attachSharedKip();
    if (kip && kipSession.state.source) adoptSharedDriverState();
    showMenu();
  } else {
    partyApi?.stop('tab'); // a party does not play on in a tab the child has left: the sound stops and the crown is put back
    sharedPrint?.release('kip'); // plates open on this bench's character close first, so the pose saved below is the bench's own
    menuHost.hide('kip');
    kipSession.release('kip');
    camPose.position.copy(camera.position);
    camPose.target.copy(controls.target);
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
}
if (hosted) benchRoot.hidden = true; // a hosted bench starts hidden until the stage activates one
return { root: benchRoot, ready, dispose, frame, setActive, hosted };
}
