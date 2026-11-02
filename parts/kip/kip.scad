// ============================================================================
// ToyVentor Main Character — "Kip" (Modular Blank-Canvas Art-Toy Rig)
// 100% Original Clean-Room Parametric Geometry on the 12.5 mm TU Standard
// Editions: Pro (8+) 14-DOF & Snap (3+) 10-DOF (16 CFR 1500.19 small-parts warning)
// ============================================================================

// Select which part to export via -D 'PART="head_shell"'
PART = "torso";

// Set -D 'PRINT_ORIENT=true' to place any part flat on z = 0 in its support-free print pose.
// Leave false (default) to export in Kip's assembly/viewer coordinate frame.
PRINT_ORIENT = false;

// --- ToyVentor Interface Standard (from parts/partspec/interfaces.json) ---
TU          = 12.5;
STUD_D      = 6.6;
STUD_H      = 2.8;
STUD_FIT    = 0.1;
SOCKET_D    = STUD_D + STUD_FIT; // 6.7 mm
PRO_FREE_D  = 7.0;
PRO_SHAFT_D = 6.6;

// --- Character Master Dimensions (Pro Standing Height = 150.0 mm = 12.0 TU) ---
HEAD_W      = 44.0;
HEAD_D      = 38.0;
HEAD_H      = 41.5;

PEG_BIG_D   = 9.0;   // Neck, Shoulders, Hips
PEG_SML_D   = 8.0;   // Elbows, Wrists, Knees, Ankles
SOCK_CLR    = 0.15;  // Radial socket clearance

$fn = 84;

// ============================================================================
// Helper Primitives
// ============================================================================

// ToyVentor Standard Small Stud (6.6 x 2.8 mm above z=0, with optional root_sink below z=0)
module tv_stud(root_sink = 0.0) {
    r = STUD_D / 2;
    f = 0.6;
    rotate_extrude($fn = 96) {
        polygon([
            [0, -root_sink],
            [r, -root_sink],
            [r, STUD_H - f],
            for (i = [1:6])
                let(a = 90 * i / 6)
                [r - f + f * cos(a), STUD_H - f + f * sin(a)],
            [0, STUD_H]
        ]);
    }
}

// ToyVentor Support-Free Integrated Stud Socket Cutter (z=0 opening, 42 deg cone roof)
module tv_socket_cut(depth = 3.4) {
    r = SOCKET_D / 2;
    union() {
        translate([0, 0, -0.2])
            cylinder(h = 0.9, r1 = r + 0.5, r2 = r, $fn = 96);
        translate([0, 0, 0])
            cylinder(h = depth, r = r, $fn = 96);
        translate([0, 0, depth - 0.01])
            cylinder(h = r * 1.05, r1 = r, r2 = 0, $fn = 96);
    }
}

// Support-Free Outsole Edge Stud-Relief Cutter (45 deg cone ceiling, clears neighbouring plate studs)
module tv_stud_relief_cut(depth = 3.2) {
    r = SOCKET_D / 2 + 0.2; // 3.55 mm radial clearance
    union() {
        translate([0, 0, -0.2])
            cylinder(h = depth + 0.2, r = r, $fn = 72);
        translate([0, 0, depth - 0.01])
            cylinder(h = r, r1 = r, r2 = 0, $fn = 72);
    }
}

// Support-Free Internal Ball-Peg Socket Cutter (single continuous revolve: zero CSG seam steps, <=cone_deg everywhere!)
module ball_socket_cut(d = PEG_BIG_D, embed = 4.6, outward_clear = 0, cone_deg = 38) {
    rc = d / 2 + SOCK_CLR;
    ro = d * 0.43; // snap undercut retention lip
    r_mouth = rc + 0.20;
    z_start = -0.2;
    z_lip   = z_start + (r_mouth - ro) / tan(cone_deg);
    // Join expanding throat cleanly onto sphere(r = rc) below equator, then arc up to cone_deg tangency
    a_start = -acos(ro / rc);
    z_arc0  = embed + rc * sin(a_start);
    z_apex  = embed + rc / sin(cone_deg);
    steps   = 24;
    rotate_extrude($fn = 72) {
        polygon(concat(
            outward_clear > 0 ? [[0, -outward_clear], [r_mouth, -outward_clear]] : [[0, z_start]],
            [
                [r_mouth, z_start],
                [ro, z_lip],
                [ro, min(z_lip + 0.05, z_arc0 - 0.05)]
            ],
            [for (i = [0 : steps])
                let(a = a_start + (cone_deg - a_start) * i / steps)
                [rc * cos(a), embed + rc * sin(a)]
            ],
            [[0, z_apex]]
        ));
    }
}

// World-Z Teardrop Sphere: identical to sphere(r) across the bottom + front + back 288 deg,
// with a support-free <=roof_deg conical peak toward +Z_world (zero cap facets!).
module teardrop_sphere_z(r, roof_deg = 36) {
    z_tan = r * sin(roof_deg);
    r_tan = r * cos(roof_deg);
    union() {
        sphere(r = r, $fn = 72);
        translate([0, 0, z_tan])
            cylinder(h = r_tan / tan(roof_deg), r1 = r_tan, r2 = 0, $fn = 72);
    }
}

// Support-Free Sideways Shoulder Ball-Peg Socket Cutter in World Frame:
// Preserves exact socket centre (cx, 0, cz), tilt_deg (78 on Pro, 84 on Snap), embed, ro = 0.43*d snap lip,
// and full 280+ deg spherical ball capture while peaking the +Z_world ceiling at <=38 deg (0.00 mm2 overhang!).
module shoulder_socket_cut_world(sx, cx, cz, tilt_deg, d = PEG_BIG_D, embed = 4.2, outward_clear = 4.0) {
    rc = d / 2 + SOCK_CLR;
    ro = d * 0.43;
    ux = -sx * sin(tilt_deg);
    uz = -cos(tilt_deg);

    // Mouth chamfer starts outside curved shoulder skin (s = -1.1 -> 0.95) so no feather edge forms
    s_out   = -outward_clear;
    s_mouth = -1.1;
    s_lip   =  0.95;
    s_seat  =  embed;

    union() {
        hull() {
            translate([cx + s_out * ux, 0, cz + s_out * uz])
                teardrop_sphere_z(rc + 0.45, 34);
            translate([cx + s_mouth * ux, 0, cz + s_mouth * uz])
                teardrop_sphere_z(rc + 0.45, 34);
        }
        hull() {
            translate([cx + s_mouth * ux, 0, cz + s_mouth * uz])
                teardrop_sphere_z(rc + 0.45, 34);
            translate([cx + s_lip * ux, 0, cz + s_lip * uz])
                teardrop_sphere_z(ro, 34);
        }
        hull() {
            translate([cx + s_lip * ux, 0, cz + s_lip * uz])
                teardrop_sphere_z(ro, 35);
            translate([cx + s_seat * ux, 0, cz + s_seat * uz])
                teardrop_sphere_z(rc, 36);
        }
        translate([cx + s_seat * ux, 0, cz + s_seat * uz])
            teardrop_sphere_z(rc, 36);
    }
}

// Support-Free <=38-deg Conical Hip Thigh-Swing Arch Cutter (replaces domed sphere ceiling)
module hip_arch_relief_cut(x_c, z_base, r_arch = 7.5, cone_deg = 37) {
    union() {
        translate([x_c, 0, z_base - 1.5])
            cylinder(h = 2.1, r = r_arch, $fn = 72);
        translate([x_c, 0, z_base + 0.59])
            cylinder(h = r_arch / tan(cone_deg), r1 = r_arch, r2 = 0, $fn = 72);
    }
}

// ToyVentor Pro <=40-deg Pointed Teardrop Horizontal Bore Cutter (+Y_2d points toward +Z_world ceiling; zero tip cap facets!)
module teardrop_2d(d, roof_deg = 40) {
    r = d / 2;
    y_tan = r * sin(roof_deg);
    x_tan = r * cos(roof_deg);
    y_top = r / sin(roof_deg);
    union() {
        circle(r = r, $fn = 84);
        polygon([
            [-x_tan, y_tan],
            [ x_tan, y_tan],
            [   0.0, y_top]
        ]);
    }
}

// Extruded teardrop blind/through bore starting at z=0 into +Z (with 45-deg mouth chamfer)
module pro_teardrop_bore_cut(d = PRO_FREE_D, depth = 12.8, ch = 0.55) {
    s_ch = (d + 2 * ch) / d;
    union() {
        hull() {
            translate([0, 0, -0.2])
                linear_extrude(height = 0.2)
                    scale([s_ch, s_ch]) teardrop_2d(d);
            translate([0, 0, ch])
                linear_extrude(height = 0.05)
                    teardrop_2d(d);
        }
        linear_extrude(height = depth)
            teardrop_2d(d);
    }
}

// Support-Free Conical Cosmetic V-Groove Ring (pure continuous revolve: zero bounding-cylinder ledges)
module v_groove_ring(z_mid, r_outer, r_inner, sy = 1.0, flank_deg = 38) {
    r_ext = r_outer + 8.0;
    hh = (r_ext - r_inner) / tan(flank_deg);
    translate([0, 0, z_mid])
        scale([1.0, sy, 1.0])
            rotate_extrude($fn = 84)
                polygon([
                    [r_inner, 0],
                    [r_ext,  hh],
                    [r_ext, -hh]
                ]);
}

// Superellipse Head Shell 2D Profile (r, z) for revolve, offset by d

// Chamfered Visor Octagon Profile in (x, z)


// Rounded Pill Box in 3D
module pill_box(w, d, h, r) {
    hull() {
        for (sx = [-1, 1], sy = [-1, 1]) {
            translate([sx * (w/2 - r), sy * (d/2 - r), 0])
                cylinder(h = h, r = r, $fn = 48);
        }
    }
}

// Smooth Sculpted Loft along Z from list of [z, rx, ry], flush at exact slices[0][0]..slices[last][0]!
module loft_ellipses(slices) {
    n = len(slices);
    for (i = [0 : n - 2]) {
        s0 = slices[i];
        s1 = slices[i + 1];
        z0 = (i == 0)     ? s0[0]        : s0[0] - 0.01;
        z1 = (i == n - 2) ? s1[0] - 0.02 : s1[0] - 0.01;
        hull() {
            translate([0, 0, z0])
                scale([s0[1], s0[2], 1])
                    cylinder(h = 0.02, r = 1, center = false, $fn = 84);
            translate([0, 0, z1])
                scale([s1[1], s1[2], 1])
                    cylinder(h = 0.02, r = 1, center = false, $fn = 84);
        }
    }
}

// ============================================================================
// 2. SCULPTED ONE-PIECE TORSO + PELVIS + 2x2 TU BACK DOCK (z_world = 57.5..105.5)
// ============================================================================

// Shared support-free Back Dock Mortise + 1 TU Central Teardrop Bore (z=87.5) + 2 TU Tail Port (z=62.5)
module back_and_tail_port_cuts() {
    // 1.2 mm-deep Back Dock Mortise Pocket (y = 12.2..13.4) with ~35-deg beveled top edge (bottom seat stays at exact z = 75.42!)
    hull() {
        translate([0, 12.2, 87.5])
            rotate([-90, 0, 0])
                pill_box(24.16, 24.16, 0.05, 3.88);
        translate([0, 13.45, 88.45])
            rotate([-90, 0, 0])
                pill_box(24.16, 26.06, 0.2, 3.88);
    }

    // Central 12.8 mm-deep (>= 1 TU!) Ø 7.0 mm Teardrop Pro Bore at z = 87.5
    translate([0, 13.4, 87.5])
        rotate([90, 0, 0])
            pro_teardrop_bore_cut(PRO_FREE_D, 13.2, 0.55);

    // Lower-Back Tail Port at exact z = 62.5 mm (2.0 TU = 25.0 mm below z = 87.5!):
    // 12.8 mm-deep (>= 1 TU!) Ø 7.0 mm Teardrop Pro Bore (mates real pin_friction + tail_acc!)
    translate([0, 13.1, 62.5])
        rotate([90, 0, 0])
            pro_teardrop_bore_cut(PRO_FREE_D, 12.8, 0.55);
}

// Grounded Lower-Back Tail Boss (seats flush on z = 57.50 print bed -> zero V5 island & zero underside overhang!)
module grounded_tail_boss(y_inner = 8.4) {
    hull() {
        translate([0, y_inner, 62.5])
            rotate([-90, 0, 0])
                cylinder(h = 0.2, r = 4.9, $fn = 56);
        translate([0, 12.6, 62.5])
            rotate([-90, 0, 0])
                cylinder(h = 0.5, r = 4.9, $fn = 56);
        translate([0, (y_inner + 13.1) / 2, 57.5])
            pill_box(9.8, 13.1 - y_inner, 0.2, 1.8);
    }
}

module part_torso() {
    difference() {
        union() {
            // Smooth organic capsule torso + support-free <=37-deg pelvis flare + >=1.3 mm hip-socket wall
            loft_ellipses([
                [ 57.5, 11.4,  8.5],  // Support-free pelvis base (hip arches carve side leg cutouts!)
                [ 61.0, 14.0, 10.5],  // <= 36.6 deg flare
                [ 64.5, 16.3, 12.3],  // Hip fullness
                [ 68.5, 16.2, 12.3],  // Full hip-socket wall envelope (Genus 0, zero thin walls!)
                [ 72.0, 15.0, 11.5],  // Subtle art-toy waist taper
                [ 80.0, 15.8, 12.0],  // Lower chest (preserves shirt_pro unroll profile!)
                [ 92.0, 17.2, 12.8],  // Sculpted upper chest
                [ 99.5, 15.8, 11.6],  // Shoulder rounding
                [103.5, 11.0,  9.2],  // Collar taper
                [105.5,  7.8,  7.2]   // Neck collar rim
            ]);

            // Integrated Back Dock Boss with <=35-deg lower rear buttress (flat pad at y = +13.4, centered at z = 87.5)
            hull() {
                translate([0, 7.2, 83.6])
                    rotate([-90, 0, 0])
                        pill_box(26.8, 35.6, 0.2, 5.4);
                translate([0, 12.8, 87.5])
                    rotate([-90, 0, 0])
                        pill_box(26.8, 26.8, 0.6, 4.4);
            }

            // Grounded Lower-Back Tail Boss at exact z = 62.5 mm (2.0 TU below Back Dock, seats flush at z = 57.5!)
            grounded_tail_boss(5.5);
        }

        // Subtle Waist Band V-Groove (~38 deg support-free flanks!)
        v_groove_ring(71.8, 15.3, 14.2, 0.76);

        // Top Neck Ball-Peg Socket
        translate([0, 0, 105.5])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.6);

        // Left & Right Support-Free Teardrop-Roof Shoulder Sockets at exact [sx*15.0, 0, 95.5], tilt 78 deg
        for (sx = [-1, 1]) {
            shoulder_socket_cut_world(sx, sx * 15.0, 95.5, 78, PEG_BIG_D, 4.2, 4.0);
        }

        // Left & Right Hip Sockets (cone_deg = 28 so 28 + 12 deg tilt = 40 deg < 45 deg!) + Conical Thigh-Swing Arches
        for (sx = [-1, 1]) {
            translate([sx * 10.5, 0, 63.0])
                rotate([0, sx * 12, 0])
                    ball_socket_cut(PEG_BIG_D, 4.6, 8.0, 28);
            hip_arch_relief_cut(sx * 11.2, 57.5, 7.4, 37);
        }

        // Back Dock Mortise + Central Pro Bore (z=87.5) + 2 TU Tail Port Bore (z=62.5)
        back_and_tail_port_cuts();
    }
}

module part_back_dock_studs() {
    // 2x2 TU Snap Small Studs in #FF6B4A Coral Spark on a solid 1.4 mm mortise-tenon plate!
    // Seats into torso/snap_torso's y = 12.2..13.4 mortise so studs emerge at exact y = 13.6 mm!
    translate([0, 12.2, 87.5])
        rotate([-90, 0, 0]) {
            difference() {
                union() {
                    pill_box(24.0, 24.0, 1.4, 3.8);
                    for (ix = [-0.5, 0.5], iy = [-0.5, 0.5]) {
                        translate([ix * TU, iy * TU, 1.4])
                            tv_stud(root_sink = 0.5);
                    }
                }
                translate([0, 0, -0.2])
                    cylinder(h = 2.0, r = PRO_FREE_D / 2 + 0.1, $fn = 72);
            }
        }
}

// ============================================================================
// 3. ARMS & 6.6mm C-GRIP 3-FINGER HANDS (Built in local Z-up limb frame!)
// ============================================================================

module part_upper_arm() {
    // Length = 22.0 mm, exact z = 0..22.0
    H = 22.0;
    difference() {
        loft_ellipses([
            [0.0,  5.6, 5.6],
            [2.0,  7.2, 7.2],
            [11.0, 7.0, 7.0],
            [19.5, 6.8, 6.8],
            [H,    5.5, 5.5]
        ]);
        ball_socket_cut(PEG_SML_D, 4.0);
        translate([0, 0, H])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.2);
    }
}

module part_forearm() {
    // Length = 21.0 mm, flared astronaut/vinyl wrist cuff, exact z = 0..21.0
    H = 21.0;
    difference() {
        loft_ellipses([
            [0.0,  8.4, 8.1],
            [1.6,  9.7, 9.3],
            [4.5,  9.5, 9.1],
            [13.0, 8.2, 8.0],
            [19.2, 7.3, 7.2],
            [H,    5.8, 5.8]
        ]);
        // Crisp ~38-deg double V-cuff groove near wrist (zero 90-deg overhang!)
        for (zg = [2.8, 4.6]) {
            v_groove_ring(zg, 9.8, 9.15, 0.96);
        }
        ball_socket_cut(PEG_SML_D, 4.0);
        translate([0, 0, H])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_SML_D, 4.0);
    }
}

module part_hand(side = 1) {
    // Sleek, reinforced 3-finger + opposing-thumb functional C-grip hand (Genus: 0, flat z = 0 print!)
    difference() {
        union() {
            // 1) Wrist-to-knuckle curved anatomical palm & seamless lower cradle bed
            hull() {
                cylinder(h = 1.0, r = 5.7, $fn = 64);
                translate([0, 0.4, 4.6]) scale([6.45, 5.35, 3.40]) sphere(r = 1.0, $fn = 56);
                for (ki = [-1, 0, 1]) {
                    k_mid = (ki == 0) ? 1.0 : 0.0;
                    translate([ki * 4.70, 2.65 + 0.35 * k_mid, 9.80 + 0.65 * k_mid])
                        scale([2.14, 3.10, 2.95]) sphere(r = 1.0, $fn = 48);
                }
                for (px = [-3.6, 0, 3.6])
                    translate([px, -1.95, 7.35]) scale([2.75, 2.65, 2.35]) sphere(r = 1.0, $fn = 44);
            }

            // 2) Three separated, reinforced concentric-arch fingers
            for (fi = [-1, 0, 1]) {
                fx0 = fi * 4.70;
                fx1 = fi * 4.82;
                fx2 = fi * 4.78;
                fx3 = fi * 4.68;
                mid_extra = (fi == 0) ? 0.80 : ((fi == -side) ? 0.25 : 0.0);

                hull() {
                    translate([fx0,  2.65 + (fi == 0 ? 0.35 : 0), 9.80 + (fi == 0 ? 0.65 : 0)])
                        scale([2.14, 3.10, 2.95]) sphere(r = 1.0, $fn = 48);
                    translate([fx1,  2.55, 12.40 + mid_extra * 0.25])
                        scale([2.04, 2.98, 2.65]) sphere(r = 1.0, $fn = 48);
                }
                hull() {
                    translate([fx1,  2.55, 12.40 + mid_extra * 0.25])
                        scale([2.04, 2.98, 2.65]) sphere(r = 1.0, $fn = 48);
                    translate([fx2,  1.05, 15.10 + mid_extra * 0.55])
                        scale([1.98, 2.80, 2.58]) sphere(r = 1.0, $fn = 48);
                }
                hull() {
                    translate([fx2,  1.05, 15.10 + mid_extra * 0.55])
                        scale([1.98, 2.80, 2.58]) sphere(r = 1.0, $fn = 48);
                    translate([fx3, -1.35, 16.75 + mid_extra * 0.85])
                        scale([1.92, 2.46, 2.62]) sphere(r = 1.0, $fn = 48);
                }
            }

            // 3) Reinforced opposing thumb (-side * X) with full-palm thenar buttress
            hull() {
                cylinder(h = 1.0, r = 5.7, $fn = 64);
                translate([0, 0.4, 4.6])             scale([6.45, 5.35, 3.40]) sphere(r = 1.0, $fn = 56);
                translate([-side * 4.2,  1.5, 8.6])                            sphere(r = 2.95, $fn = 44);
                translate([-side * 5.6, -4.3, 7.6])  scale([1.14, 1.08, 1.00]) sphere(r = 3.00, $fn = 48);
            }
            hull() {
                translate([-side * 3.4, -1.95, 7.55])                          sphere(r = 2.75, $fn = 44);
                translate([-side * 5.6, -4.30, 7.60]) scale([1.14, 1.08, 1.0]) sphere(r = 3.00, $fn = 48);
                translate([-side * 6.0, -6.40, 9.90]) scale([1.15, 1.08, 1.0]) sphere(r = 2.84, $fn = 48);
            }
            hull() {
                translate([-side * 6.0, -6.4,  9.9]) scale([1.15, 1.08, 1.0]) sphere(r = 2.84, $fn = 48);
                translate([-side * 5.5, -6.6, 12.0]) scale([1.14, 1.08, 1.0]) sphere(r = 2.64, $fn = 48);
            }
        }

        // Wrist ball-peg socket on flat z = 0 face (mates BOTH Pro spark_peg_sml AND Snap snap_turret!)
        intersection() {
            ball_socket_cut(PEG_SML_D, 3.6);
            translate([0, 0, -1]) cylinder(h = 8.75, r = 8.0, $fn = 64);
        }

        // Support-free Ø 6.75 mm Teardrop Pro-shaft cradle (+Y_2d -> +Z_world; continues <=38-deg bevel across fingertip tips so V5=0!)
        translate([0, -2.3, 11.4])
            rotate([90, 0, 90])
                linear_extrude(height = 28, center = true) {
                    r_cradle = (PRO_SHAFT_D + 0.15) / 2;
                    y_apex   = r_cradle / sin(40);
                    union() {
                        teardrop_2d(PRO_SHAFT_D + 0.15, 40);
                        polygon([
                            [ 0.0,  3.6],
                            [-2.5,  3.6],
                            [-2.5,  y_apex + 2.5 / tan(38)],
                            [ 0.0,  y_apex]
                        ]);
                    }
                }
    }
}

// ============================================================================
// 4. LEGS & 1x2 TU SOCKET SNEAKER BOOTS
// ============================================================================

module part_thigh() {
    H = 24.0;
    difference() {
        loft_ellipses([
            [0.0,  6.5, 6.6],
            [2.0,  8.0, 8.2],
            [12.0, 8.5, 8.8],
            [21.5, 8.3, 8.6],
            [H,    6.6, 6.8]
        ]);
        ball_socket_cut(PEG_SML_D, 4.2);
        translate([0, 0, H])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.4);
    }
}

module part_shin() {
    // Flared art-toy boot-leg, exact z = 0..24.5
    H = 24.5;
    difference() {
        loft_ellipses([
            [0.0,  8.8, 9.4],
            [2.0, 10.2, 10.8],
            [6.0,  9.8, 10.3],
            [16.0, 8.5,  8.9],
            [22.5, 8.0,  8.3],
            [H,    6.5,  6.7]
        ]);
        // Crisp ~38-deg ankle V-cuff groove
        v_groove_ring(3.2, 10.3, 9.6, 1.06);
        ball_socket_cut(PEG_SML_D, 4.2);
        translate([0, 0, H])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_SML_D, 4.2);
    }
}

module part_boot() {
    // Chunky sneaker-boot (22.8 wide x 32.2 long x 13.0 tall, forward = -Y), clipped flush at z >= 0!
    // Underside houses 1x2 TU Snap Small sockets at y = -3.5 +- 6.25 PLUS scalloped outsole reliefs
    // for all neighbouring plate studs so Kip stands 100% flat anywhere on a 2x4 / 4x4 Snap plate!
    difference() {
        intersection() {
            translate([-30, -40, 0.0])
                cube([60, 80, 25.0]);
            union() {
                // Sole + Midsole with 0.5 mm bed chamfer
                hull() {
                    translate([0, -3.5, 0.0])  pill_box(21.6, 31.0, 0.05, 9.5);
                    translate([0, -3.5, 0.6])  pill_box(22.8, 32.2, 3.4,  10.0);
                }
                // Tapered midsole V-groove waist at z = 4.2 mm (38-deg slopes, zero overhang!)
                hull() {
                    translate([0, -3.5, 3.9])  pill_box(22.8, 32.2, 0.1, 10.0);
                    translate([0, -3.5, 4.35]) pill_box(21.5, 30.9, 0.1,  9.4);
                }
                // Puffy rounded sneaker upper + toe cap (z = 6.6 so sphere stays cleanly above sole!) + ankle collar
                hull() {
                    translate([0, -3.5, 4.35]) pill_box(21.5, 30.9, 0.1,  9.4);
                    translate([0, -3.5, 5.0])  pill_box(22.4, 31.6, 0.7,  9.8);
                    translate([0, -7.5, 6.6])  scale([1.0, 1.15, 0.64]) sphere(r = 9.8, $fn = 72);
                    translate([0,  1.5, 9.5])  scale([1.0, 1.05, 1.0])  cylinder(h = 3.5, r = 9.2, $fn = 72);
                }
            }
        }

        // Top Ankle Socket at y = +1.5, z = 13.0 (mates BOTH Pro spark_peg_sml AND Snap snap_turret!)
        translate([0, 1.5, 13.0])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_SML_D, 4.2);

        // 1x2 TU Snap Small Sockets in the flat sole (y = -9.75 and +2.75, pitch = 12.5 mm!)
        for (sy = [-0.5, 0.5]) {
            translate([0, -3.5 + sy * TU, 0])
                tv_socket_cut(3.5);
        }

        // Scalloped Outsole Tread Stud-Reliefs at all 10 surrounding lattice neighbours (I3_seats_on_reference!)
        for (sy = [-1.5, 1.5]) {
            translate([0, -3.5 + sy * TU, 0])
                tv_stud_relief_cut(3.2);
        }
        for (sx = [-1, 1], sy = [-1.5, -0.5, 0.5, 1.5]) {
            translate([sx * TU, -3.5 + sy * TU, 0])
                tv_stud_relief_cut(3.2);
        }
    }
}

// ============================================================================
// 5. #FF6B4A SPARK BALL-PEGS (Supportless flat-bed compliant joint connectors!)
// ============================================================================

// Shared Zero-Support Double-Ended Compliant Ball-Joint Dumbbell (Pro spark_peg & Snap flanged snap_turret):
// - Continuous single revolve (<=40 deg from vertical everywhere -> 0.00 mm2 steep overhang!)
// - Exact ball-to-ball centre span (13.4 mm for d=9.0, 10.6 mm for d=8.0) reaches past both 3.6..4.8 mm socket seats!
module _dumbbell_connector(d = PEG_BIG_D, with_flange = false) {
    r        = d / 2;
    span     = (d > 8.5) ? 13.4 : 10.6;
    zb       = d * 0.25;          // 2.25 mm (big) / 2.00 mm (sml) -> <=30 deg overhang at z=0
    zt       = zb + span;
    h        = zt + zb;           // 17.90 mm (big) / 14.60 mm (sml)
    zm       = h / 2;
    r_neck   = r * 0.70;          // Ø6.30 mm (big) / Ø5.60 mm (sml) waist -> >=23 deg swing per socket
    rf       = r + 0.60;          // compact anti-pinch center stop-ring on Snap turrets
    dz_f     = (rf - r_neck) / tan(42);
    cone_deg = 40;                // upper ball underside cone: r_tan = 0.766*r < ro = 0.86*r!
    a_bot    = -asin(zb / r);
    a_top_lo = acos(r_neck / r);
    a_tan    = -cone_deg;
    r_tan    = r * cos(cone_deg);
    z_tan    = zt + r * sin(a_tan);
    z_cone0  = z_tan - (r_tan - r_neck) / tan(cone_deg);
    a_top_hi = asin(zb / r);
    sw       = 0.52;
    z_slot_b = zb + r * 0.55;

    difference() {
        rotate_extrude($fn = 84)
            polygon(concat(
                [[0, 0]],
                [for (i = [0:16])
                    let(a = a_bot + (a_top_lo - a_bot) * i / 16)
                    [r * cos(a), zb + r * sin(a)]
                ],
                with_flange ? [
                    [r_neck, zm - 0.18 - dz_f],
                    [rf,     zm - 0.18],
                    [rf,     zm + 0.18],
                    [r_neck, zm + 0.18 + dz_f]
                ] : [],
                [[r_neck, z_cone0]],
                [for (i = [0:16])
                    let(a = a_tan + (a_top_hi - a_tan) * i / 16)
                    [r * cos(a), zt + r * sin(a)]
                ],
                [[0, h]]
            ));

        // Orthogonal compliant cross-flex slots (upward top slot + <=38-deg gable-roofed bottom slot -> zero V10 ledge!)
        translate([-(rf + 2), -sw, zt - r * 0.55])
            cube([2 * (rf + 2), 2 * sw, h]);
        rotate([0, 0, 90])
            rotate([90, 0, 0])
                linear_extrude(height = 2 * (rf + 2), center = true)
                    polygon([
                        [-sw, -0.2],
                        [ sw, -0.2],
                        [ sw, z_slot_b],
                        [0.0, z_slot_b + sw / tan(38)],
                        [-sw, z_slot_b]
                    ]);

        // Center axial Ø1.90 mm relief bore
        translate([0, 0, -0.2])
            cylinder(h = h + 0.4, r = 0.95, $fn = 36);
    }
}

module part_spark_peg(d = PEG_BIG_D) {
    _dumbbell_connector(d, false);
}

// ============================================================================
// 6. TEST ACCESSORIES FOR EAR-POD BOSSES & LOWER-BACK TAIL PORT (12.5 mm TU!)
// ============================================================================

module part_ear_acc(side = 1) {
    // Snap Small (Ø 6.7 mm female socket at z = 0) Comm-Headphone Cup + Support-Free Flat-Base Aerial!
    difference() {
        intersection() {
            translate([-30, -15, 0.0])
                cube([60, 30, 12.0]);
            union() {
                cylinder(h = 3.2, r1 = 9.0, r2 = 9.4, $fn = 72);
                translate([0, 0, 3.2])
                    cylinder(h = 3.4, r1 = 9.4, r2 = 7.2, $fn = 72);
                translate([0, 0, 6.6])
                    cylinder(h = 1.2, r1 = 5.4, r2 = 4.2, $fn = 64);

                // Swept comm aerial seated flush on z = 0 (zero mid-air cantilever!)
                hull() {
                    translate([-side * 5.5, 1.0, 1.6]) sphere(r = 2.6, $fn = 36);
                    translate([-side * 19.5, 4.5, 1.4]) sphere(r = 2.0, $fn = 36);
                }
                translate([-side * 21.0, 5.0, 1.6])
                    sphere(r = 2.8, $fn = 44);
            }
        }

        tv_socket_cut(3.4);

        difference() {
            translate([0, 0, 6.5]) cylinder(h = 0.8, r = 6.8, $fn = 64);
            translate([0, 0, 6.4]) cylinder(h = 1.0, r = 5.8, $fn = 64);
        }
    }
}

// Clean tail geometry: origin (0,0,0) is the flat collar seat face!
// +Z (0..10.4) is a compliant slotted Ø 7.08 mm friction-pin plug clicking INTO Kip's z = 62.5 rear port,
// -Z (0..-33.7) sweeps BACKWARD (-Z_three) and UPWARD (+Y_three) with flat x = +-3.00 mm side cheeks for 100% zero-support flat-bed printing!
module part_tail_test() {
    difference() {
        intersection() {
            translate([-3.00, -15.0, -40.0])
                cube([6.00, 50.0, 55.0]);
            union() {
                // Compliant Pro Ø 6.8 mm body + Ø 7.08 mm friction-retention bead plugging into Kip's z = 62.5 port
                cylinder(h = 9.2, r = 3.40, $fn = 64);
                translate([0, 0, 2.2])
                    cylinder(h = 1.4, r1 = 3.40, r2 = 3.54, $fn = 64);
                translate([0, 0, 3.6])
                    cylinder(h = 2.4, r = 3.54, $fn = 64);
                translate([0, 0, 6.0])
                    cylinder(h = 1.4, r1 = 3.54, r2 = 3.40, $fn = 64);
                translate([0, 0, 9.2])
                    cylinder(h = 1.2, r1 = 3.40, r2 = 2.85, $fn = 64);

                // Flat-faced collar ring at z = 0.0 (seats flush against Kip's rear tail boss!)
                hull() {
                    translate([0, 0, -0.8]) cylinder(h = 0.8, r1 = 5.2, r2 = 5.2, $fn = 56);
                    translate([0, -0.6, -5.5]) sphere(r = 4.5, $fn = 48);
                }
                hull() {
                    translate([0, -0.6, -5.5])  sphere(r = 4.5, $fn = 48);
                    translate([0,  4.8, -16.0]) sphere(r = 3.8, $fn = 48);
                }
                hull() {
                    translate([0,  4.8, -16.0]) sphere(r = 3.8, $fn = 48);
                    translate([0, 15.0, -24.5]) sphere(r = 3.4, $fn = 48);
                }
                hull() {
                    translate([0, 15.0, -24.5]) sphere(r = 3.4, $fn = 48);
                    translate([0, 22.0, -28.5]) sphere(r = 5.2, $fn = 56);
                }
            }
        }
        // Vertical flex slot across Y when printed on flat X cheek -> zero V10 cantilever ledge & stronger layer-plane flex!
        translate([-5.0, -0.55, 2.0])
            cube([10.0, 1.1, 9.0]);
    }
}

// ============================================================================
// 7. SIMPLIFIED SNAP (3+) EDITION BODY PARTS
//    Reuses 100% identical Head assembly, 3-Finger Hands, 1x2 Sneaker Boots,
//    2x2 Back Dock, and all 5 TU Accessory Zones — with chunky 1-piece arms,
//    1-piece legs, and reversible flanged compliant Snap turrets!
// ============================================================================

module part_snap_torso() {
    difference() {
        union() {
            // Chunkier, cuddlier 1-piece coverall capsule torso with <=37-deg pelvis flare
            loft_ellipses([
                [ 57.5, 11.6,  8.6],
                [ 61.2, 14.3, 10.7],
                [ 65.0, 16.8, 12.6],
                [ 76.0, 16.9, 12.7],
                [ 91.0, 17.6, 13.0],
                [ 99.5, 16.0, 11.8],
                [103.5, 11.5,  9.6],
                [105.5,  8.6,  8.0]
            ]);

            // Same 2x2 TU Back Dock Boss at z = 87.5 with <=35-deg lower rear buttress
            hull() {
                translate([0, 7.6, 83.6])
                    rotate([-90, 0, 0])
                        pill_box(26.8, 35.4, 0.2, 5.4);
                translate([0, 12.8, 87.5])
                    rotate([-90, 0, 0])
                        pill_box(26.8, 26.8, 0.6, 4.4);
            }

            // Grounded Lower-Back Tail Boss at exact z = 62.5 (2.0 TU below Back Dock, seats flush at z = 57.5!)
            grounded_tail_boss(5.5);
        }

        // Top Neck Turret Socket + Support-Free Shoulder Sockets + Hip Sockets (mate reversible snap_turret_big!)
        translate([0, 0, 105.5])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.4);

        for (sx = [-1, 1]) {
            shoulder_socket_cut_world(sx, sx * 15.2, 95.0, 84, PEG_BIG_D, 4.2, 4.0);

            translate([sx * 10.8, 0, 62.5])
                ball_socket_cut(PEG_BIG_D, 4.4, 8.0, 36);
            hip_arch_relief_cut(sx * 11.5, 57.5, 7.6, 37);
        }

        // Back Dock Mortise + Central Pro Bore (z=87.5) + 2 TU Tail Port Bore (z=62.5)
        back_and_tail_port_cuts();
    }
}

module part_snap_arm() {
    // 1-piece chunky curved Snap (3+) sleeve (exact H = 34.0 mm, single watertight body!):
    // z = 0 cuff mates reversible snap_turret (8.0 mm -> shared hand_l/r!),
    // z = 34.0 shoulder mates reversible snap_turret_big (9.0 mm -> snap_torso!).
    difference() {
        intersection() {
            translate([-20, -20, 0.0])
                cube([40, 40, 34.0]);
            union() {
                hull() {
                    translate([0, -3.8, 0.0])  cylinder(h = 0.5, r = 8.9, $fn = 72);
                    translate([0, -3.5, 2.3])  cylinder(h = 1.5, r = 9.8, $fn = 72);
                    translate([0, -2.0, 14.5]) sphere(r = 8.4, $fn = 64);
                }
                hull() {
                    translate([0, -2.0, 14.5]) sphere(r = 8.4, $fn = 64);
                    translate([0,  0.0, 26.2]) sphere(r = 7.5, $fn = 64);
                    translate([0,  0.0, 33.2]) cylinder(h = 0.8, r = 6.2, $fn = 64);
                }
            }
        }
        // Tilted 11 deg around X -> 30-deg local groove flanks keep world slope <= 41 deg (< 45 deg)!
        translate([0, -3.6, 3.6])
            rotate([11, 0, 0])
                v_groove_ring(0, 9.9, 9.1, 1.0, 30);

        // Wrist turret socket at z = 0 cuff + Open Shoulder socket at z = 34.0!
        translate([0, -3.8, 0.0])
            ball_socket_cut(PEG_SML_D, 3.8);
        translate([0, 0, 34.0])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.2);
    }
}

module part_snap_leg() {
    // 1-piece chunky flared Snap (3+) trouser-leg (exact H = 38.0 mm):
    // z = 0 ankle mates reversible snap_turret (8.0 mm -> shared boot!),
    // z = 38.0 hip mates reversible snap_turret_big (9.0 mm -> snap_torso!).
    H = 38.0;
    difference() {
        loft_ellipses([
            [0.0,   9.0,  9.5],
            [2.4,  10.4, 11.0],
            [8.0,  10.0, 10.5],
            [22.0,  9.2,  9.6],
            [34.5,  8.6,  8.9],
            [H,     6.8,  7.0]
        ]);
        // Crisp ~38-deg trouser V-cuff groove
        v_groove_ring(3.6, 10.5, 9.7, 1.06);
        ball_socket_cut(PEG_SML_D, 4.0);
        translate([0, 0, H])
            mirror([0, 0, 1])
                ball_socket_cut(PEG_BIG_D, 4.2);
    }
}

// Reversible, compliant Coral Spark (#FF6B4A) Snap Swivel Turret Collar!
// - Support-free upright on z = 0 (truncated ends + 45-deg double-chamfered anti-pinch center collar!)
// - Physically snaps into shared head socket (d = 9.0), hand_l/r (d = 8.0), and boot (d = 8.0)!
module part_snap_turret(d = PEG_SML_D) {
    _dumbbell_connector(d, true);
}

// Universal Ø 9.0 mm Ball-to-2x1-Stud Spark Neck Turret (lets BOTH Pro 8+ & Snap 3+ Kip wear ANY PartSpec 2x1 Head!)
module part_neck_turret_2x1() {
    r  = PEG_BIG_D / 2;   // 4.5 mm
    zb = 2.20;            // ball equator z (truncated flat at z = 0, <= 41.0 deg overhang)
    zp = 8.40;            // low-profile 2x1 collar start (<= 41.5 deg support-free flare -> 0.00 mm2 V4!)
    zt = 8.60;            // 2x1 stud seat plane (seats low on Kip's neck collar at y = 107.8 mm!)
    difference() {
        union() {
            // Lower compliant Ø 9.0 mm snap-ball
            intersection() {
                translate([0, 0, zb]) sphere(r = r, $fn = 72);
                cylinder(h = zb + r + 1, r = r + 1, $fn = 72);
            }
            // Support-free <= 41.5 deg flare from neck ball into compact 2x1 TU collar pad
            hull() {
                translate([0, 0, zb])
                    cylinder(h = 0.2, r = r - 0.05, $fn = 72);
                translate([0, 0, zp])
                    pill_box(19.6, 10.0, zt - zp, 4.5);
            }
            // Centered 2x1 ToyVentor Small Studs (x = +-6.25 mm, y = 0, z = 8.60 mm)
            for (sx = [-0.5, 0.5]) {
                translate([sx * TU, 0, zt])
                    tv_stud(0.2);
            }
        }
        // Support-free <=38-deg gable-roofed flex slot + conical-tip central relief bore
        rotate([90, 0, 0])
            linear_extrude(height = 2 * r + 4, center = true)
                polygon([
                    [-0.52, -0.2],
                    [ 0.52, -0.2],
                    [ 0.52,  3.5],
                    [ 0.00,  3.5 + 0.52 / tan(38)],
                    [-0.52,  3.5]
                ]);
        translate([0, 0, -0.1])
            cylinder(h = 5.0, r = 1.0, $fn = 36);
        translate([0, 0, 4.89])
            cylinder(h = 1.0 / tan(38), r1 = 1.0, r2 = 0, $fn = 36);
    }
}

// ============================================================================
// Export Dispatcher (Assembly Frame by default; Flat-on-Bed when PRINT_ORIENT=true)
// ============================================================================

module build_part(p) {
    if      (p == "torso")           part_torso();
    else if (p == "back_dock_studs") part_back_dock_studs();
    else if (p == "upper_arm")       part_upper_arm();
    else if (p == "forearm")         part_forearm();
    else if (p == "hand_l")          part_hand( 1);
    else if (p == "hand_r")          part_hand(-1);
    else if (p == "thigh")           part_thigh();
    else if (p == "shin")            part_shin();
    else if (p == "boot")            part_boot();
    else if (p == "spark_peg_big")   part_spark_peg(PEG_BIG_D);
    else if (p == "spark_peg_sml")   part_spark_peg(PEG_SML_D);
    else if (p == "ear_acc_l")       part_ear_acc( 1);
    else if (p == "ear_acc_r")       part_ear_acc(-1);
    else if (p == "tail_acc")        part_tail_test();
    else if (p == "snap_torso")      part_snap_torso();
    else if (p == "snap_arm")        part_snap_arm();
    else if (p == "snap_leg")        part_snap_leg();
    else if (p == "snap_turret")     part_snap_turret(PEG_SML_D);
    else if (p == "snap_turret_big") part_snap_turret(PEG_BIG_D);
    else if (p == "neck_turret_2x1") part_neck_turret_2x1();
}

module export_print_oriented(p) {
    if      (p == "torso")           translate([0, 0, -57.5]) build_part(p);
    else if (p == "snap_torso")      translate([0, 0, -57.5]) build_part(p);
    else if (p == "back_dock_studs") rotate([90, 0, 0]) translate([0, -12.2, -87.5]) build_part(p);
    else if (p == "tail_acc")        translate([0, 0, 3.00]) rotate([0, 90, 0]) build_part(p);
    else                             build_part(p);
}

if (PRINT_ORIENT) export_print_oriented(PART);
else              build_part(PART);
