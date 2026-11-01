// Kip demo side menu: one declarative MENU schema, one DOM builder, one sync loop.
//
// The schema half (everything above "DOM") touches no browser globals, so vitest can import it.
// Nothing here owns state. Every control reads the live `loco` object (plus a few readers for
// state that lives outside it) on a timer tick and repaints only what changed, so URL params,
// presets, `#toy=` loads and any programmatic setter all show up without each setter having to
// announce itself. `ctx` is built by Kip-Demo.html and is the only way this module reaches the scene.
//
//   ctx.loco                  live state object
//   ctx.read.*                ears() tail() preset() speed() clip() refOn() explodeOn() pileOn()
//   ctx.act.*                 the same functions the old dock buttons called
//   ctx.clips()               [{ id, label }] animation clips that have a button
//   ctx.presets               [{ id, label }]
//   ctx.speeds                playback speeds, in dock order
//   ctx.ready()               true once the scene is built
//   ctx.camera                three PerspectiveCamera (recentred with setViewOffset)
//   ctx.selfie                optional { open(), remove() }; without it there are no selfie controls
//   ctx.print                 optional print-view adapter; without it there is no Print group:
//                             isOn() setOn(bool) busy() summary() plateCount() plateIndex() setPlate(i) download(kind)
import {
  HUMAN_HEAD_IDS,
  HEAD_CATEGORIES,
  FACE_INSERT_MODES,
  headsInCategory,
  SHIRT_OPTIONS,
  PANTS_OPTIONS,
  SKIN_TONES,
  HAIR_COLORS,
  HAT_COLORS,
  HAIR_OPTIONS,
  WEARABLE_HAT_IDS,
  HAT_OPTIONS,
  BACK_OPTIONS,
  PROP_OPTIONS,
  PROP_CATEGORIES,
  VEHICLE_OPTIONS,
} from './kip-vehicles-wardrobe.js?v=10.0';
import { DECAL_EXPRESSIONS } from './kip-forge-sdk.js?v=10.0';

export const CUSTOM_PRESET = '__custom__';
export const PANEL_W = 288;
export const RAIL_W = 48;
export const DRAWER_BELOW_PX = 720;

// ---------------------------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------------------------

/** Which wardrobe controls apply to the current head. Mirrors the old syncWardrobeCategoryUi(). */
export function wardrobeVisibility(loco) {
  const cat = loco.category;
  const hairOpt = HAIR_OPTIONS.find((h) => h.id === loco.hair) || HAIR_OPTIONS[0];
  const canWearHat = hairOpt.hatReady;
  return {
    faceInsert: cat === 'human',
    skin: cat === 'human',
    hair: cat === 'human',
    hairColor: cat === 'human' && hairOpt.id !== 'off',
    hatColor: canWearHat && WEARABLE_HAT_IDS.has(loco.hat),
    shirt: cat !== 'robot',
    pants: cat !== 'robot',
    ears: cat === 'robot' && loco.head === 'classic',
    tail: cat !== 'human',
    canWearHat,
  };
}

export function faceLabel(loco) {
  if (HUMAN_HEAD_IDS.has(loco.head)) return 'Face plate';
  return loco.category === 'robot' ? 'Visor' : 'Face';
}

export function hatLabel(loco) {
  if (loco.category === 'animal') return 'Topper';
  return loco.category === 'human' ? 'Hat' : 'Crown';
}

const pick = (arr) => arr.map((o) => ({ value: o.id, label: o.label }));

function hairOptions() {
  const hatReady = HAIR_OPTIONS.filter((h) => h.id !== 'off' && h.hatReady);
  const sculpted = HAIR_OPTIONS.filter((h) => !h.hatReady);
  const trim = (l) => l.replace(/\s*\(Hat-Ready\)$/, '');
  return [
    { value: 'off', label: 'None' },
    ...hatReady.map((h) => ({ value: h.id, label: trim(h.label), group: `Hat-Ready (${hatReady.length})` })),
    ...sculpted.map((h) => ({ value: h.id, label: h.label, group: `Sculpted-Top (${sculpted.length})` })),
  ];
}

function propOptions() {
  const out = [{ value: 'off', label: 'None' }];
  for (const cat of PROP_CATEGORIES.filter((c) => c.id !== 'all')) {
    for (const p of PROP_OPTIONS.filter((o) => o.id !== 'off' && o.cat === cat.id)) {
      out.push({ value: p.id, label: p.label, group: cat.label });
    }
  }
  return out;
}

/**
 * Build the menu description. Control kinds: select | toggle | range | action | file.
 * `inPreset` marks the controls a preset sets, used to tell "Leo Explorer" from "Leo Explorer, edited".
 */
export function buildMenu(ctx) {
  const { loco, read, act } = ctx;
  const vis = () => wardrobeVisibility(loco);
  const sel = (id, label, o) => ({ kind: 'select', id, label, ...o });

  const character = {
    id: 'character',
    label: 'Head & face',
    icon: '🙂',
    controls: [
      sel('type', 'Type', {
        title: 'Head type: Human / Robot / Animal / Creature. The other controls show only what fits the chosen type.',
        inPreset: true,
        options: () => pick(HEAD_CATEGORIES),
        get: () => loco.category,
        set: (v) => act.setCategory(v),
      }),
      sel('head', 'Head', {
        title: 'Heads of the chosen type',
        inPreset: true,
        options: () => pick(headsInCategory(loco.category)),
        extra: () => 'Custom head (.stl)',
        get: () => loco.head,
        set: (v) => act.setHead(v),
      }),
      sel('face', () => faceLabel(loco), {
        title: 'Swappable emotion face inserts and 2D expressions',
        inPreset: true,
        options: () => pick(DECAL_EXPRESSIONS),
        extra: (v) => (v === 'selfie' ? 'Selfie (this device only)' : 'Custom (active)'),
        get: () => loco.expr,
        set: (v) => act.setFace(v),
      }),
      ...(ctx.selfie ? [
        { kind: 'action', id: 'selfie', label: '📸 Selfie face…',
          title: 'Take or upload a photo and wear it as the face plate. It stays on this device.',
          visibleWhen: () => HUMAN_HEAD_IDS.has(loco.head), run: () => ctx.selfie.open() },
        { kind: 'action', id: 'selfieRemove', label: 'Remove selfie',
          title: 'Put the previous face back and delete the photo from memory',
          visibleWhen: () => loco.expr === 'selfie', run: () => ctx.selfie.remove() },
        { kind: 'info', id: 'selfieNote', title: 'Selfie privacy', visibleWhen: () => loco.expr === 'selfie',
          text: () => 'Selfie face: on this device only. Not saved, uploaded or shared, and gone when you close or reload.' },
      ] : []),
      sel('faceInsert', 'Insert', {
        title: 'Universal human face insert, shared by all four human heads: 3D nose and smile, 3D button eyes and nose, or flat decal',
        inPreset: true,
        visibleWhen: () => vis().faceInsert,
        options: () => pick(FACE_INSERT_MODES),
        get: () => loco.faceInsert,
        set: (v) => act.setFaceInsert(v),
      }),
      sel('skin', 'Skin', {
        title: 'Full-body exposed skin tone: head, face plate, neck, hands, bare forearms and shins',
        inPreset: true,
        visibleWhen: () => vis().skin,
        options: () => pick(SKIN_TONES),
        get: () => loco.skin,
        set: (v) => act.setSkin(v),
      }),
      sel('hair', 'Hair', {
        title: 'Clip-on hairstyles: hat-ready styles keep their top studs, sculpted-top styles do not take hats',
        inPreset: true,
        visibleWhen: () => vis().hair,
        options: hairOptions,
        get: () => loco.hair,
        set: (v) => act.setHair(v),
      }),
      sel('hairColor', 'Hair tone', {
        title: 'Clip-on hair color',
        inPreset: true,
        visibleWhen: () => vis().hairColor,
        options: () => pick(HAIR_COLORS),
        get: () => loco.hairColor,
        set: (v) => act.setHairColor(v),
      }),
      sel('hat', () => hatLabel(loco), {
        title: 'Wearable hats and crown toppers. They stack on bald heads and on hat-ready hairstyles.',
        inPreset: true,
        options: () => pick(HAT_OPTIONS),
        extra: (v) => (v === 'wizardHat' ? 'Wizard hat (SDK)' : 'Custom hat (.stl)'),
        note: () => (vis().canWearHat ? '' : 'Sculpted-top hair has no hat studs. Picking a hat swaps to a hat-ready style.'),
        get: () => loco.hat,
        set: (v) => act.setHat(v),
      }),
      sel('hatColor', 'Hat tone', {
        title: 'Wearable hat filament color',
        inPreset: true,
        visibleWhen: () => vis().hatColor,
        options: () => pick(HAT_COLORS),
        get: () => loco.hatColor,
        set: (v) => act.setHatColor(v),
      }),
    ],
  };

  const outfit = {
    id: 'outfit',
    label: 'Outfit & gear',
    icon: '🎒',
    controls: [
      sel('shirt', 'Shirt', {
        title: 'Solid filament shirts, hoodies, jackets and overalls with front chest stencil stickers',
        inPreset: true,
        visibleWhen: () => vis().shirt,
        options: () => pick(SHIRT_OPTIONS),
        get: () => loco.shirt,
        set: (v) => act.setShirt(v),
      }),
      sel('pants', 'Pants', {
        title: 'Solid filament pants and shorts',
        inPreset: true,
        visibleWhen: () => vis().pants,
        options: () => pick(PANTS_OPTIONS),
        get: () => loco.pants,
        set: (v) => act.setPants(v),
      }),
      sel('back', 'Back', {
        title: '2x2 back dock: explorer pack, jetpack, cloud wings or motion 2:1 gears',
        inPreset: true,
        options: () => pick(BACK_OPTIONS),
        extra: () => 'Custom / photo wings',
        get: () => loco.back,
        set: (v) => act.setBack(v),
      }),
      sel('ears', 'Ears', {
        title: 'Plus and minus X ear-pod bosses (classic head only)',
        inPreset: true,
        visibleWhen: () => vis().ears,
        options: () => [
          { value: 'off', label: 'Off' },
          { value: 'comm', label: 'Comm-Pods' },
          { value: 'motion', label: 'Motion Scanner' },
        ],
        get: () => read.ears(),
        set: (v) => act.setEars(v),
      }),
      sel('tail', 'Tail', {
        title: '1x1 lower-back tail port',
        inPreset: true,
        visibleWhen: () => vis().tail,
        options: () => [
          { value: 'off', label: 'Off' },
          { value: 'wag', label: 'Wag-Tail' },
          { value: 'motion', label: 'Motion Wheelie' },
        ],
        get: () => read.tail(),
        set: (v) => act.setTail(v),
      }),
      sel('prop', 'Prop', {
        title: 'Hand prop, grouped by kind: tools, cleaning, instruments, play and gear',
        inPreset: true,
        options: propOptions,
        extra: (v) => (v === 'wand' ? 'Star wand (SDK)' : 'Custom prop (.stl)'),
        get: () => loco.prop,
        set: (v) => act.setProp(v),
      }),
    ],
  };

  const ride = {
    id: 'ride',
    label: 'Ride & looks',
    icon: '🏎️',
    controls: [
      sel('preset', 'Preset', {
        title: 'Whole-character presets. Shows "Custom" once you change anything after applying one.',
        options: () => ctx.presets.map((p) => ({ value: p.id, label: p.label })),
        get: () => (ctx.presetValue ? ctx.presetValue() : read.preset()),
        set: (v) => (ctx.applyPresetTracked ? ctx.applyPresetTracked(v) : act.applyPreset(v)),
      }),
      sel('vehicle', 'Vehicle', {
        title: 'Put Kip in a modular TU vehicle, or on foot',
        inPreset: true,
        options: () => pick(VEHICLE_OPTIONS),
        get: () => loco.vehicle,
        set: (v) => act.setVehicle(v),
      }),
      { kind: 'toggle', id: 'covers', label: 'Body covers', inPreset: true,
        title: 'Interchangeable snap-on vehicle body covers: hood and cab roof, pickup bed cover, scooter fairing, moto tank cowling',
        get: () => loco.vehCovers, set: (v) => act.setCovers(v) },
      { kind: 'toggle', id: 'racerKit', label: 'Racer kit',
        title: 'Wave 6 racer add-ons: bull bar, hood scoop, light bar and roof rack, spoiler, twin exhaust',
        get: () => loco.racerKit, set: (v) => act.setRacerKit(v) },
      sel('edition', 'Edition', {
        title: 'Motion (8+) 14-joint rig or simplified Snap (3+) rig. Snap uses the seated 90 degree legs in vehicles.',
        options: () => [
          { value: 'motion', label: 'Motion (8+) · 14-joint rig' },
          { value: 'snap', label: 'Snap (3+) · simplified rig' },
        ],
        get: () => loco.edition,
        set: (v) => act.setEdition(v),
      }),
    ],
  };

  const animation = {
    id: 'animation',
    label: 'Animation',
    icon: '🎬',
    controls: [
      sel('clip', 'Clip', {
        title: 'Animation clip',
        options: () => ctx.clips().map((c) => ({ value: c.id, label: c.label })),
        get: () => read.clip() ?? '',
        set: (v) => act.playClip(v),
      }),
      sel('speed', 'Speed', {
        title: 'Animation playback speed',
        options: () => ctx.speeds.map((s) => ({ value: String(s), label: `${s}×` })),
        get: () => String(read.speed()),
        set: (v) => act.setSpeed(parseFloat(v)),
      }),
    ],
  };

  const build = {
    id: 'build',
    label: 'Build view',
    icon: '🧩',
    controls: [
      { kind: 'toggle', id: 'explode', label: 'Exploded view',
        title: 'Pull Kip and the active vehicle apart along their physical assembly axes (shortcut E)',
        get: () => read.explodeOn(), set: (v) => { if (v !== read.explodeOn()) act.toggleExplode(); } },
      { kind: 'range', id: 'pull', label: 'Pull', min: 0, max: 100, step: 1,
        title: 'Scrub the pulled-apart explosion distance',
        get: () => Math.round(loco.explodeTarget * 100), set: (v) => act.setExplode(v / 100) },
      { kind: 'toggle', id: 'pile', label: 'Part pile',
        title: 'Scatter Kip and the vehicle parts flat onto the tabletop build grid',
        get: () => read.pileOn(), set: (v) => { if (v !== read.pileOn()) act.togglePile(); } },
      { kind: 'action', id: 'build', label: '▶ Pile → Build',
        title: 'Animate Kip and the vehicle snapping together piece by piece (shortcut B)',
        active: () => loco.buildMode === 'building', run: () => act.startBuild() },
      { kind: 'toggle', id: 'ref', label: 'Reference skeleton',
        title: 'Show the live Mixamo X-Bot reference skeleton',
        get: () => read.refOn(), set: (v) => { if (v !== read.refOn()) act.toggleRef(); } },
    ],
  };

  const tools = {
    id: 'tools',
    label: 'Tools',
    icon: '🛠️',
    controls: [
      { kind: 'action', id: 'llm', label: '🤖 LLM part SDK',
        title: 'Open the conforming LLM part-maker SDK prompt and custom .stl loader', run: () => act.openLlm() },
      { kind: 'action', id: 'photo', label: '📸 Photo → Toy',
        title: 'Turn a webcam snapshot, uploaded drawing or kid sketch into a digital accessory', run: () => act.openPhoto() },
      { kind: 'file', id: 'file', label: '+ .stl / .glb',
        title: 'Load a custom .stl part or a Mixamo .fbx/.glb animation', accept: '.stl,.fbx,.glb,.gltf',
        run: (file) => act.loadFile(file) },
    ],
  };

  const pr = ctx.print;
  const print = pr && {
    id: 'print',
    label: 'Print',
    icon: '🖨️',
    controls: [
      { kind: 'toggle', id: 'plateView', label: 'Plate view',
        title: 'Lay every part of this character flat on a print plate: gaps of at least 5 mm, tier colours, exports',
        get: () => pr.isOn(), set: (v) => pr.setOn(v) },
      { kind: 'info', id: 'printInfo', visibleWhen: () => pr.isOn(), title: 'Plate summary',
        text: () => {
          const s = pr.summary();
          return [
            pr.busy() ? 'Packing…' : '',
            ...(s.lines ?? []),
            ...(s.errors ?? []).map((e) => `⚠ Missing or unusable: ${e}. Exports are disabled until this is fixed.`),
            ...(s.exportError ? [`⚠ ${s.exportError}`] : []),
            ...(s.unmapped?.length ? [`Not on the plate: ${s.unmapped.join('; ')}`] : []),
            ...(s.small?.length ? ['Small parts: choking hazard for children under 3.'] : []),
            s.note ?? '',
          ].filter(Boolean).join('\n');
        } },
      sel('plate', 'Plate', {
        title: 'Which plate to show when the parts need more than one',
        visibleWhen: () => pr.isOn() && pr.plateCount() > 1,
        options: () => Array.from({ length: pr.plateCount() }, (_, i) => ({ value: String(i), label: `Plate ${i + 1} of ${pr.plateCount()}` })),
        get: () => String(pr.plateIndex()),
        set: (v) => pr.setPlate(Number(v)),
      }),
      ...[['export3mf', '3mf', 'Export 3MF', 'Download this plate as a 3MF with one object per part (supports flagged per part)'],
        ['exportStl', 'stl-zip', 'Export STL zip', 'Download every plate as one STL each, plus layout.json'],
        ['exportSheet', 'sheet', 'Print sheet (PNG)', 'Download a one-page plate layout with the small-parts warning']]
        .map(([id, kind, label, title]) => ({ kind: 'action', id, label, title, visibleWhen: () => pr.isOn(),
          disabled: () => pr.busy() || (pr.summary().errors ?? []).length > 0, run: () => pr.download(kind) })),
    ],
  };

  return [character, outfit, ride, animation, build, ...(print ? [print] : []), tools];
}

/**
 * Every control of the old bottom dock and the menu control that replaced it. A test fails if the
 * dock gains a control that is not listed here, or if a listed menu control does not exist.
 */
export const DOCK_PARITY = {
  'row-clips': 'clip',
  'btn-category': 'type',
  'btn-head': 'head',
  'btn-face': 'face',
  'btn-face-insert': 'faceInsert',
  'btn-hair': 'hair',
  'btn-crown': 'hat',
  'btn-hat-col': 'hatColor',
  'btn-skin': 'skin',
  'btn-hair-col': 'hairColor',
  'btn-shirt': 'shirt',
  'btn-pants': 'pants',
  'btn-back': 'back',
  'btn-prop-cat': 'prop',
  'btn-hand': 'prop',
  'btn-ears': 'ears',
  'btn-tail': 'tail',
  'btn-veh-none': 'vehicle',
  'btn-veh-car': 'vehicle',
  'btn-veh-truck': 'vehicle',
  'btn-veh-scooter': 'vehicle',
  'btn-veh-moto': 'vehicle',
  'btn-veh-covers': 'covers',
  'btn-racer-kit': 'racerKit',
  'btn-preset': 'preset',
  'btn-edition': 'edition',
  'btn-explode': 'explode',
  'rng-explode': 'pull',
  'btn-pile': 'pile',
  'btn-build': 'build',
  'btn-open-llm': 'llm',
  'btn-open-photo': 'photo',
  'btn-Skeleton': 'ref',
  'btn-speed': 'speed',
  'file-input': 'file',
};

export function flattenMenu(groups) {
  return groups.flatMap((g) => g.controls.map((c) => ({ ...c, group: g.id })));
}

/** Normalised view of a select's options, including the entry shown when the live value is not in the list. */
export function resolveOptions(control) {
  const opts = control.options();
  const value = String(control.get());
  if (value !== '' && !opts.some((o) => String(o.value) === value)) {
    const label = control.extra ? control.extra(value) : 'Custom (active)';
    return [...opts, { value, label, disabled: true, group: undefined }];
  }
  return opts;
}

// ---------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------

const CSS = `
.km, .km-fab, .km-backdrop { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.km {
  position: fixed; left: 14px; top: 72px; bottom: 40px; width: ${PANEL_W}px; z-index: 12;
  display: flex; background: var(--glass); backdrop-filter: blur(14px);
  border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 12px 32px rgba(27, 34, 56, 0.10);
  color: var(--ink); overflow: hidden; transition: width 0.18s ease;
}
.km[aria-busy="true"] .km-body { opacity: 0.55; }
.km-rail { flex: 0 0 ${RAIL_W}px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0; border-right: 1px solid var(--line); }
.km-rail button { width: 34px; height: 34px; padding: 0; justify-content: center; font-size: 16px; line-height: 1; }
.km-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.km-title { padding: 12px 14px 6px; font-size: 13px; font-weight: 800; letter-spacing: -0.01em; }
.km-scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 10px 12px 14px; scrollbar-width: thin; }
.km--collapsed { width: ${RAIL_W}px; }
.km--collapsed .km-body { display: none; }
.km-group { border-top: 1px solid var(--line); padding: 2px 0 6px; }
.km-group:first-of-type { border-top: 0; }
.km-group > summary {
  list-style: none; cursor: pointer; padding: 8px 0 6px; font-size: 10px; font-weight: 800;
  text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted);
}
.km-group > summary::-webkit-details-marker { display: none; }
.km-group > summary::after { content: "▾"; float: right; transition: transform 0.15s; }
.km-group:not([open]) > summary::after { transform: rotate(-90deg); }
.km-field { display: block; margin: 0 0 8px; }
.km-field[hidden], .km-group[hidden] { display: none; }
.km-field > label:not(.km-switch), .km-field > .km-lbl { display: block; font-size: 11.5px; font-weight: 700; color: var(--ink); margin-bottom: 3px; }
.km select {
  width: 100%; height: 32px; padding: 0 28px 0 10px; font-size: 12.5px; font-weight: 650; color: var(--ink);
  background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%235d657c' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 10px center;
  border: 1px solid var(--line); border-radius: 9px; cursor: pointer; text-overflow: ellipsis;
}
.km select:hover { border-color: rgba(27, 34, 56, 0.25); }
.km-note { display: block; margin-top: 3px; font-size: 10.5px; line-height: 1.35; color: var(--muted); }
.km-note:empty { display: none; }
.km-switch { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 30px; }
.km-switch > span { font-size: 12.5px; font-weight: 650; }
.km-switch input { appearance: none; flex: 0 0 auto; width: 34px; height: 20px; border-radius: 999px; border: 1px solid var(--line); background: rgba(27, 34, 56, 0.16); position: relative; cursor: pointer; transition: background 0.12s; }
.km-switch input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(27, 34, 56, 0.3); transition: transform 0.12s; }
.km-switch input:checked { background: var(--spark); border-color: var(--spark); }
.km-switch input:checked::after { transform: translateX(14px); }
.km-range { display: flex; align-items: center; gap: 8px; }
.km-range input { flex: 1; accent-color: var(--spark); cursor: pointer; }
.km-range output { min-width: 30px; text-align: right; font-size: 11px; font-weight: 700; color: var(--muted); }
.km-btn { width: 100%; justify-content: center; margin-bottom: 8px; padding: 7px 10px; font-size: 12.5px; }
.km-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.km-info { white-space: pre-line; font-size: 11.5px; line-height: 1.45; color: var(--muted); background: rgba(27, 34, 56, 0.05); border-radius: 9px; padding: 8px 10px; }
.km select:focus-visible, .km button:focus-visible, .km summary:focus-visible, .km-switch input:focus-visible, .km-range input:focus-visible, .km-fab:focus-visible {
  outline: 2px solid var(--spark); outline-offset: 2px;
}
.km-fab { display: none; position: fixed; left: 12px; bottom: 40px; z-index: 13; padding: 9px 14px; font-size: 13px; border-radius: 999px; box-shadow: 0 8px 20px rgba(27, 34, 56, 0.16); background: var(--glass); backdrop-filter: blur(12px); }
.km-backdrop { display: none; position: fixed; inset: 0; z-index: 11; background: rgba(27, 34, 56, 0.28); }
body.menu-side .dock { display: none !important; }
body.clean-ui .km, body.clean-ui .km-fab, body.clean-ui .km-backdrop { display: none !important; }
@media (max-width: ${DRAWER_BELOW_PX - 0.02}px) {
  .km { top: 0; bottom: 0; left: 0; width: min(86vw, 330px); border-radius: 0 18px 18px 0; transform: translateX(-105%); visibility: hidden; transition: transform 0.2s ease, visibility 0s linear 0.2s; }
  .km--collapsed { width: min(86vw, 330px); }
  .km--collapsed .km-body { display: flex; }
  .km.km--open { transform: none; visibility: visible; transition-delay: 0s; }
  .km-rail { display: none; }
  .km-fab { display: inline-flex; }
  .km-backdrop.km--open { display: block; }
  body.menu-open .km-fab, body.menu-open #version-pill { display: none; }
}
@media (prefers-reduced-motion: reduce) { .km, .km-fab { transition: none !important; } }
`;

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) node.append(kid);
  return node;
}

function safeStorage(op, key, value) {
  try {
    return op === 'get' ? localStorage.getItem(key) : localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

/** Mount the panel. Returns a handle used by tests: { controls, groups, sync, destroy }. */
export function mountKipMenu(ctx, { root = document.body } = {}) {
  const loco = ctx.loco;

  // Preset tracking: "Custom" once anything a preset sets has changed since the last apply. The active
  // preset id changing (from any route: this menu, a dock click, a URL param) marks the moment its result
  // was applied. Re-applying the same preset after edits goes through applyPresetTracked below.
  let presetSig = null;
  let lastPreset = null;
  const stateSig = () => JSON.stringify(flatControls.filter((c) => c.inPreset && c.id !== 'preset').map((c) => c.get()));
  ctx.presetValue = () => {
    const cur = ctx.read.preset();
    if (!ctx.ready()) return cur;
    const sig = stateSig();
    if (presetSig === null || cur !== lastPreset) { presetSig = sig; lastPreset = cur; }
    return sig === presetSig ? cur : CUSTOM_PRESET;
  };
  ctx.applyPresetTracked = (id) => {
    ctx.act.applyPreset(id);
    lastPreset = ctx.read.preset();
    presetSig = stateSig();
  };

  const groups = buildMenu(ctx);
  const flatControls = flattenMenu(groups);
  const byId = new Map(flatControls.map((c) => [c.id, c]));

  root.classList.add('menu-side');
  const style = el('style', { id: 'km-style', text: CSS });
  document.head.append(style);

  // ---- structure -------------------------------------------------------------------------
  const narrow = window.matchMedia(`(max-width: ${DRAWER_BELOW_PX - 0.02}px)`);
  const panel = el('aside', { id: 'kip-menu', class: 'km', 'aria-label': 'Customize Kip', 'aria-busy': 'true' });
  const body = el('div', { class: 'km-body', id: 'km-body' });
  const scroll = el('div', { class: 'km-scroll' });
  body.append(el('div', { class: 'km-title', text: 'Customize Kip' }), scroll);

  const rail = el('div', { class: 'km-rail' });
  const toggleBtn = el('button', { type: 'button', class: 'km-toggle', 'aria-controls': 'km-body', 'aria-label': 'Collapse panel', title: 'Collapse panel' }, '‹');
  rail.append(toggleBtn);

  const fields = new Map();
  for (const g of groups) {
    const details = el('details', { class: 'km-group', open: true, 'data-group': g.id });
    details.append(el('summary', { text: g.label }));
    for (const c of g.controls) {
      const field = buildField(c);
      fields.set(c.id, field);
      details.append(field.root);
    }
    g.details = details;
    scroll.append(details);
    const railBtn = el('button', { type: 'button', 'aria-label': g.label, title: g.label }, g.icon);
    railBtn.addEventListener('click', () => {
      setCollapsed(false);
      details.open = true;
      details.scrollIntoView({ block: 'start' });
    });
    rail.append(railBtn);
  }
  panel.append(rail, body);

  const fab = el('button', { type: 'button', class: 'km-fab', 'aria-controls': 'kip-menu', 'aria-expanded': 'false' }, '☰ Customize');
  const backdrop = el('div', { class: 'km-backdrop' });
  root.append(panel, fab, backdrop);

  // ---- field builders --------------------------------------------------------------------
  let lastInputWasPointer = false;
  panel.addEventListener('pointerdown', () => { lastInputWasPointer = true; }, true);

  // Window-level shortcuts (E, B, H, WASD, Space) must not fire while someone is working in the panel.
  panel.addEventListener('keydown', (e) => {
    lastInputWasPointer = false;
    e.stopPropagation();

  });

  function buildField(c) {
    const id = `km-${c.id}`;
    const title = c.title;
    if (c.kind === 'select') {
      const select = el('select', { id, title });
      const label = el('label', { for: id });
      const note = el('small', { class: 'km-note', id: `${id}-note` });
      select.setAttribute('aria-describedby', note.id);
      select.addEventListener('change', () => {
        c.set(select.value);
        if (lastInputWasPointer) select.blur(); // keyboard users keep focus so arrow-stepping works
        sync();
      });
      return { root: el('div', { class: 'km-field', 'data-control': c.id }, label, select, note), label, select, note };
    }
    if (c.kind === 'toggle') {
      const input = el('input', { id, type: 'checkbox', role: 'switch' });
      const text = el('span', { text: c.label });
      input.addEventListener('change', () => { Promise.resolve(c.set(input.checked)).finally(sync); sync(); });
      const row = el('label', { class: 'km-switch', for: id, title }, text, input);
      return { root: el('div', { class: 'km-field', 'data-control': c.id }, row), input };
    }
    if (c.kind === 'range') {
      const input = el('input', { id, type: 'range', min: c.min, max: c.max, step: c.step, title, 'aria-labelledby': `${id}-lbl` });
      const out = el('output', { for: id });
      input.addEventListener('input', () => { c.set(Number(input.value)); out.textContent = input.value; });
      const row = el('div', { class: 'km-range' }, input, out);
      return { root: el('div', { class: 'km-field', 'data-control': c.id }, el('div', { class: 'km-lbl', id: `${id}-lbl`, text: c.label }), row), input, out };
    }
    if (c.kind === 'file') {
      const input = el('input', { id, type: 'file', accept: c.accept, hidden: true });
      const btn = el('button', { type: 'button', class: 'km-btn', title }, c.label);
      btn.addEventListener('click', () => input.click());
      input.addEventListener('change', () => { if (input.files[0]) c.run(input.files[0]); input.value = ''; });
      return { root: el('div', { class: 'km-field', 'data-control': c.id }, btn, input), btn };
    }
    if (c.kind === 'info') {
      const box = el('div', { class: 'km-info', id, role: 'status', 'aria-live': 'polite', title });
      return { root: el('div', { class: 'km-field', 'data-control': c.id }, box), box };
    }
    // action
    const btn = el('button', { type: 'button', class: 'km-btn', id, title }, c.label);
    btn.addEventListener('click', () => { Promise.resolve(c.run()).finally(sync); sync(); });
    return { root: el('div', { class: 'km-field', 'data-control': c.id }, btn), btn };
  }

  // ---- sync ------------------------------------------------------------------------------
  const painted = new Map();
  let lastReady = null;

  function paintSelect(c, f) {
    const opts = resolveOptions(c);
    const value = String(c.get());
    const sig = opts.map((o) => `${o.group ?? ''}|${o.value}|${o.label}|${o.disabled ? 1 : 0}`).join('\n');
    if (f.sig !== sig) {
      f.select.replaceChildren();
      const groupNodes = new Map();
      for (const o of opts) {
        const opt = el('option', { value: o.value, text: o.label, disabled: o.disabled });
        if (o.group) {
          if (!groupNodes.has(o.group)) {
            const og = el('optgroup', { label: o.group });
            groupNodes.set(o.group, og);
            f.select.append(og);
          }
          groupNodes.get(o.group).append(opt);
        } else {
          f.select.append(opt);
        }
      }
      f.sig = sig;
    }
    if (f.select.value !== value) f.select.value = value;
    const label = typeof c.label === 'function' ? c.label() : c.label;
    if (f.label.textContent !== label) f.label.textContent = label;
    const note = c.note ? c.note() : '';
    if (f.note.textContent !== note) f.note.textContent = note;
  }

  function sync() {
    const ready = !!ctx.ready();
    if (ready !== lastReady) {
      lastReady = ready;
      panel.setAttribute('aria-busy', ready ? 'false' : 'true');
      body.toggleAttribute('inert', !ready);
    }
    for (const g of groups) {
      let anyVisible = false;
      for (const c of g.controls) {
        const f = fields.get(c.id);
        const visible = c.visibleWhen ? !!c.visibleWhen() : true;
        f.root.hidden = !visible;
        anyVisible ||= visible;
        if (!visible) continue;
        if (c.kind === 'select') {
          paintSelect(c, f);
        } else if (c.kind === 'toggle') {
          const on = !!c.get();
          if (f.input.checked !== on) f.input.checked = on;
        } else if (c.kind === 'range') {
          const v = String(c.get());
          if (document.activeElement !== f.input && f.input.value !== v) f.input.value = v;
          f.out.textContent = f.input.value;
        } else if (c.kind === 'info') {
          const t = c.text();
          if (f.box.textContent !== t) f.box.textContent = t;
        } else if (c.kind === 'action') {
          if (c.active) f.btn.classList.toggle('spark-active', !!c.active());
          if (c.disabled) f.btn.disabled = !!c.disabled();
        }
      }
      g.details.hidden = !anyVisible;
    }
  }

  // ---- layout: collapse, drawer, camera recentre ----------------------------------------
  const COLLAPSE_KEY = 'kipMenu.collapsed';
  let collapsed = safeStorage('get', COLLAPSE_KEY) === '1';
  let open = false;

  function setCollapsed(v) {
    collapsed = v;
    panel.classList.toggle('km--collapsed', v);
    toggleBtn.textContent = v ? '›' : '‹';
    const label = v ? 'Expand panel' : 'Collapse panel';
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.title = label;
    toggleBtn.setAttribute('aria-expanded', String(!v));
    safeStorage('set', COLLAPSE_KEY, v ? '1' : '0');
    applyViewOffset();
  }
  function setOpen(v) {
    open = v;
    panel.classList.toggle('km--open', v);
    backdrop.classList.toggle('km--open', v);
    root.classList.toggle('menu-open', v);
    fab.setAttribute('aria-expanded', String(v));
  }
  toggleBtn.addEventListener('click', () => setCollapsed(!collapsed));
  // Focus the first visible control in the body (the rail's buttons are display:none in drawer mode).
  fab.addEventListener('click', () => { setOpen(true); body.querySelector('select:not([hidden]), button, input')?.focus(); });
  const onDocKey = (e) => { if (e.key === 'Escape' && open && narrow.matches) { setOpen(false); fab.focus(); } };
  document.addEventListener('keydown', onDocKey, true); // capture: the panel's stopPropagation must not hide Escape from it
  backdrop.addEventListener('click', () => setOpen(false));
  narrow.addEventListener('change', () => { setOpen(false); applyViewOffset(); });
  window.addEventListener('resize', applyViewOffset); // registered after the demo's own resize handler, so it runs second

  let lastOffsetKey = '';
  function applyViewOffset() {
    const cam = ctx.camera;
    if (!cam || typeof cam.setViewOffset !== 'function') return;
    const hidden = root.classList.contains('clean-ui');
    const covered = hidden || narrow.matches ? 0 : (collapsed ? RAIL_W : PANEL_W) + 14;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const key = `${covered}|${w}|${h}`;
    if (key === lastOffsetKey) return;
    lastOffsetKey = key;
    if (covered === 0) cam.clearViewOffset();
    else cam.setViewOffset(w, h, -covered / 2, 0, w, h); // negative x: scene shifts right, into the free area
    cam.updateProjectionMatrix();
  }
  setCollapsed(collapsed);

  // ---- tick ------------------------------------------------------------------------------
  // A timer, not requestAnimationFrame: sync cost must not depend on how slow a frame renders.
  const tick = () => {
    if (document.hidden) return;
    sync();
    applyViewOffset(); // also reacts to H / ?clean=1 toggling the clean-ui class
  };
  sync();
  const timer = setInterval(tick, 100);

  return {
    ctx,
    groups,
    controls: byId,
    fields,
    sync,
    applyViewOffset,
    get presetSig() { return presetSig; },
    destroy() {
      clearInterval(timer);
      document.removeEventListener('keydown', onDocKey, true);
      panel.remove(); fab.remove(); backdrop.remove(); style.remove();
      root.classList.remove('menu-side', 'menu-open');
      ctx.camera?.clearViewOffset?.();
    },
  };
}
