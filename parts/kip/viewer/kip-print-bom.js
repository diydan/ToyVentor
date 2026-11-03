// Pure Bill-of-Materials & Filament-Colour Resolver for Kip's 3D Print Workflow.
// Zero DOM, storage, network, or Three.js dependencies. Single shared colour truth
// with `kip-vehicles-wardrobe.js` via `resolveBodyColors` and `EXP_PALETTE`.

import {
  SKIN_TONES,
  HAIR_COLORS,
  HAT_COLORS,
  HAIR_OPTIONS,
  WEARABLE_HAT_IDS,
  headphonesFit,
  HAT_OPTIONS,
  SHIRT_OPTIONS,
  PANTS_OPTIONS,
  WORKSHOP_PROPS,
  HUMAN_HEAD_IDS,
  EXP_PALETTE,
  resolveBodyColors,
} from './kip-vehicles-wardrobe.js?v=10.0';

export const DEFAULT_BASE_COLORS = Object.freeze({
  shell:    '#F4EFE6',
  hood:     '#CCC1AE',
  spark:    '#FF6B4A',
  visor:    '#1C2338',
  eyes:     '#B8E8FF',
  glints:   '#FFFFFF',
  cheeks:   '#FF6B4A',
  snapSky:  '#4EB3FC',
  snapMint: '#43D69C',
  snapGold: '#F8C232',
  proSlate: '#36405C',
  proGear:  '#F0B238',
});

// Exact PartSpec file map derived from `public/kip/partspec-validation.json` (and overrideable at runtime via `validationIndex`).
export const DEFAULT_CATALOG_PART_FILES = Object.freeze({
  beam_str_tu03: '/kip/partspec/toyventor_beam_str_tu03_P.stl',
  beam_str_tu05: '/kip/partspec/toyventor_beam_str_tu05_P.stl',
  bumper_horns: '/kip/partspec/toyventor_bumper_horns_S.stl',
  bushing_half: '/kip/partspec/toyventor_bushing_half_P.stl',
  char_faceplate: '/kip/partspec/toyventor_char_faceplate_P.stl',
  char_faceplate_flat: '/kip/partspec/toyventor_char_faceplate_flat_P.stl',
  char_faceplate_vinyl: '/kip/partspec/toyventor_char_faceplate_vinyl_P.stl',
  char_head_alien: '/kip/partspec/toyventor_char_head_alien_S.stl',
  char_head_bear: '/kip/partspec/toyventor_char_head_bear_S.stl',
  char_head_cat: '/kip/partspec/toyventor_char_head_cat_S.stl',
  char_head_chibi: '/kip/partspec/toyventor_char_head_chibi_S.stl',
  char_head_dragon: '/kip/partspec/toyventor_char_head_dragon_S.stl',
  char_head_fox: '/kip/partspec/toyventor_char_head_fox_S.stl',
  char_head_imp: '/kip/partspec/toyventor_char_head_imp_S.stl',
  char_head_jumbo: '/kip/partspec/toyventor_char_head_jumbo_S.stl',
  char_head_kid: '/kip/partspec/toyventor_char_head_kid_S.stl',
  char_head_tall: '/kip/partspec/toyventor_char_head_tall_S.stl',
  char_legs_seated: '/kip/partspec/toyventor_char_legs_seated_S.stl',
  cloud_wings: '/kip/partspec/toyventor_cloud_wings_S.stl',
  cross_connector_tu01: '/kip/partspec/toyventor_cross_connector_tu01_P.stl',
  gear_spur_z10: '/kip/partspec/toyventor_gear_spur_z10_P.stl',
  gear_spur_z20: '/kip/partspec/toyventor_gear_spur_z20_P.stl',
  glow_capsule: '/kip/partspec/toyventor_glow_capsule_S.stl',
  hair_bob: '/kip/partspec/toyventor_hair_bob_S.stl',
  hair_bowl: '/kip/partspec/toyventor_hair_bowl_S.stl',
  hair_curly: '/kip/partspec/toyventor_hair_curly_S.stl',
  hair_long_layered: '/kip/partspec/toyventor_hair_long_layered_S.stl',
  hair_low_bun: '/kip/partspec/toyventor_hair_low_bun_S.stl',
  hair_mohawk: '/kip/partspec/toyventor_hair_mohawk_S.stl',
  hair_pigtails: '/kip/partspec/toyventor_hair_pigtails_S.stl',
  hair_pixie: '/kip/partspec/toyventor_hair_pixie_S.stl',
  hair_pompadour: '/kip/partspec/toyventor_hair_pompadour_S.stl',
  hair_ponytail: '/kip/partspec/toyventor_hair_ponytail_S.stl',
  hair_shag: '/kip/partspec/toyventor_hair_shag_S.stl',
  hair_short_swept: '/kip/partspec/toyventor_hair_short_swept_S.stl',
  hair_side_pony: '/kip/partspec/toyventor_hair_side_pony_S.stl',
  hair_side_sweep: '/kip/partspec/toyventor_hair_side_sweep_S.stl',
  hair_slick: '/kip/partspec/toyventor_hair_slick_S.stl',
  hair_spiky: '/kip/partspec/toyventor_hair_spiky_S.stl',
  hair_swoosh: '/kip/partspec/toyventor_hair_swoosh_S.stl',
  hair_top_bun: '/kip/partspec/toyventor_hair_top_bun_S.stl',
  hair_twin_braids: '/kip/partspec/toyventor_hair_twin_braids_S.stl',
  hat_ballcap: '/kip/partspec/toyventor_hat_ballcap_S.stl',
  hat_beanie: '/kip/partspec/toyventor_hat_beanie_S.stl',
  hat_cowboy: '/kip/partspec/toyventor_hat_cowboy_S.stl',
  hat_hardhat: '/kip/partspec/toyventor_hat_hardhat_S.stl',
  hat_headphones: '/kip/partspec/toyventor_hat_headphones_S.stl',
  hat_pirate: '/kip/partspec/toyventor_hat_pirate_S.stl',
  hat_ranger: '/kip/partspec/toyventor_hat_ranger_S.stl',
  hat_tophat: '/kip/partspec/toyventor_hat_tophat_S.stl',
  pack_explorer: '/kip/partspec/toyventor_pack_explorer_S.stl',
  pin_friction: '/kip/partspec/toyventor_pin_friction_P.stl',
  pointy_ears: '/kip/partspec/toyventor_pointy_ears_S.stl',
  prop_broom: '/kip/partspec/toyventor_prop_broom_P.stl',
  prop_flag: '/kip/partspec/toyventor_prop_flag_P.stl',
  prop_frying_pan: '/kip/partspec/toyventor_prop_frying_pan_P.stl',
  prop_guitar: '/kip/partspec/toyventor_prop_guitar_P.stl',
  prop_hammer: '/kip/partspec/toyventor_prop_hammer_P.stl',
  prop_magnifier: '/kip/partspec/toyventor_prop_magnifier_P.stl',
  prop_maracas: '/kip/partspec/toyventor_prop_maracas_P.stl',
  prop_mop: '/kip/partspec/toyventor_prop_mop_P.stl',
  prop_paint_roller: '/kip/partspec/toyventor_prop_paint_roller_P.stl',
  prop_screwdriver: '/kip/partspec/toyventor_prop_screwdriver_P.stl',
  prop_scrub_brush: '/kip/partspec/toyventor_prop_scrub_brush_P.stl',
  prop_skateboard_deck: '/kip/partspec/toyventor_prop_skateboard_deck_S.stl',
  prop_spatula: '/kip/partspec/toyventor_prop_spatula_P.stl',
  prop_star_shield: '/kip/partspec/toyventor_prop_star_shield_P.stl',
  prop_trumpet: '/kip/partspec/toyventor_prop_trumpet_P.stl',
  prop_upright_vacuum: '/kip/partspec/toyventor_prop_upright_vacuum_P.stl',
  prop_vacuum: '/kip/partspec/toyventor_prop_vacuum_P.stl',
  prop_wrench: '/kip/partspec/toyventor_prop_wrench_P.stl',
  racer_axle: '/kip/partspec/toyventor_racer_axle_S.stl',
  racer_axle_block: '/kip/partspec/toyventor_racer_axle_block_S.stl',
  racer_bull_bar: '/kip/partspec/toyventor_racer_bull_bar_S.stl',
  racer_hood_scoop: '/kip/partspec/toyventor_racer_hood_scoop_S.stl',
  racer_light_bar: '/kip/partspec/toyventor_racer_light_bar_S.stl',
  racer_roof_rack: '/kip/partspec/toyventor_racer_roof_rack_S.stl',
  racer_spoiler: '/kip/partspec/toyventor_racer_spoiler_S.stl',
  racer_twin_exhaust: '/kip/partspec/toyventor_racer_twin_exhaust_S.stl',
  racer_wheel: '/kip/partspec/toyventor_racer_wheel_S.stl',
  robot_back_jetpack: '/kip/partspec/toyventor_robot_back_jetpack_S.stl',
  robot_head_scout: '/kip/partspec/toyventor_robot_head_scout_S.stl',
  robot_head_visor: '/kip/partspec/toyventor_robot_head_visor_S.stl',
  shaft_tu03: '/kip/partspec/toyventor_shaft_tu03_P.stl',
  shaft_tu05: '/kip/partspec/toyventor_shaft_tu05_P.stl',
  shaft_tu07: '/kip/partspec/toyventor_shaft_tu07_P.stl',
  veh_cab_roof_cover: '/kip/partspec/toyventor_veh_cab_roof_cover_S.stl',
  veh_car_chassis: '/kip/partspec/toyventor_veh_car_chassis_S.stl',
  veh_car_hood_cover: '/kip/partspec/toyventor_veh_car_hood_cover_S.stl',
  veh_handlebar_fork: '/kip/partspec/toyventor_veh_handlebar_fork_P.stl',
  veh_moto_cowling: '/kip/partspec/toyventor_veh_moto_cowling_S.stl',
  veh_scooter_fairing: '/kip/partspec/toyventor_veh_scooter_fairing_S.stl',
  veh_scooter_frame: '/kip/partspec/toyventor_veh_scooter_frame_S.stl',
  veh_steering_wheel: '/kip/partspec/toyventor_veh_steering_wheel_P.stl',
  veh_truck_bed_cover: '/kip/partspec/toyventor_veh_truck_bed_cover_S.stl',
  veh_truck_chassis: '/kip/partspec/toyventor_veh_truck_chassis_S.stl',
  veh_wheel_moto: '/kip/partspec/toyventor_veh_wheel_moto_P.stl',
  veh_wheel_offroad: '/kip/partspec/toyventor_veh_wheel_offroad_P.stl',
  veh_wheel_sport: '/kip/partspec/toyventor_veh_wheel_sport_P.stl',
  waddle_tail_s: '/kip/partspec/toyventor_waddle_tail_s_S.stl',
  wheel_tu04: '/kip/partspec/toyventor_wheel_tu04_P.stl',
  wheel_tu06: '/kip/partspec/toyventor_wheel_tu06_P.stl',
  wobble_hat: '/kip/partspec/toyventor_wobble_hat_S.stl',
});

export const ACCENT_OVERLAY_FILES = Object.freeze({
  crown_buds_2x1:        '/kip/partspec/toyventor_crown_buds_2x1.stl',
  veh_wheel_sport_rim:   '/kip/partspec/toyventor_veh_wheel_sport_rim.stl',
  veh_wheel_offroad_rim: '/kip/partspec/toyventor_veh_wheel_offroad_rim.stl',
  veh_wheel_moto_rim:    '/kip/partspec/toyventor_veh_wheel_moto_rim.stl',
});

export const CUSTOM_EXAMPLE_FILES = Object.freeze({
  custom_wizard_hat: '/kip/custom/toyventor_custom_wizard_hat_S.stl',
  custom_star_wand:  '/kip/custom/toyventor_custom_star_wand_P.stl',
  custom_hood_crest: '/kip/custom/toyventor_custom_hood_crest_S.stl',
});

const COLOR_NAME_BY_HEX = new Map([
  ['#F4EFE6', 'Warm Shell Cream'],
  ['#CCC1AE', 'Oatmeal Hood'],
  ['#FF6B4A', 'Coral Spark'],
  ['#1C2338', 'Midnight Visor'],
  ['#B8E8FF', 'Ice Sky Eyes'],
  ['#FFFFFF', 'Pure White'],
  ['#4EB3FC', 'Snap Sky Blue'],
  ['#43D69C', 'Snap Mint'],
  ['#F8C232', 'Snap Gold'],
  ['#36405C', 'Pro Slate'],
  ['#F0B238', 'Pro Gear Gold'],
  ['#2A3F66', 'Scout Navy'],
  ['#283044', 'Sneaker Slate'],
  ['#2E6FDB', 'Cobalt Blue'],
  ['#1FA6A0', 'Explorer Teal'],
  ['#7C4DFF', 'Magic Plum'],
  ['#FFB830', 'Sun Gold'],
  ['#E86F38', 'Fox Orange'],
  ['#B58052', 'Bear Cocoa'],
  ['#DCE3EE', 'Bot Silver'],
  ['#4E73A8', 'Scout Steel'],
  ['#E5C193', 'Cat Cream'],
  ['#2EB872', 'Dragon Green'],
  ['#5CD6A9', 'Alien Mint'],
  ['#6E85E6', 'Imp Periwinkle'],
  ['#20232A', 'Tire Charcoal'],
  ['#EDF2F8', 'Alloy Silver'],
  ['#FFD25A', 'Beadlock Gold'],
  ['#242B3D', 'Varsity Navy'],
  ['#D63A34', 'Crimson Red'],
  ['#2D5FA8', 'Denim Blue'],
  ['#2B4C85', 'Indigo Jeans'],
  ['#2F5596', 'Overall Denim'],
  ['#C5A478', 'Cargo Khaki'],
  ['#C89F70', 'Warm Khaki'],
  ['#22304C', 'Sport Navy'],
  ['#1F9D97', 'Track Teal'],
]);

for (const s of SKIN_TONES) {
  const h = s.hex.toUpperCase();
  if (!COLOR_NAME_BY_HEX.has(h)) COLOR_NAME_BY_HEX.set(h, s.label);
}
for (const c of HAIR_COLORS) {
  const h = c.hex.toUpperCase();
  if (!COLOR_NAME_BY_HEX.has(h)) COLOR_NAME_BY_HEX.set(h, c.label);
}
for (const c of HAT_COLORS) {
  const h = c.hex.toUpperCase();
  if (!COLOR_NAME_BY_HEX.has(h)) COLOR_NAME_BY_HEX.set(h, c.label);
}

export function normHex(hex, fallback = '#F4EFE6') {
  if (typeof hex !== 'string') return fallback.toUpperCase();
  const s = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toUpperCase()}`;
  return fallback.toUpperCase();
}

export function colorNameForHex(hex) {
  const h = normHex(hex);
  return COLOR_NAME_BY_HEX.get(h) || h;
}

export function colorSlug(hex) {
  const name = colorNameForHex(hex);
  if (name.startsWith('#')) return `hex_${name.slice(1).toLowerCase()}`;
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'colour';
}

export function buildCatalogFileMap(validationIndex, manifestParts) {
  const out = { ...DEFAULT_CATALOG_PART_FILES };
  if (validationIndex && typeof validationIndex.files === 'object') {
    for (const [fname, meta] of Object.entries(validationIndex.files)) {
      if (meta && typeof meta.part === 'string' && fname.endsWith('.stl')) {
        out[meta.part] = `/kip/partspec/${fname}`;
      }
    }
  }
  if (Array.isArray(manifestParts)) {
    for (const p of manifestParts) {
      if (p && typeof p.id === 'string' && typeof p.file === 'string') {
        out[p.id] = p.file.startsWith('/') ? p.file : `/kip/partspec/${p.file}`;
      }
    }
  }
  return out;
}

const HEAD_PART_ID = Object.freeze({
  kid:    'char_head_kid',
  chibi:  'char_head_chibi',
  tall:   'char_head_tall',
  jumbo:  'char_head_jumbo',
  fox:    'char_head_fox',
  bear:   'char_head_bear',
  cat:    'char_head_cat',
  dragon: 'char_head_dragon',
  alien:  'char_head_alien',
  imp:    'char_head_imp',
  robot:  'robot_head_visor',
  scout:  'robot_head_scout',
});

const FACE_PART_ID = Object.freeze({
  sculpted: 'char_faceplate',
  vinyl:    'char_faceplate_vinyl',
  flat:     'char_faceplate_flat',
});

const NON_HUMAN_HEAD_HEX = Object.freeze({
  fox:    EXP_PALETTE.fox,
  bear:   EXP_PALETTE.bear,
  robot:  EXP_PALETTE.botSilv,
  scout:  EXP_PALETTE.botScout,
  cat:    EXP_PALETTE.cat,
  dragon: EXP_PALETTE.dragon,
  alien:  EXP_PALETTE.alien,
  imp:    EXP_PALETTE.imp,
});

function resolvePropMatHex(matKey, base) {
  if (matKey === 'spark') return base.spark;
  if (EXP_PALETTE[matKey]) return normHex(EXP_PALETTE[matKey]);
  if (base[matKey]) return base[matKey];
  return base.spark;
}

/**
 * Resolve the exact on-screen scene Bill of Materials, filament hexes, accent overlays,
 * craft/sticker decals, and unmapped craft items.
 *
 * @param {object} [state]
 * @param {object} [opts]
 * @param {boolean} [opts.includeVehicle=true]
 * @param {object} [opts.validationIndex]
 * @param {Array}  [opts.manifestParts]
 */
export function resolveSceneBom(state = {}, opts = {}) {
  const includeVehicle = opts.includeVehicle !== undefined
    ? Boolean(opts.includeVehicle)
    : (state.includeVehicle !== undefined ? Boolean(state.includeVehicle) : true);
  const catalogFiles = buildCatalogFileMap(opts.validationIndex, opts.manifestParts);

  const rawBase = state.baseColors || {};
  const base = {};
  for (const [k, defHex] of Object.entries(DEFAULT_BASE_COLORS)) {
    base[k] = normHex(rawBase[k] || defHex, defHex);
  }

  const edition = state.edition === 'snap' ? 'snap' : 'pro';
  const head = state.head || 'kid';
  const isHuman = HUMAN_HEAD_IDS.has(head);
  const expr = state.expr || (state.selfie ? 'selfie' : 'spark');
  const isSelfie = Boolean(state.selfie) || expr === 'selfie';
  const faceInsert = (isHuman && isSelfie) ? 'flat' : (state.faceInsert || 'sculpted');
  const skinId = state.skin || 'vinyl_cream';
  const shirtId = state.shirt || 'off';
  const pantsId = state.pants || 'off';
  const hairId = state.hair || 'off';
  const hatId = state.hat ?? state.crown ?? 'buds';
  const earsId = state.ears || 'off';
  const backId = state.back || 'off';
  const tailId = state.tail || 'off';
  const propId = state.prop || 'off';
  const vehicleId = state.vehicle || 'none';
  const vehCovers = state.vehCovers !== false;
  const racerKit = Boolean(state.racerKit);

  const customSlots = state.customStlSlots || {};
  const photoSlots = state.photoAccessorySlots || {};
  const customHoodMode = state.customHoodMode || (state.customHoodCrest ? 'sdkCrest' : 'none');

  const body = resolveBodyColors({
    head,
    skinId,
    shirtId,
    pantsId,
    sparkHex: base.spark,
  });

  const rawChar = [];
  const rawVeh = [];
  const unmapped = [];
  const decals = [];
  const notes = [];

  const scadFile = (id) => `/kip/stls/${id}.stl`;
  const catFile = (id) => {
    const f = catalogFiles[id];
    if (!f) throw new Error(`Missing catalog STL path for part "${id}"`);
    return f;
  };

  function pushPart(target, {
    id,
    file,
    qty = 1,
    hex,
    role = 'body',
    source = 'kip.scad',
    group = 'character',
    accents = [],
    bytes = null,
    customName = '',
  }) {
    if (!qty || qty <= 0) return null;
    const h = normHex(hex, base.shell);
    const entry = {
      id,
      file,
      qty,
      hex: h,
      colorName: colorNameForHex(h),
      material: 'PLA',
      role,
      source,
      group,
      accents: accents.map(a => ({
        ...a,
        hex: normHex(a.hex, base.spark),
        colorName: colorNameForHex(a.hex),
      })),
    };
    if (bytes) {
      entry.bytes = bytes;
      entry.customName = customName || id;
    }
    target.push(entry);
    return entry;
  }

  // -------------------------------------------------------------------------
  // 1. Body, Limbs, Hands, Boots & Edition Joints (§4.1 — no seated leg swap)
  // -------------------------------------------------------------------------
  if (edition === 'pro') {
    pushPart(rawChar, { id: 'torso',      file: scadFile('torso'),      qty: 1, hex: body.chestHex,   role: 'clothing' });
    pushPart(rawChar, { id: 'upper_arm',  file: scadFile('upper_arm'),  qty: 2, hex: body.sleeveHex,  role: 'clothing' });
    pushPart(rawChar, { id: 'forearm',    file: scadFile('forearm'),    qty: 2, hex: body.forearmHex, role: body.hasShirt && SHIRT_OPTIONS.find(s => s.id === shirtId)?.longSleeve ? 'clothing' : 'skin' });
    pushPart(rawChar, { id: 'thigh',      file: scadFile('thigh'),      qty: 2, hex: body.thighHex,   role: body.hasPants ? 'clothing' : 'skin' });
    pushPart(rawChar, { id: 'shin',       file: scadFile('shin'),       qty: 2, hex: body.shinHex,    role: body.hasPants && !PANTS_OPTIONS.find(p => p.id === pantsId)?.isShorts ? 'clothing' : 'skin' });

    // Pro Joints: 4 big pegs (2 shoulder + 2 hip) + 8 small pegs (2 elbow + 2 wrist + 2 knee + 2 ankle)
    pushPart(rawChar, { id: 'spark_peg_big', file: scadFile('spark_peg_big'), qty: 2, hex: body.joints.shoulder, role: 'joint' });
    pushPart(rawChar, { id: 'spark_peg_big', file: scadFile('spark_peg_big'), qty: 2, hex: body.joints.hip,      role: 'joint' });
    pushPart(rawChar, { id: 'spark_peg_sml', file: scadFile('spark_peg_sml'), qty: 2, hex: body.joints.elbow, role: 'joint' });
    pushPart(rawChar, { id: 'spark_peg_sml', file: scadFile('spark_peg_sml'), qty: 2, hex: body.joints.wrist, role: 'joint' });
    pushPart(rawChar, { id: 'spark_peg_sml', file: scadFile('spark_peg_sml'), qty: 2, hex: body.joints.knee,  role: 'joint' });
    pushPart(rawChar, { id: 'spark_peg_sml', file: scadFile('spark_peg_sml'), qty: 2, hex: body.joints.ankle, role: 'joint' });
  } else {
    pushPart(rawChar, { id: 'snap_torso', file: scadFile('snap_torso'), qty: 1, hex: body.chestHex,   role: 'clothing' });
    pushPart(rawChar, { id: 'snap_arm',   file: scadFile('snap_arm'),   qty: 2, hex: body.forearmHex, role: body.hasShirt && SHIRT_OPTIONS.find(s => s.id === shirtId)?.longSleeve ? 'clothing' : 'skin' });
    pushPart(rawChar, { id: 'snap_leg',   file: scadFile('snap_leg'),   qty: 2, hex: body.thighHex,   role: body.hasPants ? 'clothing' : 'skin' });

    // Snap Joints: 4 big turrets (2 shoulder + 2 hip) + 4 small turrets (2 wrist + 2 ankle)
    pushPart(rawChar, { id: 'snap_turret_big', file: scadFile('snap_turret_big'), qty: 2, hex: body.joints.shoulder, role: 'joint' });
    pushPart(rawChar, { id: 'snap_turret_big', file: scadFile('snap_turret_big'), qty: 2, hex: body.joints.hip,      role: 'joint' });
    pushPart(rawChar, { id: 'snap_turret', file: scadFile('snap_turret'), qty: 2, hex: body.joints.wrist, role: 'joint' });
    pushPart(rawChar, { id: 'snap_turret', file: scadFile('snap_turret'), qty: 2, hex: body.joints.ankle, role: 'joint' });
  }

  pushPart(rawChar, { id: 'hand_l', file: scadFile('hand_l'), qty: 1, hex: body.bodySkinHex,   role: 'skin' });
  pushPart(rawChar, { id: 'hand_r', file: scadFile('hand_r'), qty: 1, hex: body.bodySkinHex,   role: 'skin' });
  pushPart(rawChar, { id: 'boot',   file: scadFile('boot'),   qty: 2, hex: body.activeShoeHex, role: 'shoes' });

  // Back Dock 2x2 studs insert (absent when Pro 2:1 Gears mount into the central Ø7.0 bore)
  if (backId !== 'gears') {
    pushPart(rawChar, { id: 'back_dock_studs', file: scadFile('back_dock_studs'), qty: 1, hex: base.spark, role: 'accent' });
  }

  if (body.hasShirt) {
    decals.push({ kind: 'shirt', shirtId, planeMm: [18.8, 21.6] });
  }

  // -------------------------------------------------------------------------
  // 2. Head, Neck Collar, Face Insert, Wigs, Hats & Crown Buds (§4.2)
  // -------------------------------------------------------------------------
  const hairOpt = HAIR_OPTIONS.find(h => h.id === hairId) || HAIR_OPTIONS[0];
  const hasHair = hairOpt.id !== 'off';
  const canWearHat = Boolean(hairOpt.hatReady);
  const exposedCrownBuds = canWearHat && hatId === 'buds';

  let headEntry = null;
    pushPart(rawChar, { id: 'neck_turret_2x1', file: scadFile('neck_turret_2x1'), qty: 1, hex: body.neckHex, role: 'skin' });

    if (head === 'custom') {
      const customHead = customSlots.head;
      if (customHead && customHead.bytes) {
        headEntry = pushPart(rawChar, {
          id: 'custom_head_stl',
          file: 'memory://custom_head.stl',
          qty: 1,
          hex: customHead.colorHex || EXP_PALETTE.custom,
          role: 'head',
          source: 'custom-stl',
          bytes: customHead.bytes,
          customName: customHead.name || 'Custom Head',
        });
      } else {
        unmapped.push('Custom uploaded head STL (re-upload .stl file in Forge to include mesh bytes)');
      }
    } else if (HEAD_PART_ID[head]) {
      const headPartId = HEAD_PART_ID[head];
      const headHex = isHuman ? body.headSkinHex : (NON_HUMAN_HEAD_HEX[head] || base.shell);
      headEntry = pushPart(rawChar, {
        id: headPartId,
        file: catFile(headPartId),
        qty: 1,
        hex: headHex,
        role: isHuman ? 'skin' : 'head',
        source: 'partspec',
      });
    } else {
      unmapped.push(`Unknown head "${head}"`);
    }

    if (isHuman) {
      const fpPartId = FACE_PART_ID[faceInsert] || FACE_PART_ID.sculpted;
      pushPart(rawChar, {
        id: fpPartId,
        file: catFile(fpPartId),
        qty: 1,
        hex: body.headSkinHex,
        role: 'skin',
        source: 'partspec',
      });
      if (expr !== 'blank') {
        decals.push({
          kind: isSelfie ? 'selfie_face' : 'human_face',
          expr: isSelfie ? 'selfie' : expr,
          faceInsert,
        });
      }
    } else if (head !== 'custom' && expr !== 'blank') {
      decals.push({ kind: 'creature_face', head, expr });
    }

  // Hair / Wigs (19 sculpted styles)
  let hairEntry = null;
  if (hasHair) {
    const hairPartId = `hair_${hairOpt.id}`;
    const hairColObj = HAIR_COLORS.find(c => c.id === state.hairColor) || HAIR_COLORS[0];
    hairEntry = pushPart(rawChar, {
      id: hairPartId,
      file: catFile(hairPartId),
      qty: 1,
      hex: hairColObj.hex,
      role: 'hair',
      source: 'partspec',
    });
  }

  // Crown Buds 2x1 accent overlay rule (§4.2 #7):
  // Exposed ONLY when `canWearHat && hat === 'buds'`. Never a standalone part!
  if (exposedCrownBuds) {
    const hostEntry = hasHair ? hairEntry : headEntry;
    if (hostEntry) {
      hostEntry.accents.push({
        id: 'crown_buds_2x1',
        file: ACCENT_OVERLAY_FILES.crown_buds_2x1,
        hex: base.spark,
        colorName: colorNameForHex(base.spark),
      });
      notes.push('Crown studs accent (#FF6B4A): pause for filament swap at top 2.5 mm of crown studs, or colour with a crown paint cap.');
    }
  }

  // Hats & Crown Toppers (only mounted when `canWearHat` is true)
  if (canWearHat) {
    if (hatId === 'headphones' && !headphonesFit(state.head ?? 'kid', state.hair ?? 'off')) {
      notes.push('Party Headphones fit the four human heads over a bald head or a short Hat-Ready wig only: not included.');
    } else if (WEARABLE_HAT_IDS.has(hatId)) {
      const hatOpt = HAT_OPTIONS.find(h => h.id === hatId);
      const hatColId = state.hatColor || hatOpt?.defaultCol || HAT_COLORS[0].id;
      const hatColObj = HAT_COLORS.find(c => c.id === hatColId) || HAT_COLORS[0];
      const hatPartId = `hat_${hatId}`;
      pushPart(rawChar, {
        id: hatPartId,
        file: catFile(hatPartId),
        qty: 1,
        hex: hatColObj.hex,
        role: 'hat',
        source: 'partspec',
      });
    } else if (hatId === 'hat') {
      pushPart(rawChar, { id: 'wobble_hat', file: catFile('wobble_hat'), qty: 1, hex: base.snapMint, role: 'hat', source: 'partspec' });
    } else if (hatId === 'ears') {
      pushPart(rawChar, { id: 'pointy_ears', file: catFile('pointy_ears'), qty: 1, hex: base.snapGold, role: 'hat', source: 'partspec' });
    } else if (hatId === 'horns') {
      pushPart(rawChar, { id: 'bumper_horns', file: catFile('bumper_horns'), qty: 1, hex: EXP_PALETTE.sun, role: 'hat', source: 'partspec' });
    } else if (hatId === 'wizardHat') {
      pushPart(rawChar, { id: 'custom_wizard_hat', file: CUSTOM_EXAMPLE_FILES.custom_wizard_hat, qty: 1, hex: EXP_PALETTE.plum, role: 'hat', source: 'custom-example' });
    } else if (hatId === 'custom') {
      if (photoSlots.crown) {
        decals.push({ kind: 'craft_cutout', slot: 'crown', label: photoSlots.crown.label || 'Crown Crest' });
        unmapped.push('Photo-Forge crown crest (prints as 2D fold-tab craft cutout on sticker sheet, not 3D filament)');
      } else if (customSlots.crown && customSlots.crown.bytes) {
        pushPart(rawChar, {
          id: 'custom_crown_stl',
          file: 'memory://custom_crown.stl',
          qty: 1,
          hex: customSlots.crown.colorHex || EXP_PALETTE.custom,
          role: 'hat',
          source: 'custom-stl',
          bytes: customSlots.crown.bytes,
          customName: customSlots.crown.name || 'Custom Crown',
        });
      } else {
        unmapped.push('Custom crown accessory (re-upload .stl file in Forge to include mesh bytes)');
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Ear Pods / Pro Scanner, Backpacks / Pro 2:1 Gears, Tails, Props (§4.3)
  // -------------------------------------------------------------------------
  if (earsId === 'comm') {
    pushPart(rawChar, { id: 'ear_acc_l', file: scadFile('ear_acc_l'), qty: 1, hex: base.snapMint, role: 'accent' });
    pushPart(rawChar, { id: 'ear_acc_r', file: scadFile('ear_acc_r'), qty: 1, hex: base.snapMint, role: 'accent' });
  } else if (earsId === 'pro') {
    pushPart(rawChar, { id: 'beam_str_tu03', file: catFile('beam_str_tu03'), qty: 1, hex: base.proSlate, role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'shaft_tu03',    file: catFile('shaft_tu03'),    qty: 1, hex: base.proSlate, role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'gear_spur_z10', file: catFile('gear_spur_z10'), qty: 1, hex: base.spark,    role: 'accent',    source: 'partspec' });
    pushPart(rawChar, { id: 'bushing_half',  file: catFile('bushing_half'),  qty: 2, hex: base.proGear,  role: 'mechanism', source: 'partspec' });
  }

  if (backId === 'explorer') {
    pushPart(rawChar, { id: 'pack_explorer', file: catFile('pack_explorer'), qty: 1, hex: EXP_PALETTE.teal, role: 'accessory', source: 'partspec' });
  } else if (backId === 'jetpack') {
    pushPart(rawChar, { id: 'robot_back_jetpack', file: catFile('robot_back_jetpack'), qty: 1, hex: base.spark, role: 'accessory', source: 'partspec' });
  } else if (backId === 'wings') {
    pushPart(rawChar, { id: 'cloud_wings', file: catFile('cloud_wings'), qty: 1, hex: base.snapSky, role: 'accessory', source: 'partspec' });
  } else if (backId === 'gears') {
    pushPart(rawChar, { id: 'beam_str_tu05', file: catFile('beam_str_tu05'), qty: 1, hex: base.proSlate, role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'shaft_tu03',    file: catFile('shaft_tu03'),    qty: 2, hex: base.proSlate, role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'gear_spur_z20', file: catFile('gear_spur_z20'), qty: 1, hex: base.proGear,  role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'gear_spur_z10', file: catFile('gear_spur_z10'), qty: 1, hex: base.spark,    role: 'accent',    source: 'partspec' });
    pushPart(rawChar, { id: 'pin_friction',  file: catFile('pin_friction'),  qty: 1, hex: base.spark,    role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'bushing_half',  file: catFile('bushing_half'),  qty: 2, hex: base.proSlate, role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'bushing_half',  file: catFile('bushing_half'),  qty: 2, hex: base.proGear,  role: 'mechanism', source: 'partspec' });
  } else if (backId === 'custom') {
    if (photoSlots.wings || photoSlots.back) {
      const pSlot = photoSlots.wings || photoSlots.back;
      decals.push({ kind: 'craft_cutout', slot: 'wings', label: pSlot.label || 'Back Wings' });
      unmapped.push('Photo-Forge back wings (prints as 2D fold-tab craft cutout on sticker sheet, not 3D filament)');
    } else if (customSlots.back && customSlots.back.bytes) {
      pushPart(rawChar, {
        id: 'custom_back_stl',
        file: 'memory://custom_back.stl',
        qty: 1,
        hex: customSlots.back.colorHex || EXP_PALETTE.custom,
        role: 'accessory',
        source: 'custom-stl',
        bytes: customSlots.back.bytes,
        customName: customSlots.back.name || 'Custom Backpack',
      });
    } else {
      unmapped.push('Custom back accessory (re-upload .stl file in Forge to include mesh bytes)');
    }
  }

  if (tailId === 'wag') {
    pushPart(rawChar, { id: 'tail_acc', file: scadFile('tail_acc'), qty: 1, hex: base.spark, role: 'accent' });
  } else if (tailId === 'pro') {
    pushPart(rawChar, { id: 'beam_str_tu03',        file: catFile('beam_str_tu03'),        qty: 1, hex: base.proSlate, role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'shaft_tu03',           file: catFile('shaft_tu03'),           qty: 3, hex: base.proSlate, role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'wheel_tu04',           file: catFile('wheel_tu04'),           qty: 1, hex: base.proGear,  role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'cross_connector_tu01', file: catFile('cross_connector_tu01'), qty: 1, hex: base.spark,    role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'bushing_half',         file: catFile('bushing_half'),         qty: 3, hex: base.spark,    role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'bushing_half',         file: catFile('bushing_half'),         qty: 2, hex: base.proGear,  role: 'mechanism', source: 'partspec' });
  }

  // Right-Hand Props & Foot Skateboard (Note: viewer hides skateboard when entering a vehicle)
  const effectivePropId = (vehicleId !== 'none' && propId === 'skateboard') ? 'off' : propId;
  if (effectivePropId === 'wrench') {
    pushPart(rawChar, { id: 'prop_wrench', file: catFile('prop_wrench'), qty: 1, hex: EXP_PALETTE.cobalt, role: 'prop', source: 'partspec' });
  } else if (effectivePropId === 'shield') {
    pushPart(rawChar, { id: 'prop_star_shield', file: catFile('prop_star_shield'), qty: 1, hex: EXP_PALETTE.sun, role: 'prop', source: 'partspec' });
  } else if (effectivePropId === 'shaft') {
    pushPart(rawChar, { id: 'shaft_tu05',    file: catFile('shaft_tu05'),    qty: 1, hex: base.proSlate, role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'gear_spur_z10', file: catFile('gear_spur_z10'), qty: 1, hex: base.snapSky,  role: 'prop',      source: 'partspec' });
    pushPart(rawChar, { id: 'bushing_half',  file: catFile('bushing_half'),  qty: 1, hex: base.spark,    role: 'accent',    source: 'partspec' });
  } else if (effectivePropId === 'skateboard') {
    pushPart(rawChar, { id: 'prop_skateboard_deck', file: catFile('prop_skateboard_deck'), qty: 1, hex: base.spark,       role: 'prop',      source: 'partspec' });
    pushPart(rawChar, { id: 'racer_axle',           file: catFile('racer_axle'),           qty: 2, hex: base.proSlate,    role: 'mechanism', source: 'partspec' });
    pushPart(rawChar, { id: 'racer_wheel',          file: catFile('racer_wheel'),          qty: 4, hex: EXP_PALETTE.tire, role: 'tire',      source: 'partspec' });
  } else if (effectivePropId === 'wand') {
    pushPart(rawChar, { id: 'custom_star_wand', file: CUSTOM_EXAMPLE_FILES.custom_star_wand, qty: 1, hex: EXP_PALETTE.plum, role: 'prop', source: 'custom-example' });
  } else if (effectivePropId === 'custom') {
    if (photoSlots.hand) {
      decals.push({ kind: 'craft_cutout', slot: 'hand', label: photoSlots.hand.label || 'Hand Prop' });
      unmapped.push('Photo-Forge hand prop (prints as 2D fold-tab craft cutout on sticker sheet, not 3D filament)');
    } else if (customSlots.hand && customSlots.hand.bytes) {
      pushPart(rawChar, {
        id: 'custom_hand_stl',
        file: 'memory://custom_hand.stl',
        qty: 1,
        hex: customSlots.hand.colorHex || EXP_PALETTE.custom,
        role: 'prop',
        source: 'custom-stl',
        bytes: customSlots.hand.bytes,
        customName: customSlots.hand.name || 'Custom Hand Prop',
      });
    } else {
      unmapped.push('Custom hand prop (re-upload .stl file in Forge to include mesh bytes)');
    }
  } else if (effectivePropId !== 'off') {
    const wp = WORKSHOP_PROPS.find(w => w.id === effectivePropId);
    if (wp) {
      pushPart(rawChar, {
        id: wp.part,
        file: catFile(wp.part),
        qty: 1,
        hex: resolvePropMatHex(wp.mat, base),
        role: 'prop',
        source: 'partspec',
      });
    }
  }

  // Fallback notice when legacy `hasPhotoAccessory` boolean is set without per-slot breakdown
  if (state.hasPhotoAccessory && !photoSlots.crown && !photoSlots.wings && !photoSlots.back && !photoSlots.hand && !photoSlots.hood) {
    if (hatId !== 'custom' && backId !== 'custom' && effectivePropId !== 'custom') {
      unmapped.push('Photo-Forge craft cutout (prints on 2D sticker sheet, not 3D filament)');
    }
  }

  // -------------------------------------------------------------------------
  // 4. V2 Vehicles (`car`, `truck`, `scooter`, `moto`) (§4.3)
  // -------------------------------------------------------------------------
  if (vehicleId !== 'none') {
    const pushVeh = (spec) => pushPart(rawVeh, { ...spec, group: 'vehicle', source: spec.source || 'partspec' });

    if (vehicleId === 'car') {
      pushVeh({ id: 'veh_car_chassis',    file: catFile('veh_car_chassis'),    qty: 1, hex: base.spark,       role: 'vehicle_body' });
      pushVeh({ id: 'veh_steering_wheel', file: catFile('veh_steering_wheel'), qty: 1, hex: EXP_PALETTE.tire, role: 'mechanism' });
      pushVeh({ id: 'shaft_tu05',         file: catFile('shaft_tu05'),         qty: 2, hex: base.proSlate,    role: 'mechanism' });
      pushVeh({
        id: 'veh_wheel_sport',
        file: catFile('veh_wheel_sport'),
        qty: 4,
        hex: EXP_PALETTE.tire,
        role: 'tire',
        accents: [{
          id: 'veh_wheel_sport_rim',
          file: ACCENT_OVERLAY_FILES.veh_wheel_sport_rim,
          hex: EXP_PALETTE.rimAlloy,
        }],
      });

      if (vehCovers) {
        pushVeh({ id: 'veh_car_hood_cover', file: catFile('veh_car_hood_cover'), qty: 1, hex: base.shell, role: 'vehicle_cover' });
        pushVeh({ id: 'veh_cab_roof_cover', file: catFile('veh_cab_roof_cover'), qty: 1, hex: base.shell, role: 'vehicle_cover' });
      }

      const hasCustomHood = customHoodMode !== 'none' || Boolean(photoSlots.hood) || Boolean(customSlots.hood?.bytes);
      if (racerKit) {
        pushVeh({ id: 'racer_bull_bar',     file: catFile('racer_bull_bar'),     qty: 1, hex: EXP_PALETTE.sun,    role: 'vehicle_addon' });
        if (!hasCustomHood) {
          pushVeh({ id: 'racer_hood_scoop', file: catFile('racer_hood_scoop'),   qty: 1, hex: EXP_PALETTE.cobalt, role: 'vehicle_addon' });
        }
        pushVeh({ id: 'racer_light_bar',    file: catFile('racer_light_bar'),    qty: 1, hex: EXP_PALETTE.sun,    role: 'vehicle_addon' });
        pushVeh({ id: 'racer_spoiler',      file: catFile('racer_spoiler'),      qty: 1, hex: EXP_PALETTE.cobalt, role: 'vehicle_addon' });
        pushVeh({ id: 'racer_twin_exhaust', file: catFile('racer_twin_exhaust'), qty: 1, hex: base.shell,         role: 'vehicle_addon' });
      }

      if (customHoodMode === 'sdkCrest') {
        pushVeh({ id: 'custom_hood_crest', file: CUSTOM_EXAMPLE_FILES.custom_hood_crest, qty: 1, hex: EXP_PALETTE.sun, role: 'vehicle_addon', source: 'custom-example' });
      } else if (customHoodMode === 'photo' || photoSlots.hood) {
        decals.push({ kind: 'craft_cutout', slot: 'hood', label: photoSlots.hood?.label || 'Hood Crest' });
        unmapped.push('Photo-Forge hood crest (prints as 2D fold-tab craft cutout on sticker sheet, not 3D filament)');
      } else if (customHoodMode === 'customStl' || (customSlots.hood && customSlots.hood.bytes)) {
        if (customSlots.hood && customSlots.hood.bytes) {
          pushVeh({
            id: 'custom_hood_stl',
            file: 'memory://custom_hood.stl',
            qty: 1,
            hex: customSlots.hood.colorHex || EXP_PALETTE.custom,
            role: 'vehicle_addon',
            source: 'custom-stl',
            bytes: customSlots.hood.bytes,
            customName: customSlots.hood.name || 'Custom Hood Ornament',
          });
        } else {
          unmapped.push('Custom hood ornament STL (re-upload .stl file in Forge to include mesh bytes)');
        }
      }
      notes.push('Sport wheel alloy rims (#EDF2F8): visual rim overlay; paint spoke face or assign multi-colour modifier.');
    } else if (vehicleId === 'truck') {
      pushVeh({ id: 'veh_truck_chassis',  file: catFile('veh_truck_chassis'),  qty: 1, hex: EXP_PALETTE.teal, role: 'vehicle_body' });
      pushVeh({ id: 'veh_steering_wheel', file: catFile('veh_steering_wheel'), qty: 1, hex: EXP_PALETTE.tire, role: 'mechanism' });
      pushVeh({ id: 'shaft_tu05',         file: catFile('shaft_tu05'),         qty: 2, hex: base.proSlate,    role: 'mechanism' });
      pushVeh({
        id: 'veh_wheel_offroad',
        file: catFile('veh_wheel_offroad'),
        qty: 4,
        hex: EXP_PALETTE.tire,
        role: 'tire',
        accents: [{
          id: 'veh_wheel_offroad_rim',
          file: ACCENT_OVERLAY_FILES.veh_wheel_offroad_rim,
          hex: EXP_PALETTE.rimGold,
        }],
      });

      if (vehCovers) {
        pushVeh({ id: 'veh_car_hood_cover',  file: catFile('veh_car_hood_cover'),  qty: 1, hex: base.shell,      role: 'vehicle_cover' });
        pushVeh({ id: 'veh_cab_roof_cover',  file: catFile('veh_cab_roof_cover'),  qty: 1, hex: base.shell,      role: 'vehicle_cover' });
        pushVeh({ id: 'veh_truck_bed_cover', file: catFile('veh_truck_bed_cover'), qty: 1, hex: EXP_PALETTE.sun, role: 'vehicle_cover' });
      }

      if (racerKit) {
        pushVeh({ id: 'racer_bull_bar',  file: catFile('racer_bull_bar'),  qty: 1, hex: EXP_PALETTE.sun,    role: 'vehicle_addon' });
        pushVeh({ id: 'racer_roof_rack', file: catFile('racer_roof_rack'), qty: 1, hex: base.spark,         role: 'vehicle_addon' });
        pushVeh({ id: 'pack_explorer',   file: catFile('pack_explorer'),   qty: 1, hex: EXP_PALETTE.cobalt, role: 'vehicle_addon' });
      }
      notes.push('Off-road wheel beadlock rims (#FFD25A): visual rim overlay; paint beadlock ring or assign multi-colour modifier.');
    } else if (vehicleId === 'scooter' || vehicleId === 'moto') {
      pushVeh({ id: 'veh_scooter_frame',  file: catFile('veh_scooter_frame'),  qty: 1, hex: EXP_PALETTE.cobalt, role: 'vehicle_body' });
      pushVeh({ id: 'veh_handlebar_fork', file: catFile('veh_handlebar_fork'), qty: 1, hex: EXP_PALETTE.tire,   role: 'mechanism' });
      pushVeh({ id: 'racer_axle',         file: catFile('racer_axle'),         qty: 2, hex: base.proSlate,      role: 'mechanism' });
      pushVeh({
        id: 'veh_wheel_moto',
        file: catFile('veh_wheel_moto'),
        qty: 2,
        hex: EXP_PALETTE.tire,
        role: 'tire',
        accents: [{
          id: 'veh_wheel_moto_rim',
          file: ACCENT_OVERLAY_FILES.veh_wheel_moto_rim,
          hex: EXP_PALETTE.rimAlloy,
        }],
      });

      if (vehCovers) {
        pushVeh({ id: 'veh_scooter_fairing', file: catFile('veh_scooter_fairing'), qty: 1, hex: base.shell, role: 'vehicle_cover' });
        if (vehicleId === 'moto') {
          pushVeh({ id: 'veh_moto_cowling', file: catFile('veh_moto_cowling'), qty: 1, hex: base.spark, role: 'vehicle_cover' });
        }
      }

      if (racerKit) {
        pushVeh({ id: 'racer_twin_exhaust', file: catFile('racer_twin_exhaust'), qty: 1, hex: base.shell, role: 'vehicle_addon' });
      }
      notes.push('Moto wheel alloy rims (#EDF2F8): visual rim overlay; paint spoke face or assign multi-colour modifier.');
    }
  }

  function coalesce(list) {
    const map = new Map();
    const out = [];
    for (const item of list) {
      const canMerge = !item.bytes && (!item.accents || item.accents.length === 0);
      const key = canMerge ? `${item.group}|${item.id}|${item.file}|${item.hex}` : null;
      if (key && map.has(key)) {
        map.get(key).qty += item.qty;
      } else {
        const clone = { ...item, accents: item.accents ? [...item.accents] : [] };
        if (key) map.set(key, clone);
        out.push(clone);
      }
    }
    return out;
  }

  const characterItems = coalesce(rawChar);
  const vehicleItems = coalesce(rawVeh);
  const items = includeVehicle ? [...characterItems, ...vehicleItems] : [...characterItems];

  return {
    items,
    characterItems,
    vehicleItems,
    includeVehicle,
    hasVehicleInScene: vehicleItems.length > 0,
    unmapped,
    decals,
    notes,
    bodyColors: body,
  };
}

/**
 * One BOM from several (Workshop stage 4c): the Kip driver's parts (`resolveSceneBom`) and a bench's mechanism
 * parts (`resolveProviderBom`) print together. Items keep their order (character first), so plate planning is
 * what it would be for either list alone; notes are de-duplicated; a missing list (`null`) is skipped.
 * `stickers: false` drops the decals: a mechanism bench has no sticker renderer, so offering the Kip's face
 * stickers there would export an empty sheet (the Kip tab prints them).
 */
export function mergeBoms(boms, { stickers = true } = {}) {
  const live = (boms || []).filter(Boolean);
  if (live.length === 0) return resolveProviderBom([], {});
  if (live.length === 1 && stickers) return live[0];
  return {
    items: live.flatMap((b) => b.items || []),
    characterItems: live.flatMap((b) => b.characterItems ?? b.items ?? []),
    vehicleItems: live.flatMap((b) => b.vehicleItems ?? []),
    includeVehicle: live.some((b) => b.includeVehicle),
    hasVehicleInScene: live.some((b) => b.hasVehicleInScene),
    unmapped: live.flatMap((b) => b.unmapped ?? []),
    decals: stickers ? live.flatMap((b) => b.decals ?? []) : [],
    notes: [...new Set(live.flatMap((b) => b.notes ?? []))],
    bodyColors: Object.assign({}, ...live.map((b) => b.bodyColors ?? {})),
  };
}

/**
 * What a bench is asking the print view to print, resolved to one BOM. `source` is the bench's print source:
 *   { getParts?, getKipState?, getState }  with the already-fetched `parts` (the result of `await source.getParts()`).
 * A Kip scene bench (no `getParts`) prints its scene state. A mechanism bench prints its parts, and the Kip driver
 * with them when it has one on screen (`kipState`, never its vehicle: the mechanism is the vehicle).
 */
export function resolvePrintBom(source, { parts = null, kipState = null, validationIndex, manifestParts, includeVehicle, notes = [] } = {}) {
  if (!source.getParts) {
    return resolveSceneBom(source.getState(), { includeVehicle, validationIndex });
  }
  const mechanism = resolveProviderBom(parts || [], { validationIndex, manifestParts, notes });
  const driver = kipState ? resolveSceneBom(kipState, { includeVehicle: false, validationIndex }) : null;
  // The driver's decals (face, shirt) are kept only when the bench can draw their artwork (`source.renderStickerSources`): without a renderer a sticker sheet would be empty.
  return mergeBoms([driver, mechanism], { stickers: Boolean(source.renderStickerSources) });
}

/**
 * Parts-provider BOM (Workshop stage 3): a bench that is not Kip's scene (the Truck) supplies plain
 * `[{ id, colour, count }]` plus the validation index; each id resolves to its print-pose STL exactly as
 * Kip's PartSpec entries do (source `partspec`, so the planner seats them native — axles and pins keep
 * their flat print pose). Colour and plate planning downstream are unchanged.
 */
export function resolveProviderBom(parts = [], opts = {}) {
  const catalogFiles = buildCatalogFileMap(opts.validationIndex, opts.manifestParts);
  const items = [];
  const unmapped = [];
  for (const p of parts) {
    if (!p || typeof p.id !== 'string') continue;
    const qty = p.count ?? p.qty ?? 1;
    if (!qty || qty <= 0) continue;
    const file = p.file || catalogFiles[p.id];
    if (!file) {
      unmapped.push(`No print STL mapped for part "${p.id}"`);
      continue;
    }
    const hex = normHex(p.colour || p.hex, '#F4EFE6');
    items.push({
      id: p.id,
      file,
      qty,
      hex,
      colorName: colorNameForHex(hex),
      material: 'PLA',
      role: p.role || 'mechanism',
      source: 'partspec',
      group: p.group || 'truck',
      accents: [],
      bytes: null,
      customName: '',
    });
  }
  return {
    items,
    characterItems: items,
    vehicleItems: [],
    includeVehicle: false,
    hasVehicleInScene: false,
    unmapped,
    decals: [],
    notes: [...(opts.notes || [])],
    bodyColors: {},
  };
}
