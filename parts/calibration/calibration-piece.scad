// Calibration piece: one bar, five stud sockets at clearances from
// nominal -0.2 mm to +0.2 mm in 0.1 mm steps. Print first, find which
// socket snaps on your printer, set that offset. See docs/snap.md.
nominal = 9.5;
for (i = [0 : 4]) {
  offset = -0.2 + i * 0.1;
  translate([i * 16, 0, 0])
    difference() {
      cube([14, 14, 6]);
      translate([7, 7, 1]) cylinder(d = nominal + offset, h = 6, $fn = 32);
    }
}
