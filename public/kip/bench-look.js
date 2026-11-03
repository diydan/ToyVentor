// bench-look.js: the Workshop's blueprint look, one place for both benches (Kip and Truck) so the two cannot drift
// (Dan, 2026-11-03: "both truck and kip", a blueprint colour scheme; docs/specs/workshop-spec.md, 4b record).
//
// The canvas of a bench is transparent: what shows behind the models is the bench root's CSS gradient, and the floor grid, the fog and the
// contact shadow inside the scene are tuned to read on it. Colours are three.js hex numbers except `gradient`, which is CSS.

export const BLUEPRINT = Object.freeze({
  /** The drawing board behind the canvas: lamp-lit at the centre, deep blue at the edges. workshop.js repeats this string for its stage (a test keeps them equal). */
  gradient: 'radial-gradient(circle at 50% 38%, #2b66b3 0%, #1c4a8c 55%, #102f5c 100%)',
  /** Fog colour: the ground's mid blue, so a far floor fades into it. */
  fog: 0x1c4a8c,
  /** Floor grids: the centre lines, the ordinary lines, a fine (25 mm) lattice and a major (100 mm) lattice. */
  gridCentre: 0xd6ebff,
  gridLine: 0x8db8ee,
  gridFine: 0x6f9fd6,
  gridMajor: 0xaed4ff,
  /** The ring that marks where the character stands. */
  ring: 0xd6ebff,
  /** Opacity of the contact shadow: darker than on a light floor so it still reads on the blue. */
  shadowOpacity: 0.3,
});
