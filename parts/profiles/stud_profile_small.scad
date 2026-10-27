// stud_profile_small — TARGET values only. Nothing in Snap has been printed
// yet (Oct 27, 2026); clearance locks after the Day 4 calibration prints.
stud_pitch_mm = 16;
stud_diameter_mm = 9.5;
stud_height_mm = 5;
plate_height_mm = 4;

module stud() {
  cylinder(d = stud_diameter_mm, h = stud_height_mm, $fn = 32);
}

module stud_plate(units_x, units_y) {
  cube([units_x * stud_pitch_mm, units_y * stud_pitch_mm, plate_height_mm]);
  for (x = [0 : units_x - 1])
    for (y = [0 : units_y - 1])
      translate([(x + 0.5) * stud_pitch_mm, (y + 0.5) * stud_pitch_mm, plate_height_mm])
        stud();
}

// --- Snap-fit undersides (added for the first sample parts) ---
// TARGET clearance only, same status as the stud numbers above: the
// calibration piece sweeps -0.2..+0.2 mm, so parts start at the loose end
// (+0.2) and this one number moves once a printer says otherwise.
snap_clearance_mm = 0.2;
socket_depth_mm = 4; // engages 4 of the 5 mm stud; rest is finger room

// Recess that snaps over one stud. The 45-degree cone roof means the
// recess never needs a flat bridge, so undersides stay support-free
// printed studs-up on the bed.
module socket() {
  d = stud_diameter_mm + snap_clearance_mm;
  union() {
    cylinder(d = d, h = socket_depth_mm, $fn = 32);
    translate([0, 0, socket_depth_mm])
      cylinder(d1 = d, d2 = 3, h = (d - 3) / 2, $fn = 32);
  }
}

// Plate with rounded vertical edges and a rolled top edge, flat bottom
// for bed adhesion (docs/snap.md: rounded edges, no sharp corners).
module rounded_plate(units_x, units_y, h, r = 2) {
  w = units_x * stud_pitch_mm;
  d = units_y * stud_pitch_mm;
  hull() {
    for (x = [r, w - r])
      for (y = [r, d - r]) {
        translate([x, y, 0]) cylinder(r = r, h = h - r, $fn = 24);
        translate([x, y, h - r]) sphere(r = r, $fn = 24);
      }
  }
}

// Rounded plate with a snap socket under every grid cell. Needs
// h > socket_depth + cone roof (about 7.4 mm here); samples use 8+.
module socket_plate(units_x, units_y, h, r = 2) {
  difference() {
    rounded_plate(units_x, units_y, h, r);
    for (x = [0 : units_x - 1])
      for (y = [0 : units_y - 1])
        translate([(x + 0.5) * stud_pitch_mm, (y + 0.5) * stud_pitch_mm, -0.1])
          socket();
  }
}

// Studs standing on a plate top at height h, with a small cone fillet
// at each base so studs survive being pulled sideways by small hands.
// Sunk 0.5 mm into the plate: studs that merely touch the top face
// stay separate shells in the STL instead of one watertight solid.
module top_studs(units_x, units_y, h) {
  for (x = [0 : units_x - 1])
    for (y = [0 : units_y - 1])
      translate([(x + 0.5) * stud_pitch_mm, (y + 0.5) * stud_pitch_mm, h - 0.5]) {
        cylinder(d1 = stud_diameter_mm + 2, d2 = stud_diameter_mm, h = 1.5, $fn = 32);
        translate([0, 0, 1.5]) stud();
      }
}
