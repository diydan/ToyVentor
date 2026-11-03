// truck-menu.js: what the Truck bench puts in the one menu (Workshop stage 4c, docs/specs/workshop-spec.md).
//
// The Truck used to carry its own dock of buttons; now it DECLARES its sections and kip-menu.js draws them, the same panel the Kip uses, with the
// same Print group (`buildPrintGroup`). This file touches no browser globals and no scene: every control is a pair of closures the bench passes in
// (`api`), so vitest can import it and check the declaration (ids, order, labels, who is visible when) without a browser.

import { buildPrintGroup } from './kip-menu.js?v=10.0'; // the same specifier the benches use, so the browser loads ONE copy of the menu

/**
 * The decided ladder (Dan, 2026-11-02; docs/specs/motion-stage-options-spec.md section 3.0): Snap -> Motion -> Pro. The ids are the viewer's stage
 * ids (`?stage=` values, the probes) and never change; the labels follow the ladder (tests/truck-stage-ladder.test.ts).
 */
export const TRUCK_STAGES = Object.freeze([
  Object.freeze({ id: 'snap', label: '1 · Snap (3+)' }),
  Object.freeze({ id: 'band', label: '2a · Motion (8+) Pull-Back Band' }),
  Object.freeze({ id: 'jet', label: '2b · Motion (8+) Balloon Jet (proposal)', title: 'Proposal: balloon upright on top of mom_jet_valve_body, no dump tub (docs/specs/motion-stage-options-spec.md)' }),
  Object.freeze({ id: 'pro', label: '3 · Pro (8+) Rack Steer' }),
  Object.freeze({ id: 'mech', label: '3+ · Pro Powered Add-On (10+) Smart RC X-Ray' }),
]);

/** The four camera presets: where the camera sits and what it looks at, in the bench's millimetres. */
export const TRUCK_CAMERAS = Object.freeze([
  Object.freeze({ id: 'hero', label: '3/4 Hero', position: Object.freeze([-165, 118, 178]), target: Object.freeze([0, 36, 0]) }),
  Object.freeze({ id: 'side', label: 'Side Datum', position: Object.freeze([-240, 42, 0]), target: Object.freeze([0, 36, 0]) }),
  Object.freeze({ id: 'top', label: 'Top Steer', position: Object.freeze([0, 230, -15]), target: Object.freeze([0, -45, 12]) }),
  Object.freeze({ id: 'cab', label: 'Cockpit', position: Object.freeze([-95, 92, 115]), target: Object.freeze([0, 48, 22]) }),
]);

export const TRUCK_XRAY_MODES = Object.freeze([
  Object.freeze({ value: 'auto', label: 'Auto' }),
  Object.freeze({ value: 'on', label: 'On' }),
  Object.freeze({ value: 'off', label: 'Off' }),
]);

const sel = (id, label, o) => ({ kind: 'select', id, label, ...o });
const toggle = (id, label, title, c, o = {}) => ({ kind: 'toggle', id, label, title, get: c.get, set: c.set, ...o });
const range = (id, label, title, c, o = {}) => ({ kind: 'range', id, label, title, step: 1, get: c.get, set: c.set, ...o });

/**
 * @param {object} api what the bench lends the menu. Every entry is a `{ get, set }` pair (or the function named):
 *   stage, demo, tip (+ min()), steer, explode, giant, hood, plow, xray, sweep, drive, kip, rig,
 *   jet: { visible(), balloon, lean, nozzle } each { options(), get, set },
 *   head, hair, hat each { options(), get, set, visible?() },
 *   goCamera(id), print (the print-view adapter, same shape the Kip passes).
 * @returns the groups kip-menu.js draws (the bench passes `() => buildTruckMenu(api)` as `ctx.groups`).
 */
export function buildTruckMenu(api) {
  const stage = {
    id: 'stage',
    label: 'Stage',
    icon: '🚚',
    controls: [
      sel('stage', 'Stage', {
        title: 'Which rung of the ladder to show: Snap, Motion (pull-back band or balloon jet), Pro (rack steer, powered add-on)',
        options: () => TRUCK_STAGES.map((s) => ({ value: s.id, label: s.label })),
        note: () => TRUCK_STAGES.find((s) => s.id === api.stage.get())?.title ?? '',
        get: api.stage.get,
        set: api.stage.set,
      }),
      toggle('demo', '▶ Action demo', 'Play this stage\'s motion on its own', api.demo),
    ],
  };

  const motion = {
    id: 'motion',
    label: 'Motion',
    icon: '🎚️',
    controls: [
      range('tip', 'Dump tip (°)', 'Tip the dump bed', api.tip, { min: () => api.tip.min(), max: 55 }),
      range('steer', 'Steer lock (°)', 'Turn the steering wheel: left positive. Giant tyres stop at 25 degrees, medium at 34', api.steer, { min: -34, max: 34 }),
      range('explode', 'Explode (%)', 'Pull the parts apart along their axes', api.explode, { min: 0, max: 100 }),
    ],
  };

  const options = {
    id: 'options',
    label: 'Options',
    icon: '🔧',
    controls: [
      toggle('giant', 'Giant tyres (Ø50)', 'Ø50 giant tyres (#5) instead of the Ø36 medium ones (#4). Stage 2a keeps the Ø36 until the pull-back core has been checked against them', api.giant),
      toggle('hood', 'Bulldog wedge nose', 'Bulldog wedge nose (#7) instead of the open yoke', api.hood),
      toggle('plow', 'Front plow (#12)', 'Front plow (#12) on the nose', api.plow),
      sel('jetBalloon', 'Balloon (Ø mm)', { title: 'Balloon diameter', visibleWhen: () => api.jet.visible(), options: api.jet.balloon.options, get: api.jet.balloon.get, set: api.jet.balloon.set }),
      sel('jetLean', 'Balloon lean', { title: 'Lean the balloon back. 0° = straight up, as the vertical collar gives it', visibleWhen: () => api.jet.visible(), options: api.jet.lean.options, get: api.jet.lean.get, set: api.jet.lean.set }),
      sel('jetNozzle', 'Nozzle (Ø mm)', { title: 'Nozzle insert (proposal geometry, not repo CAD)', visibleWhen: () => api.jet.visible(), options: api.jet.nozzle.options, get: api.jet.nozzle.get, set: api.jet.nozzle.set }),
      sel('xray', 'X-ray shells', { title: 'See through the shells: automatic (only where a stage needs it), always, or never', options: () => TRUCK_XRAY_MODES, get: api.xray.get, set: api.xray.set }),
      toggle('sweep', 'Auto steer', 'Sweep the steering from lock to lock', api.sweep),
      toggle('drive', 'Drive with the keyboard (G)', 'Drive the truck: W/S speed, A/D steer, Space brake, Q/E tip the bed, R back to the start', api.drive),
    ],
  };

  const driver = {
    id: 'driver',
    label: 'Driver',
    icon: '🧑‍✈️',
    controls: [
      toggle('kip', 'Kip driver', 'Show Kip in the cab. The driver prints with the truck when this is on', api.kip),
      sel('rig', 'Rig', {
        title: 'Pro 8+ = 14-joint ball-and-peg Kip rig (default). Snap 3+ = 1-piece limb & swivel-turret Kip rig.',
        options: () => [{ value: 'pro', label: 'Pro 8+' }, { value: 'snap', label: 'Snap 3+' }],
        get: api.rig.get,
        set: api.rig.set,
      }),
      sel('head', 'Head', { title: 'All 12 Kip heads (Human, Robot, Animal, Creature)', options: api.head.options, get: api.head.get, set: api.head.set }),
      sel('hair', 'Hair', { title: 'The wig on a human head (hat-ready wigs accept a hat)', visibleWhen: () => api.hair.visible(), options: api.hair.options, get: api.hair.get, set: api.hair.set }),
      sel('hat', 'Hat', { title: 'The hat (a sculpted-top wig has no studs for one)', visibleWhen: () => api.hat.visible(), options: api.hat.options, get: api.hat.get, set: api.hat.set }),
    ],
  };

  const view = {
    id: 'view',
    label: 'Camera',
    icon: '🎥',
    controls: TRUCK_CAMERAS.map((c) => ({
      kind: 'action', id: `cam-${c.id}`, label: c.label, title: `Move the camera to the ${c.label} view`, run: () => api.goCamera(c.id),
    })),
  };

  // The same Print group the Kip's menu has, over the same print view; a vehicle of its own it has none (the mechanism is what prints).
  // Without `api.print` (a host that lets no file out) there is no Print group.
  return [stage, motion, options, driver, view, ...(api.print ? [buildPrintGroup(api.print)] : [])];
}
