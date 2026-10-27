// pro-beam-su05 — STEMFIE grid: 5 units at 12.5 mm pitch, 7.0 mm free holes.
// Simplified blockout of the rounded SU05 teaser beam (docs/pro.md):
// correct pitch and hole pattern first, fillets come with the print tests.
pitch = 12.5;
units = 5;
thickness = 6;
difference() {
  cube([units * pitch, pitch, thickness]);
  for (i = [0 : units - 1])
    translate([(i + 0.5) * pitch, pitch / 2, -1])
      cylinder(d = 7.0, h = thickness + 2, $fn = 32);
}
