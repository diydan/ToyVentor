// Kip demo side menu: one declarative MENU schema, one DOM builder, one sync loop.
//
// The schema half (everything above "DOM") touches no browser globals, so vitest can import it.
// Nothing here owns state. Every control reads the live `loco` object (plus a few readers for
// state that lives outside it) on a timer tick and repaints only what changed, so URL params,
// presets, `#toy=` loads and any programmatic setter all show up without each setter having to
// announce itself. `ctx` is built by Kip-Demo.html and is the only way this module reaches the scene.
//
//   ctx.loco                  live state object
//   ctx.read.*                tail() preset() speed() clip() refOn() explodeOn() pileOn()
//   ctx.act.*                 the page's own setters (the same functions the retired dock buttons called)
//   ctx.clips()               [{ id, label }] animation clips the page can play
//   ctx.presets               [{ id, label }]
//   ctx.speeds                playback speeds, in cycle order
//   ctx.ready()               true once the scene is built
//   ctx.camera                three PerspectiveCamera (recentred with setViewOffset)
//   ctx.selfie                optional { open(), remove() }; without it there are no selfie controls
//   ctx.party                 optional party adapter (kip-party.js `party.menu`: isOn songs moods tempos bands dances song mood tempo band dance click start stop setSong setMood setTempo setBand setDance setClick status);
//                             without it there is no Party group
//   ctx.print                 optional print-view adapter; without it there is no Print group:
//                             isOn() setOn(bool) busy() summary() plateCount() plateIndex() setPlate(i) download(kind)
//   ctx.groups                optional () => groups: a bench that DECLARES its own sections (the Truck, truck-menu.js); without it the Kip's buildMenu(ctx) is drawn
//   ctx.title, ctx.fabLabel   optional panel title ("Customize Kip") and the phone drawer button's text
//   ctx.viewSize, ctx.isActive  optional: the host box the camera offset is computed in, and whether this bench is the active one (see bench-stage.js)
// One panel can serve several benches (Workshop stage 4c): see rebind / park on the handle and createMenuHost at the end of this file.
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
import {
  PRESET_LIST,
  FIT_OPTIONS,
  createDefaultProfile,
} from './kip-print-profile.js';

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
 * Build the menu description. Control kinds: select | toggle | range | action | file | info | swatch | preview.
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
        extra: (v) => (v === 'selfie' ? 'Selfie (not saved)' : 'Custom (active)'),
        get: () => loco.expr,
        set: (v) => act.setFace(v),
      }),
      ...(ctx.selfie ? [
        { kind: 'action', id: 'selfie', label: '📸 Selfie face…',
          title: 'Take or upload a photo and wear it as the face plate. It stays on this device unless a grown-up chooses the online helper.',
          visibleWhen: () => HUMAN_HEAD_IDS.has(loco.head), run: () => ctx.selfie.open() },
        { kind: 'action', id: 'selfieRemove', label: 'Remove selfie',
          title: 'Put the previous face back and delete the photo from memory',
          visibleWhen: () => loco.expr === 'selfie', run: () => ctx.selfie.remove() },
        { kind: 'info', id: 'selfieNote', title: 'Selfie privacy', visibleWhen: () => loco.expr === 'selfie',
          text: () => 'Selfie face: not saved or shared, and gone when you close or reload. It stays on this device unless a grown-up chose the online helper.' },
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
        title: '2x2 back dock: explorer pack, jetpack, cloud wings or pro 2:1 gears',
        inPreset: true,
        options: () => pick(BACK_OPTIONS),
        extra: () => 'Custom / photo wings',
        get: () => loco.back,
        set: (v) => act.setBack(v),
      }),
      sel('tail', 'Tail', {
        title: '1x1 lower-back tail port',
        inPreset: true,
        visibleWhen: () => vis().tail,
        options: () => [
          { value: 'off', label: 'Off' },
          { value: 'wag', label: 'Wag-Tail' },
          { value: 'pro', label: 'Pro Wheelie' },
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
        title: 'Pro (8+) 14-joint rig or simplified Snap (3+) rig with quick-click turret joints.',
        options: () => [
          { value: 'pro', label: 'Pro (8+) · 14-joint rig' },
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
      { kind: 'action', id: 'forge-make', label: '✨ Make from words',
        title: 'Say what you want, like a wizard hat or a robot head, and make it for Kip', run: () => act.openForgeMake() },
      { kind: 'action', id: 'photo', label: '📸 Photo → Toy',
        title: 'Turn a webcam snapshot, uploaded drawing or kid sketch into a digital accessory', run: () => act.openPhoto() },
      { kind: 'file', id: 'file', label: '+ .stl / .glb',
        title: 'Load a custom .stl part or a Mixamo .fbx/.glb animation', accept: '.stl,.fbx,.glb,.gltf',
        run: (file) => act.loadFile(file) },
    ],
  };

  const print = ctx.print && buildPrintGroup(ctx.print, { hasVehicle: () => loco.vehicle !== 'none' });
  const party = ctx.party && buildPartyGroup(ctx.party);
  return [character, outfit, ride, animation, ...(party ? [party] : []), build, ...(print ? [print] : []), tools];
}

/**
 * The Party group (docs/specs/dance-party-spec.md 5.1), built over the adapter `party` that kip-party.js makes. Pick a mood, a tempo and the child's age band,
 * switch Party on: Kip puts on the headphones, a practice beat plays and Kip dances on the beat. Changing the mood or the tempo while it plays restarts it.
 */
export function buildPartyGroup(party) {
  const sel = (id, label, o) => ({ kind: 'select', id, label, ...o });
  return {
    id: 'party',
    label: 'Party',
    icon: '🎉',
    controls: [
      { kind: 'toggle', id: 'partyOn', label: 'Party',
        title: 'Put on the headphones, play a practice beat and dance on the beat. Tap the stage along with it.',
        get: () => party.isOn(), set: (v) => { if (v) party.start(); else party.stop(); } },
      sel('partyMode', 'Mode', {
        title: 'A dance party, or a movement break: a short song and moves to copy. Nothing is watched, measured or scored from how a child moves.',
        options: () => party.modes, get: () => party.mode(), set: (v) => party.setMode(v),
      }),
      sel('partySong', 'Song', {
        title: 'The practice beat, or one of the starter songs (made by AI with Mureka: instrumental, an excerpt, looped on its beat)',
        options: () => party.songs(), get: () => party.song(), set: (v) => party.setSong(v),
      }),
      sel('partyMood', 'Mood', {
        title: 'The feel of the practice beat',
        visibleWhen: () => party.song() === 'practice',
        options: () => party.moods, get: () => party.mood(), set: (v) => party.setMood(v),
      }),
      sel('partyTempo', 'Tempo', {
        title: 'Slow, medium or fast (beats a minute in brackets); the dance is the one that fits it',
        visibleWhen: () => party.song() === 'practice',
        options: () => party.tempos, get: () => party.tempo(), set: (v) => party.setTempo(v),
      }),
      sel('partyDance', 'Dance', {
        visibleWhen: () => !party.isBreak(),
        title: 'Auto lets the tempo pick the dance. Or choose a move: only those that fit this tempo are listed (the number is how much faster or slower than its own speed it plays)',
        options: () => party.dances(), get: () => party.dance(), set: (v) => party.setDance(v),
      }),
      sel('partyNext', 'Next move', {
        title: 'Movement break, ages 10 and up: after Kip has shown the four moves, you choose what he does next. Whatever is picked when a move begins is what he does for it.',
        visibleWhen: () => party.isBreak() && party.pickStyle() === 'choose',
        options: () => party.picks(), get: () => party.pick(), set: (v) => party.setPick(v),
      }),
      sel('partyBand', 'Ages', {
        title: 'The age band. Dance party: the youngest two tap anywhere, from 5 to 6 a tap must land on the beat to flash. Movement break: ages 2 to 4 copy one move and count, 5 to 9 copy a four-move sequence, 10 and up copy and then choose',
        options: () => party.bands, get: () => party.band(), set: (v) => party.setBand(v),
      }),
      { kind: 'toggle', id: 'partyClick', label: 'Beat click',
        title: 'A tick on every beat, higher on the 1 of each bar, over the music: to hear whether the beat is where the dance thinks it is',
        get: () => party.click(), set: (v) => party.setClick(v) },
      { kind: 'info', id: 'partyInfo', title: 'The dance, the tempo, the count and your taps', text: () => party.status() },
    ],
  };
}

/**
 * The Print group, built over a print-view adapter `pr` (isOn, setOn, busy, summary, plateCount, plateIndex, plateLabel, setPlate, profile, setPreset,
 * updateProfile, supportCheck, setSupportCheck, splitByColour, setSplitByColour, download). The Kip's menu and the Truck's declare this same group
 * (Workshop stage 4c: one menu, one print view), so the controls, their ids and their wording cannot drift apart.
 * `hasVehicle()` says whether the bench has a vehicle of its own to offer on dedicated plates (the Kip's `loco.vehicle`).
 */
export function buildPrintGroup(pr, { hasVehicle = () => false } = {}) {
  const sel = (id, label, o) => ({ kind: 'select', id, label, ...o });
  const readProf = () => (pr?.profile ? pr.profile() : createDefaultProfile());
  const patchProf = (patch) => pr?.updateProfile?.(patch);
  return {
    id: 'print',
    label: 'Print',
    icon: '🖨️',
    controls: [
      { kind: 'toggle', id: 'plateView', label: 'Plate view',
        title: 'Lay every part of this character and optional vehicle flat on colour-grouped print plates',
        get: () => pr.isOn(), set: (v) => pr.setOn(v) },
      sel('printer', 'Printer', {
        title: 'Printer bed size, slicer dialect, and multi-colour slot preset',
        visibleWhen: () => pr.isOn(),
        options: () => PRESET_LIST.map((p) => ({ value: p.presetId, label: p.label })),
        get: () => readProf().presetId,
        set: (v) => (pr.setPreset ? pr.setPreset(v) : patchProf({ presetId: v })),
      }),
      sel('slicer', 'Slicer family', {
        title: 'Target 3MF metadata dialect: OrcaSlicer / Bambu Studio or PrusaSlicer',
        visibleWhen: () => pr.isOn() && readProf().presetId === 'custom',
        options: () => [
          { value: 'orca_bambu', label: 'OrcaSlicer / Bambu Studio' },
          { value: 'prusa', label: 'PrusaSlicer' },
        ],
        get: () => readProf().slicer === 'prusa' ? 'prusa' : 'orca_bambu',
        set: (v) => patchProf({ slicer: v }),
      }),
      sel('changerType', 'Machine type', {
        title: 'Single extruder, single-nozzle filament changer, or multi-head toolchanger',
        visibleWhen: () => pr.isOn() && readProf().presetId === 'custom',
        options: () => [
          { value: 'single', label: 'Single extruder (1 colour)' },
          { value: 'multiplexer', label: 'Single-nozzle changer' },
          { value: 'toolchanger', label: 'Multi-head toolchanger' },
        ],
        get: () => readProf().changerType,
        set: (v) => patchProf({ changerType: v, maxSlots: v === 'single' ? 1 : Math.max(2, readProf().maxSlots) }),
      }),
      { kind: 'range', id: 'customBedMm', label: 'Bed (mm)', min: 150, max: 360, step: 10,
        title: 'Square printer build plate width and depth in millimetres',
        visibleWhen: () => pr.isOn() && readProf().presetId === 'custom',
        get: () => readProf().bedXmm,
        set: (v) => patchProf({ bedXmm: v, bedYmm: v }) },
      sel('customNozzle', 'Nozzle', {
        title: 'Extruder nozzle diameter (0.4 mm standard profile)',
        visibleWhen: () => pr.isOn() && readProf().presetId === 'custom',
        options: () => [
          { value: '0.4', label: '0.4 mm (standard)' },
          { value: '0.2', label: '0.2 mm (fine)' },
        ],
        get: () => String(readProf().nozzleMm),
        set: (v) => patchProf({ nozzleMm: parseFloat(v) }),
      }),
      { kind: 'range', id: 'customSlots', label: 'Colour slots', min: 2, max: 16, step: 1,
        title: 'Number of loaded filament slots available to the printer',
        visibleWhen: () => pr.isOn() && readProf().presetId === 'custom' && readProf().changerType !== 'single',
        get: () => Math.max(2, readProf().maxSlots),
        set: (v) => patchProf({ maxSlots: v }) },
      sel('fit', 'Fit', {
        title: 'Per-object XY contour and hole compensation matching your 1/2/3-dot calibration strip',
        visibleWhen: () => pr.isOn(),
        options: () => FIT_OPTIONS.map((f) => ({ value: f.id, label: f.label })),
        get: () => readProf().fitChoice,
        set: (v) => patchProf({ fitChoice: v }),
      }),
      sel('layout', 'Layout', {
        title: 'Loose parts on the bed (default) or flat-pack kit tray with breakaway V-notches',
        visibleWhen: () => pr.isOn(),
        options: () => [
          { value: 'loose', label: 'Loose parts' },
          { value: 'sprue', label: 'Kit tray' },
        ],
        get: () => readProf().flatPackMode || 'loose',
        set: (v) => patchProf({ flatPackMode: v }),
      }),
      sel('plateSplit', 'Plates', {
        title: 'One set of plates per colour (default), or pack every part together whatever its colour',
        visibleWhen: () => pr.isOn() && typeof pr.setSplitByColour === 'function',
        options: () => [
          { value: 'colour', label: 'Split by colour' },
          { value: 'together', label: 'All together' },
        ],
        get: () => (pr.splitByColour?.() === false ? 'together' : 'colour'),
        set: (v) => pr.setSplitByColour(v !== 'together'),
      }),
      sel('colours', 'Colours', {
        title: 'Multi-colour plate strategy when more than one filament slot is available',
        visibleWhen: () => pr.isOn() && readProf().maxSlots > 1,
        options: () => [
          { value: 'auto', label: 'Auto (low waste)' },
          { value: 'by-layer', label: 'One plate, by layer' },
          { value: 'split-plates', label: 'One plate per colour' },
        ],
        get: () => readProf().multiColorStrategy === 'by-object' ? 'auto' : readProf().multiColorStrategy,
        set: (v) => patchProf({ multiColorStrategy: v }),
      }),
      sel('tooManyColours', 'Too many colours', {
        title: 'How to handle looks with more filament colours than loaded printer slots',
        visibleWhen: () => pr.isOn() && readProf().maxSlots > 1 && (pr.summary().sceneColorCount ?? 0) > readProf().maxSlots,
        options: () => [
          { value: 'extra-plates', label: 'Use extra plates' },
          { value: 'merge', label: `Auto-merge to ${readProf().maxSlots} colours` },
        ],
        get: () => readProf().tooManyColours || 'extra-plates',
        set: (v) => patchProf({ tooManyColours: v }),
      }),
      { kind: 'swatch', id: 'mergeSwatches', label: 'Colour merges',
        title: 'Filament colours auto-merged to fit the loaded slots: the left colour prints as the right colour',
        visibleWhen: () => pr.isOn() && (pr.summary().merges?.length ?? 0) > 0,
        chips: () => pr.summary().merges ?? [] },
      { kind: 'toggle', id: 'includeVehicle', label: 'Include vehicle',
        title: 'Include the active vehicle on dedicated plates in the print pack',
        visibleWhen: () => pr.isOn() && (hasVehicle() || !!pr.summary().hasVehicleInScene),
        get: () => readProf().includeVehicle !== false,
        set: (v) => patchProf({ includeVehicle: v }) },
      { kind: 'toggle', id: 'stickers', label: 'Stickers',
        title: 'Include 1:1 printable sticker sheet (PDF, print-then-cut PNG, vector cut SVG & DXF) in the print pack',
        visibleWhen: () => pr.isOn() && !!pr.summary().hasDecals,
        get: () => readProf().includeStickers !== false,
        set: (v) => patchProf({ includeStickers: v }) },
      { kind: 'preview', id: 'stickerPreview', label: 'Sticker sheet',
        title: 'Low-resolution preview of the 1:1 sticker sheet in the print pack (the exported PDF/PNG stays full resolution)',
        visibleWhen: () => pr.isOn() && !!pr.summary().hasDecals && readProf().includeStickers !== false,
        src: () => pr.summary().stickerPreviewUrl || '' },
      { kind: 'toggle', id: 'stencils', label: '3D stencils',
        title: 'Include support-free heightfield 3D paint & marker stencils (face, shirt, and 2x1 crown cap; Adult Tool Card in Kit tray mode)',
        visibleWhen: () => pr.isOn() && pr.summary().art !== false,
        get: () => !!readProf().includeStencils,
        set: (v) => patchProf({ includeStencils: v }) },
      { kind: 'toggle', id: 'supportCheck', label: 'Support check',
        title: 'Off: show true filament colours. On: show support-free tier colours and red overhang triangles.',
        visibleWhen: () => pr.isOn(),
        get: () => (pr.supportCheck ? pr.supportCheck() : false),
        set: (v) => pr.setSupportCheck?.(v) },
      sel('plate', 'Plate', {
        title: 'Choose which colour or support plate to inspect in the 3D workbench',
        visibleWhen: () => pr.isOn() && pr.plateCount() > 1,
        options: () => Array.from({ length: pr.plateCount() }, (_, i) => ({
          value: String(i),
          label: pr.plateLabel ? pr.plateLabel(i) : `Plate ${i + 1} of ${pr.plateCount()}`,
        })),
        get: () => String(Math.min(pr.plateIndex(), Math.max(0, pr.plateCount() - 1))),
        set: (v) => pr.setPlate(Number(v)),
      }),
      { kind: 'info', id: 'printInfo', visibleWhen: () => pr.isOn(), title: 'Plate summary, spool budget, and warnings',
        text: () => {
          const s = pr.summary();
          return [
            pr.busy() ? 'Packing…' : '',
            ...(s.lines ?? []),
            ...(s.errors ?? []).map((e) => `⚠ Missing or unusable: ${e}. Exports are disabled until this is fixed.`),
            ...(s.gatePending ? ['Waiting for a grown-up to approve the download…'] : []),
            ...(s.exportError ? [`⚠ ${s.exportError}`] : []),
            ...(s.unmapped?.length ? [`Not on the plate: ${s.unmapped.join('; ')}`] : []),
            ...(s.hasSprue ? ['Adult prep: snip kit-card runners at the V-notches with flush cutters and smooth any nibs.'] : []),
            ...(s.small?.length ? ['Small parts: choking hazard for children under 3.'] : []),
            s.note ?? '',
          ].filter(Boolean).join('\n');
        } },
      ...[['downloadPack', 'pack', '📦 Download print pack', 'Download kip-print-pack.zip with per-plate 3MFs & STLs, multi-plate project, optional stickers, print sheet PNG, layout.json, and README.txt', () => pr.isOn()],
        ['exportProject3mf', 'project-3mf', '🗂️ Project 3MF (all plates)', 'Download kip-project.3mf with every plate, colour slot, tree support setting, and socket guard pre-configured for 1-click slicing', () => pr.isOn()],
        ['export3mf', '3mf', '3MF (this plate)', 'Download the currently selected plate as a single-bed 3MF in your chosen slicer dialect', () => pr.isOn()],
        ['exportStickers', 'stickers-pdf', 'Sticker sheet (PDF)', 'Download the 1:1 actual-size printable sticker sheet PDF with 50.00 mm calibration bar', () => pr.isOn() && !!pr.summary().hasDecals && readProf().includeStickers !== false],
        ['exportStencils', 'stencils-stl', 'Stencils (STL)', 'Download support-free 3D paint & marker stencils as a binary STL (joined into an Adult Tool Card in Kit tray mode)', () => pr.isOn() && pr.summary().art !== false && !!readProf().includeStencils],
        ['exportSheet', 'sheet', 'Print sheet (PNG)', 'Download the visual plate map with colour swatches and boxed small-parts safety warning', () => pr.isOn()],
        ['exportStl', 'stl-zip', 'Export STL zip', 'Download every plate as one binary STL each, plus layout.json', () => pr.isOn()]]
        .map(([id, kind, label, title, visibleWhen]) => ({ kind: 'action', id, label, title, visibleWhen,
          disabled: () => pr.busy() || (pr.summary().errors ?? []).length > 0 || !!pr.summary().gatePending, run: () => pr.download(kind) })),
    ],
  };
}

/**
 * Every control of the retired bottom dock and the menu control that replaced it. The dock is gone from the page; this
 * table stays as the feature-parity record, and a test fails if a listed menu control stops existing.
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
.km-swatches { display: flex; flex-direction: column; gap: 4px; }
.km-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 650; color: var(--ink); }
.km-chip-dot { flex: 0 0 auto; width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--line); }
.km-chip-arrow { color: var(--muted); font-weight: 500; }
.km-preview-img { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: 9px; background: #fff; }
.km-preview-img[hidden] { display: none; }
.km select:focus-visible, .km button:focus-visible, .km summary:focus-visible, .km-switch input:focus-visible, .km-range input:focus-visible, .km-fab:focus-visible {
  outline: 2px solid var(--spark); outline-offset: 2px;
}
.km-fab { display: none; position: fixed; left: 12px; bottom: 40px; z-index: 13; padding: 9px 14px; font-size: 13px; border-radius: 999px; box-shadow: 0 8px 20px rgba(27, 34, 56, 0.16); background: var(--glass); backdrop-filter: blur(12px); }
.km-backdrop { display: none; position: fixed; inset: 0; z-index: 11; background: rgba(27, 34, 56, 0.28); }
.clean-ui .km, .clean-ui .km-fab, .clean-ui .km-backdrop { display: none !important; }
@media (max-width: ${DRAWER_BELOW_PX - 0.02}px) {
  .km { top: 0; bottom: 0; left: 0; width: min(86vw, 330px); border-radius: 0 18px 18px 0; transform: translateX(-105%); visibility: hidden; transition: transform 0.2s ease, visibility 0s linear 0.2s; }
  .km--collapsed { width: min(86vw, 330px); }
  .km--collapsed .km-body { display: flex; }
  .km.km--open { transform: none; visibility: visible; transition-delay: 0s; }
  .km-rail { display: none; }
  .km-fab { display: inline-flex; }
  .km-backdrop.km--open { display: block; }
  .menu-open .km-fab, .menu-open #version-pill { display: none; }
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

/**
 * Mount the panel. Returns a handle used by tests: { controls, groups, sync, rebind, park, destroy }.
 *
 * What the panel shows is the bench's DECLARATION: `ctx.groups()` (a bench that declares its own sections, such as the Truck) or, without it, the
 * Kip's own `buildMenu(ctx)`. One panel can serve several benches (Workshop stage 4c, see createMenuHost): `rebind(ctx, { root })` points it at
 * another bench's declaration and root, `park()` takes it out of the page. `ctx.title` names the panel ("Customize Kip" by default).
 */
export function mountKipMenu(firstCtx, { root: firstRoot = document.body } = {}) {
  let ctx = firstCtx;
  let root = firstRoot;
  let loco = ctx.loco;
  let groups = [];
  let flatControls = [];
  let byId = new Map();
  let fields = new Map();
  let bound = true;

  // Preset tracking: "Custom" once anything a preset sets has changed since the last apply. The active
  // preset id changing (from any route: this menu, a URL param, a programmatic setter) marks the moment its result
  // was applied. Re-applying the same preset after edits goes through applyPresetTracked below.
  // A bench with no looks to track (no `ctx.read.preset`, the Truck) skips it.
  // The tracking lives on the bench's ctx, so pointing the panel at another bench and back keeps "Leo Explorer, edited" as it was.
  const track = () => (ctx.presetTrack ??= { sig: null, last: null });
  const stateSig = () => JSON.stringify(flatControls.filter((c) => c.inPreset && c.id !== 'preset').map((c) => c.get()));
  function wirePresets() {
    if (!ctx.read?.preset) return;
    ctx.presetValue = () => {
      const t = track();
      const cur = ctx.read.preset();
      if (!ctx.ready()) return cur;
      const sig = stateSig();
      if (t.sig === null || cur !== t.last) { t.sig = sig; t.last = cur; }
      return sig === t.sig ? cur : CUSTOM_PRESET;
    };
    ctx.applyPresetTracked = (id) => {
      const t = track();
      ctx.act.applyPreset(id);
      t.last = ctx.read.preset();
      t.sig = stateSig();
    };
  }

  const style = el('style', { id: 'km-style', text: CSS });
  document.head.append(style);

  // ---- structure -------------------------------------------------------------------------
  const narrow = window.matchMedia(`(max-width: ${DRAWER_BELOW_PX - 0.02}px)`);
  const panel = el('aside', { id: 'kip-menu', class: 'km', 'aria-label': 'Customize Kip', 'aria-busy': 'true' });
  const body = el('div', { class: 'km-body', id: 'km-body' });
  const scroll = el('div', { class: 'km-scroll' });
  const titleEl = el('div', { class: 'km-title', text: 'Customize Kip' });
  body.append(titleEl, scroll);

  const rail = el('div', { class: 'km-rail' });
  const toggleBtn = el('button', { type: 'button', class: 'km-toggle', 'aria-controls': 'km-body', 'aria-label': 'Collapse panel', title: 'Collapse panel' }, '‹');
  rail.append(toggleBtn);
  panel.append(rail, body);

  const fab = el('button', { type: 'button', class: 'km-fab', 'aria-controls': 'kip-menu', 'aria-expanded': 'false' }, '☰ Customize');
  const backdrop = el('div', { class: 'km-backdrop' });

  // The groups are the bench's declaration; which ones are folded is remembered by group id across a rebind (the Print group stays as you left it).
  const folded = new Map();
  function buildGroups() {
    for (const g of groups) if (g.details) folded.set(g.id, g.details.open);
    groups = ctx.groups ? ctx.groups() : buildMenu(ctx);
    flatControls = flattenMenu(groups);
    byId = new Map(flatControls.map((c) => [c.id, c]));
    fields = new Map();
    scroll.replaceChildren();
    rail.replaceChildren(toggleBtn);
    for (const g of groups) {
      const details = el('details', { class: 'km-group', open: folded.get(g.id) ?? true, 'data-group': g.id });
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
  }
  function retitle() {
    const title = ctx.title ?? 'Customize Kip';
    titleEl.textContent = title;
    panel.setAttribute('aria-label', title);
    fab.textContent = ctx.fabLabel ?? '☰ Customize';
  }
  function attach(nextRoot) {
    if (root !== nextRoot) root.classList.remove('menu-side', 'menu-open');
    root = nextRoot;
    root.classList.add('menu-side');
    root.append(panel, fab, backdrop);
  }

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
      input.addEventListener('change', () => {
        Promise.resolve(c.set(input.checked)).finally(sync);
        if (lastInputWasPointer) input.blur(); // a clicked switch must not keep the keys (the Truck's drive keys, Space to brake): keyboard users keep focus
        sync();
      });
      const row = el('label', { class: 'km-switch', for: id, title }, text, input);
      return { root: el('div', { class: 'km-field', 'data-control': c.id }, row), input };
    }
    if (c.kind === 'range') {
      const val = (v) => (typeof v === 'function' ? v() : v); // a bench may bound a slider by its own state (the Truck's dump tip depends on the stage)
      const input = el('input', { id, type: 'range', min: val(c.min), max: val(c.max), step: c.step, title, 'aria-labelledby': `${id}-lbl` });
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
    if (c.kind === 'swatch') {
      const box = el('div', { class: 'km-swatches', id, title });
      return { root: el('div', { class: 'km-field', 'data-control': c.id }, el('div', { class: 'km-lbl', text: c.label }), box), box, sig: '' };
    }
    if (c.kind === 'preview') {
      const img = el('img', { class: 'km-preview-img', id, alt: 'Sticker sheet preview', title, hidden: true });
      return { root: el('div', { class: 'km-field', 'data-control': c.id }, el('div', { class: 'km-lbl', text: c.label }), img), img };
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
          if (typeof c.min === 'function' && f.input.min !== String(c.min())) f.input.min = String(c.min());
          if (typeof c.max === 'function' && f.input.max !== String(c.max())) f.input.max = String(c.max());
          const v = String(c.get());
          if (document.activeElement !== f.input && f.input.value !== v) f.input.value = v;
          f.out.textContent = f.input.value;
        } else if (c.kind === 'info') {
          const t = c.text();
          if (f.box.textContent !== t) f.box.textContent = t;
        } else if (c.kind === 'swatch') {
          const chips = c.chips ? c.chips() : [];
          const sig = chips.map((m) => `${m.fromHex}>${m.toHex}`).join('\n');
          if (f.sig !== sig) {
            f.sig = sig;
            f.box.replaceChildren(...chips.map((m) => el('span', { class: 'km-chip' },
              el('span', { class: 'km-chip-dot', style: `background:${m.fromHex}` }),
              el('span', { text: m.fromName || m.fromHex }),
              el('span', { class: 'km-chip-arrow', text: '→' }),
              el('span', { class: 'km-chip-dot', style: `background:${m.toHex}` }),
              el('span', { text: m.toName || m.toHex }))));
          }
        } else if (c.kind === 'preview') {
          const src = c.src ? c.src() : '';
          if (src) {
            if (f.img.getAttribute('src') !== src) f.img.setAttribute('src', src);
            f.img.hidden = false;
          } else {
            f.img.hidden = true;
            f.img.removeAttribute('src');
          }
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
  const onNarrow = () => { setOpen(false); applyViewOffset(); };
  narrow.addEventListener('change', onNarrow);
  window.addEventListener('resize', applyViewOffset); // registered after the demo's own resize handler, so it runs second

  let lastOffsetKey = '';
  function applyViewOffset() {
    const cam = ctx.camera;
    if (!bound || !cam || typeof cam.setViewOffset !== 'function') return;
    const hidden = root.classList.contains('clean-ui');
    const covered = hidden || narrow.matches ? 0 : (collapsed ? RAIL_W : PANEL_W) + 14;
    const { width: w, height: h } = ctx.viewSize ? ctx.viewSize() : { width: window.innerWidth, height: window.innerHeight };
    const key = `${covered}|${w}|${h}`;
    if (key === lastOffsetKey) return;
    lastOffsetKey = key;
    if (covered === 0) cam.clearViewOffset();
    else cam.setViewOffset(w, h, -covered / 2, 0, w, h); // negative x: scene shifts right, into the free area
    cam.updateProjectionMatrix();
  }
  attach(root);
  wirePresets();
  buildGroups();
  retitle();
  setCollapsed(collapsed);

  /** Point the panel at another bench: its declaration, its root, its camera. The panel's own state (folded groups, collapsed) is kept. */
  function rebind(nextCtx, { root: nextRoot = root } = {}) {
    if (bound) ctx.camera?.clearViewOffset?.();
    setOpen(false);
    ctx = nextCtx;
    loco = ctx.loco;
    attach(nextRoot);
    wirePresets();
    buildGroups();
    retitle();
    bound = true;
    lastReady = null;
    lastOffsetKey = '';
    sync();
    applyViewOffset();
  }
  /** Take the panel out of the page (the bench that had it stood down); `rebind` puts it back. */
  function park() {
    if (!bound) return;
    bound = false;
    setOpen(false);
    panel.remove(); fab.remove(); backdrop.remove();
    root.classList.remove('menu-side', 'menu-open');
    ctx.camera?.clearViewOffset?.();
  }

  // ---- tick ------------------------------------------------------------------------------
  // A timer, not requestAnimationFrame: sync cost must not depend on how slow a frame renders.
  const tick = () => {
    if (!bound || document.hidden || ctx.isActive?.() === false) return; // a bench that is switched away must not touch the shared camera
    sync();
    applyViewOffset(); // also reacts to H / ?clean=1 toggling the clean-ui class
  };
  sync();
  const timer = setInterval(tick, 100);

  return {
    get ctx() { return ctx; },
    get groups() { return groups; },
    get controls() { return byId; },
    get fields() { return fields; },
    get parked() { return !bound; },
    sync,
    rebind,
    park,
    applyViewOffset,
    /** Forget the camera offset applied last (the stage cleared it when this bench stood down), so the next tick applies it again. */
    resetViewOffset() { lastOffsetKey = ''; },
    get presetSig() { return track().sig; },
    destroy() {
      clearInterval(timer);
      document.removeEventListener('keydown', onDocKey, true);
      window.removeEventListener('resize', applyViewOffset);
      narrow.removeEventListener('change', onNarrow);
      panel.remove(); fab.remove(); backdrop.remove(); style.remove();
      root.classList.remove('menu-side', 'menu-open');
      ctx.camera?.clearViewOffset?.();
      bound = false;
    },
  };
}

/**
 * The one menu a host (the Workshop) gives its benches (stage 4c). A bench mounted on its own makes a private host and shows its menu at once;
 * in the Workshop the shell makes one and every bench that has a menu shows ITS declaration on it when it becomes active and hides it when it
 * stands down. One panel, one set of element ids in the page (two panels would repeat every `km-*` id and a label would point into the wrong one).
 */
export function createMenuHost() {
  let menu = null;
  let owner = null;
  return {
    /** Bench `id` takes the menu: the first call mounts the panel, later ones re-point it at this bench's `ctx` inside its `root`. Returns the panel's handle. */
    show(id, ctx, { root }) {
      if (menu) menu.rebind(ctx, { root });
      else menu = mountKipMenu(ctx, { root });
      owner = id;
      return menu;
    },
    /** Bench `id` stands down: if it still holds the menu, park it (a later `show` brings it back). */
    hide(id) {
      if (menu && owner === id) {
        menu.park();
        owner = null;
      }
    },
    get owner() { return owner; },
    get menu() { return menu; },
    destroy() {
      menu?.destroy();
      menu = null;
      owner = null;
    },
  };
}
