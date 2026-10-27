// snap-spoiler-01 — matches sets/base.json (32x16 mm footprint, flat).
// Prints flat, no supports: fin is laid in the print plane on purpose.
plate = [32, 16, 3];
cube(plate);
translate([4, 6, 3]) cube([24, 4, 10]);
translate([2, 5, 12]) cube([28, 6, 2]);
