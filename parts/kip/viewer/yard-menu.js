// yard-menu.js: what the Yard bench puts in the one menu (Workshop stage 4c, leftover: the Yard used to have none and the panel vanished on its tab).
//
// Like truck-menu.js this is a pure declaration (no browser globals, no scene): every control is a closure the bench passes in, so vitest can check it.
// The hold-to-push pad (Push, Back, Brake) stays on the bench's own card: a held button is a held key and has no place in a menu. The menu carries what is a
// setting or a one-shot: where the front axle sits, back to the start, the numbers, and the keys.

/** The three front-axle positions the bench offers (the keel is 24.8 mm wide at the nose, so a fixed front axle floats 14.3 mm sideways). */
export const YARD_FLOATS = Object.freeze([
  Object.freeze({ value: '0', label: 'Centred' }),
  Object.freeze({ value: '1', label: 'Slid left 14.2 mm' }),
  Object.freeze({ value: '2', label: 'Slid right 14.2 mm' }),
]);

/**
 * @param {{ float: { get(): string, set(v: string): void }, home(): void, readout(): string }} api
 * @returns the groups kip-menu.js draws (the bench passes `() => buildYardMenu(api)` as `ctx.groups`).
 */
export function buildYardMenu(api) {
  return [
    {
      id: 'roller',
      label: 'Roller',
      icon: '🚜',
      controls: [
        { kind: 'select', id: 'yardFloat', label: 'Front axle',
          title: 'Slide the front axle sideways by its float: the keel is only 24.8 mm wide at the nose',
          options: () => YARD_FLOATS, get: api.float.get, set: api.float.set },
        { kind: 'action', id: 'yardHome', label: '⏮ Back to the start', title: 'Put the roller back where it began (R)', run: () => api.home() },
        { kind: 'info', id: 'yardReadout', title: 'Speed and distance', text: () => api.readout() },
      ],
    },
    {
      id: 'keys',
      label: 'Keys',
      icon: '⌨️',
      controls: [
        { kind: 'info', id: 'yardKeys', title: 'Driving the roller', text: () => 'W / S push and pull\nSpace brakes\nR goes back to the start\nOn a phone: hold Push, Back or Brake on the card.' },
      ],
    },
  ];
}
