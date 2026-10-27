// stud_profile_large — TARGET values only. Nothing in Snap has been
// printed yet (Oct 27, 2026); clearance locks after the Day 4 calibration
// prints. Large is the youngest-kid size, so it is also the first size
// cut if calibration slips (docs/snap.md).
//
// 2x the small pitch: a 2x2 large brick is 64x64 mm, one solid piece a
// toddler can palm, with no small loose pieces anywhere on it.
stud_pitch_mm = 32;
stud_diameter_mm = 19;
stud_height_mm = 8;
plate_height_mm = 6;

module stud() {
  cylinder(d = stud_diameter_mm, h = stud_height_mm, $fn = 48);
}

module stud_plate(units_x, units_y) {
  cube([units_x * stud_pitch_mm, units_y * stud_pitch_mm, plate_height_mm]);
  for (x = [0 : units_x - 1])
    for (y = [0 : units_y - 1])
      translate([(x + 0.5) * stud_pitch_mm, (y + 0.5) * stud_pitch_mm, plate_height_mm])
        stud();
}

// --- Snap-fit undersides ---
// Looser TARGET clearance than small (+0.3): little hands push at an
// angle, so large sockets give more before they grip. Still a guess
// until a large calibration bar exists (only the small one does).
snap_clearance_mm = 0.3;
socket_depth_mm = 6; // engages 6 of the 8 mm stud

// Recess that snaps over one stud, 45-degree cone roof (see small).
module socket() {
  d = stud_diameter_mm + snap_clearance_mm;
  union() {
    cylinder(d = d, h = socket_depth_mm, $fn = 48);
    translate([0, 0, socket_depth_mm])
      cylinder(d1 = d, d2 = 5, h = (d - 5) / 2, $fn = 48);
  }
}

// Plate with rounded vertical edges and a rolled top edge, flat bottom
// for bed adhesion. Bigger default radius than small: softer in hand.
module rounded_plate(units_x, units_y, h, r = 4) {
  w = units_x * stud_pitch_mm;
  d = units_y * stud_pitch_mm;
  hull() {
    for (x = [r, w - r])
      for (y = [r, d - r]) {
        translate([x, y, 0]) cylinder(r = r, h = h - r, $fn = 32);
        translate([x, y, h - r]) sphere(r = r, $fn = 32);
      }
  }
}

// Rounded plate with a snap socket under every grid cell. Needs
// h > socket_depth + cone roof (about 13.2 mm here); samples use 20.
module socket_plate(units_x, units_y, h, r = 4) {
  difference() {
    rounded_plate(units_x, units_y, h, r);
    for (x = [0 : units_x - 1])
      for (y = [0 : units_y - 1])
        translate([(x + 0.5) * stud_pitch_mm, (y + 0.5) * stud_pitch_mm, -0.1])
          socket();
  }
}

// Studs standing on a plate top at height h, with a cone fillet each.
// Sunk 0.5 mm into the plate so the STL is one watertight solid (see
// the note in stud_profile_small.scad).
module top_studs(units_x, units_y, h) {
  for (x = [0 : units_x - 1])
    for (y = [0 : units_y - 1])
      translate([(x + 0.5) * stud_pitch_mm, (y + 0.5) * stud_pitch_mm, h - 0.5]) {
        cylinder(d1 = stud_diameter_mm + 3, d2 = stud_diameter_mm, h = 2, $fn = 48);
        translate([0, 0, 2]) stud();
      }
}
