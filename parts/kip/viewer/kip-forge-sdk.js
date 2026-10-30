// ToyVentor Kip Expansion Helpers:
//   1) 2D Decal Expression Skins (`BRAND_STYLE.md` rule 5: zero moulded 3D faces)
//   2) Phase 4 Photo-to-Accessory Forge (`prints: false` digital-only game accessories)
//   3) `#toy=` ToyContract URL encoder & LLM PartSpec Prompt loader

export const DECAL_EXPRESSIONS = [
  { id: 'spark',     label: 'Spark' },
  { id: 'happy',     label: 'Happy' },
  { id: 'wink',      label: 'Wink' },
  { id: 'cool',      label: 'Cool Shades' },
  { id: 'starry',    label: 'Starry' },
  { id: 'surprised', label: 'Surprised' },
  { id: 'blank',     label: 'Blank Plate' },
];

export function createDecalExpressionCanvas(expression = 'spark', headType = 'kid') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (expression === 'blank') return c;

  const isRobot = headType === 'robot';
  const isAnimal = headType === 'fox' || headType === 'bear';
  const isHuman = !isRobot && !isAnimal;

  // Dark LED visor screen ONLY for Robot head; Human & Critter heads use visor-free transparent decal skin!
  if (isRobot) {
    ctx.fillStyle = '#161d30';
    roundRect(ctx, 36, 36, 440, 184, 82);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(184, 232, 255, 0.38)';
    ctx.stroke();
  }

  // Soft cream muzzle mask + button nose + critter mouth for Fox & Bear
  if (isAnimal) {
    ctx.fillStyle = 'rgba(252, 246, 236, 0.94)';
    ctx.beginPath();
    ctx.ellipse(256, 178, headType === 'bear' ? 92 : 82, 56, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const eyeCol = isRobot ? '#b8e8ff' : '#241814';
  const mouthCol = isRobot ? '#b8e8ff' : '#3B221B';
  const glintCol = '#ffffff';
  const cheekCol = '#ff6b4a';

  // Signature Coral Spark cheek blushes (wider out on the curved cheeks for Human faces!)
  ctx.fillStyle = cheekCol;
  if (isHuman) {
    for (const bx of [68, 444]) {
      const rg = ctx.createRadialGradient(bx, 180, 4, bx, 180, 38);
      rg.addColorStop(0, 'rgba(255, 107, 74, 0.62)');
      rg.addColorStop(0.65, 'rgba(255, 118, 92, 0.30)');
      rg.addColorStop(1, 'rgba(255, 118, 92, 0.0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.ellipse(bx, 180, 38, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.globalAlpha = isAnimal ? 0.74 : 0.90;
    drawCapsule(ctx, 84, 176, 52, 24);
    drawCapsule(ctx, 428, 176, 52, 24);
    ctx.globalAlpha = 1.0;
  }

  // Expressive human eyebrows + warm stylized 2D button nose hint (visible on all human expressions including Cool Shades!)
  if (isHuman) {
    ctx.strokeStyle = 'rgba(58, 34, 22, 0.86)';
    ctx.lineWidth = 10.5;
    ctx.lineCap = 'round';
    for (const [bx, dir] of [[138, -1], [374, 1]]) {
      ctx.beginPath();
      const lift = expression === 'surprised'
        ? -14
        : (expression === 'cool' ? -10 : (expression === 'wink' && dir === 1 ? 8 : 0));
      ctx.arc(bx, 78 + lift, 44, Math.PI * 1.20, Math.PI * 1.80);
      ctx.stroke();
    }
    // Cute painted 2D human nose crescent + soft highlight
    ctx.fillStyle = 'rgba(182, 92, 68, 0.42)';
    ctx.beginPath();
    ctx.ellipse(256, 152, 13, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 68, 48, 0.55)';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(256, 150, 10, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  // Cute stylized button nose tip for Fox / Bear (2D decal only — zero 3D nostril holes!)
  if (isAnimal) {
    ctx.fillStyle = '#20232A';
    ctx.beginPath();
    ctx.ellipse(256, 154, headType === 'bear' ? 26 : 21, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(249, 149, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const eyeCenters = isHuman ? [138, 374] : [152, 360];

  const drawHumanOrCritterEye = (cx, cy = 124, side = 0) => {
    if (isHuman) {
      // Soft rounded human eye oval + warm iris + curved upper eyelash line
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 37, 42, 0, 0, Math.PI * 2);
      ctx.fill();

      // Warm chestnut-amber iris crescent
      ctx.fillStyle = '#8B5437';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 17, 25, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#BA7D56';
      ctx.beginPath();
      ctx.ellipse(cx + 4, cy + 21, 15, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Re-deepen pupil center
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.arc(cx, cy - 2, 20, 0, Math.PI * 2);
      ctx.fill();

      // Soft upper eyelash sweep
      ctx.strokeStyle = eyeCol;
      ctx.lineWidth = 8.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy + 3, 40, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      if (side !== 0) {
        ctx.beginPath();
        ctx.moveTo(cx + side * 34, cy - 12);
        ctx.lineTo(cx + side * 44, cy - 20);
        ctx.stroke();
      }

      // Twin lively catchlights
      ctx.fillStyle = glintCol;
      ctx.beginPath();
      ctx.arc(cx - 12, cy - 15, 13.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 13, cy + 14, 6.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.fillStyle = eyeCol;
    roundRect(ctx, cx - 33, cy - 39, 66, 78, 31);
    ctx.fill();
    ctx.fillStyle = glintCol;
    ctx.beginPath();
    ctx.arc(cx - 11, cy - 15, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 12, cy + 14, 6, 0, Math.PI * 2);
    ctx.fill();
  };

  if (expression === 'spark') {
    drawHumanOrCritterEye(eyeCenters[0], 124, -1);
    drawHumanOrCritterEye(eyeCenters[1], 124, 1);
    if (isHuman) {
      ctx.strokeStyle = mouthCol;
      ctx.lineWidth = 10.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(256, 168, 34, 0.16 * Math.PI, 0.84 * Math.PI);
      ctx.stroke();
    } else if (isAnimal) {
      ctx.strokeStyle = mouthCol;
      ctx.lineWidth = 8.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(237, 174, 19, 0.08 * Math.PI, 0.92 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(275, 174, 19, 0.08 * Math.PI, 0.92 * Math.PI);
      ctx.stroke();
    }
  } else if (expression === 'happy') {
    ctx.strokeStyle = eyeCol;
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    for (const cx of eyeCenters) {
      ctx.beginPath();
      ctx.arc(cx, 138, 37, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
    if (isHuman) {
      // Cheerful open D-laugh with crisp upper tooth strip & rosy tongue!
      ctx.save();
      ctx.beginPath();
      ctx.arc(256, 170, 37, 0, Math.PI, false);
      ctx.closePath();
      ctx.fillStyle = mouthCol;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(216, 168, 80, 11);
      ctx.fillStyle = '#FF7E6B';
      ctx.beginPath();
      ctx.ellipse(256, 198, 22, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.strokeStyle = mouthCol;
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.arc(256, 168, 30, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
    }
  } else if (expression === 'wink') {
    drawHumanOrCritterEye(eyeCenters[0], 124, -1);

    ctx.strokeStyle = eyeCol;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    const wx = eyeCenters[1];
    ctx.beginPath();
    ctx.arc(wx, 136, 35, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
    if (isHuman) {
      ctx.lineWidth = 8.5;
      ctx.beginPath();
      ctx.moveTo(wx + 31, 124);
      ctx.lineTo(wx + 43, 116);
      ctx.stroke();
    }

    ctx.strokeStyle = mouthCol;
    ctx.lineWidth = 10.5;
    ctx.beginPath();
    ctx.arc(262, 169, 32, 0.14 * Math.PI, 0.82 * Math.PI);
    ctx.stroke();
  } else if (expression === 'cool') {
    if (isHuman) {
      // Playful oversized rounded human sunglasses (warm dark frames + tinted gradient lenses + visible brows!)
      for (const lx of [138, 374]) {
        const lg = ctx.createLinearGradient(lx, 80, lx, 162);
        lg.addColorStop(0, 'rgba(34, 39, 54, 0.94)');
        lg.addColorStop(1, 'rgba(72, 48, 62, 0.86)');
        ctx.fillStyle = lg;
        ctx.strokeStyle = '#241B18';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.ellipse(lx, 120, 74, 43, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Crisp lens highlight slash
        ctx.strokeStyle = 'rgba(255,255,255,0.68)';
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lx - 34, 140);
        ctx.lineTo(lx - 4, 96);
        ctx.stroke();
      }
      // Curved nose bridge
      ctx.strokeStyle = '#241B18';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(256, 118, 22, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#20232A';
      ctx.strokeStyle = '#FFB830';
      ctx.lineWidth = 9;
      roundRect(ctx, 74, 78, 162, 80, 22);
      ctx.fill();
      ctx.stroke();
      roundRect(ctx, 276, 78, 162, 80, 22);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(236, 102);
      ctx.lineTo(276, 102);
      ctx.stroke();
    }
    // Confident smirk
    ctx.strokeStyle = isRobot ? '#FFB830' : mouthCol;
    ctx.lineWidth = 10.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(266, 174, 30, 0.16 * Math.PI, 0.76 * Math.PI);
    ctx.stroke();
  } else if (expression === 'starry') {
    if (isHuman) {
      for (const cx of eyeCenters) {
        ctx.fillStyle = eyeCol;
        ctx.beginPath();
        ctx.ellipse(cx, 124, 38, 43, 0, 0, Math.PI * 2);
        ctx.fill();
        drawStar(ctx, cx, 124, 5, 27, 12, '#FFB830');
        drawStar(ctx, cx - 13, 102, 4, 10, 3.8, '#ffffff');
      }
    } else {
      for (const cx of eyeCenters) {
        drawStar(ctx, cx, 120, 5, 40, 18, '#FFB830');
        drawStar(ctx, cx, 120, 4, 16, 6, '#ffffff');
      }
    }
    ctx.fillStyle = mouthCol;
    ctx.beginPath();
    ctx.ellipse(256, 180, 18, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (expression === 'surprised') {
    for (const cx of eyeCenters) {
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.arc(cx, 122, 37, 0, Math.PI * 2);
      ctx.fill();
      if (isHuman) {
        ctx.fillStyle = '#8B5437';
        ctx.beginPath();
        ctx.ellipse(cx, 138, 22, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = glintCol;
      ctx.beginPath();
      ctx.arc(cx - 11, 109, 12.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 12, 133, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = mouthCol;
    ctx.beginPath();
    ctx.ellipse(256, 181, 18, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FF7E6B';
    ctx.beginPath();
    ctx.ellipse(256, 192, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCapsule(ctx, cx, cy, w, h) {
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
}

function drawStar(ctx, cx, cy, pts, rOut, rIn, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / pts;
    const r = i % 2 === 0 ? rOut : rIn;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// ===========================================================================
// 2D CLOTHING DECALS FOR SHIRTS, JACKETS, OVERALLS, PANTS & SHORTS
// (`BRAND_STYLE.md`: surface graphics as crisp 2D decals/game skins, zero 3D spaghetti)
// Torso plane covers y_torso = 62.0..101.0 mm (py = 0..398 is Shirt chest; py = 398..512 is Pelvis waistband!)
// ===========================================================================
export function createTorsoOutfitDecalCanvas(shirtId = 'off', pantsId = 'off', skinHex = '#F6C8A6') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);

  const beltY = 398;

  // --- 1. SHIRT / JACKET / OVERALLS CHEST ZONE (py = 0 .. 398) ---
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 512, beltY + 2);
  ctx.clip();

  if (shirtId === 'spark_tee') {
    // Crew-neck skin cutout + crisp white ribbed collar + ToyVentor Spark Bolt emblem!
    ctx.fillStyle = skinHex;
    ctx.beginPath();
    ctx.ellipse(256, 8, 92, 54, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.ellipse(256, 8, 98, 58, 0, 0.08 * Math.PI, 0.92 * Math.PI);
    ctx.stroke();

    // Chest badge circle + golden lightning spark
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(256, 206, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFB830';
    ctx.lineWidth = 10;
    ctx.stroke();

    ctx.fillStyle = '#FF6B4A';
    ctx.beginPath();
    ctx.moveTo(272, 144);
    ctx.lineTo(216, 212);
    ctx.lineTo(254, 212);
    ctx.lineTo(236, 270);
    ctx.lineTo(298, 198);
    ctx.lineTo(258, 198);
    ctx.closePath();
    ctx.fill();
  } else if (shirtId === 'hoodie') {
    // Center metallic zip seam + white hoodie drawstrings + kangaroo pocket + chest patch
    ctx.strokeStyle = 'rgba(18, 28, 52, 0.55)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(256, 28);
    ctx.lineTo(256, beltY);
    ctx.stroke();
    ctx.strokeStyle = '#DCE4F2';
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(256, 34);
    ctx.lineTo(256, beltY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Kangaroo pocket
    ctx.fillStyle = 'rgba(16, 36, 84, 0.28)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 6;
    roundRect(ctx, 108, 256, 296, 118, 34);
    ctx.fill();
    ctx.stroke();

    // Drawstrings + aglets
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    for (const [sx, ex] of [[204, 194], [308, 318]]) {
      ctx.beginPath();
      ctx.moveTo(sx, 36);
      ctx.quadraticCurveTo(sx, 110, ex, 162);
      ctx.stroke();
      ctx.fillStyle = '#FF6B4A';
      roundRect(ctx, ex - 8, 156, 16, 22, 6);
      ctx.fill();
    }

    // Mini Spark patch on left chest
    ctx.fillStyle = '#FF6B4A';
    roundRect(ctx, 316, 116, 76, 52, 14);
    ctx.fill();
    drawStar(ctx, 354, 142, 5, 17, 7.5, '#FFB830');
  } else if (shirtId === 'varsity') {
    // V-neck striped rib collar + center cream placket & snap buttons + bold "K" chenille patch + striped waist rib!
    ctx.fillStyle = '#F4EFE6';
    ctx.fillRect(236, 24, 40, beltY - 24);
    for (const by of [88, 162, 236, 310]) {
      ctx.fillStyle = '#20232A';
      ctx.beginPath();
      ctx.arc(256, by, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(253, by - 3, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Striped bottom rib band
    ctx.fillStyle = '#F4EFE6';
    ctx.fillRect(24, beltY - 38, 464, 38);
    ctx.fillStyle = '#FF6B4A';
    ctx.fillRect(24, beltY - 24, 464, 12);

    // Angled side welt pockets
    ctx.strokeStyle = '#F4EFE6';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(118, 250); ctx.lineTo(152, 326); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(394, 250); ctx.lineTo(360, 326); ctx.stroke();

    // Bold "K" Varsity Letter Patch
    ctx.fillStyle = '#FF6B4A';
    ctx.strokeStyle = '#F4EFE6';
    ctx.lineWidth = 9;
    roundRect(ctx, 306, 104, 96, 106, 22);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 72px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', 354, 160);
  } else if (shirtId === 'overalls') {
    // Indigo Denim Bib + Shoulder Straps + Brass Buttons + Amber Top-Stitching over Sunny Tee!
    ctx.fillStyle = '#2F5596';
    // Straps
    roundRect(ctx, 106, -10, 62, 170, 14);
    ctx.fill();
    roundRect(ctx, 344, -10, 62, 170, 14);
    ctx.fill();
    // Main Bib
    roundRect(ctx, 96, 134, 320, beltY - 128, 24);
    ctx.fill();

    // Amber contrast stitching
    ctx.strokeStyle = '#F2B83B';
    ctx.lineWidth = 5;
    ctx.setLineDash([10, 7]);
    roundRect(ctx, 108, 146, 296, beltY - 150, 18);
    ctx.stroke();
    // Center bib pocket
    roundRect(ctx, 182, 206, 148, 118, 20);
    ctx.stroke();
    ctx.setLineDash([]);

    // Brass overall buttons
    for (const bx of [137, 375]) {
      ctx.fillStyle = '#FFB830';
      ctx.strokeStyle = '#8C5319';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(bx, 164, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Red woven tab on pocket
    ctx.fillStyle = '#FF6B4A';
    roundRect(ctx, 318, 226, 22, 34, 5);
    ctx.fill();
  } else if (shirtId === 'stripe_tee') {
    // Crisp Breton Cream horizontal stripes + Coral chest pocket!
    ctx.fillStyle = '#F4EFE6';
    for (let sy = 56; sy < beltY - 16; sy += 52) {
      ctx.fillRect(16, sy, 480, 24);
    }
    ctx.fillStyle = skinHex;
    ctx.beginPath();
    ctx.ellipse(256, 8, 92, 52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FF6B4A';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.ellipse(256, 8, 96, 56, 0, 0.08 * Math.PI, 0.92 * Math.PI);
    ctx.stroke();

    // Coral patch pocket on chest
    ctx.fillStyle = '#FF6B4A';
    roundRect(ctx, 312, 138, 84, 92, 18);
    ctx.fill();
    drawStar(ctx, 354, 184, 5, 20, 9, '#FFFFFF');
  } else if (shirtId === 'track_top') {
    // Asymmetric twin vertical racing stripes + zipper + checkered flag badge!
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(142, 10, 26, beltY);
    ctx.fillStyle = '#FF6B4A';
    ctx.fillRect(176, 10, 26, beltY);

    ctx.strokeStyle = '#20232A';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(256, 12);
    ctx.lineTo(256, beltY);
    ctx.stroke();

    // Checkered racing badge
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 306, 122, 92, 68, 14);
    ctx.fill();
    ctx.fillStyle = '#20232A';
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 4; col++) {
        if ((r + col) % 2 === 0) ctx.fillRect(314 + col * 19, 130 + r * 18, 19, 18);
      }
    }
  }
  ctx.restore();

  // --- 2. PELVIS WAISTBAND, BELT & POCKET TOP ZONE (py = 398 .. 512) ---
  if (pantsId === 'jeans' || pantsId === 'overalls_jeans') {
    if (pantsId === 'jeans') {
      // Warm leather belt + brass buckle!
      ctx.fillStyle = '#6E412A';
      ctx.fillRect(20, beltY, 472, 34);
      ctx.strokeStyle = '#FFB830';
      ctx.lineWidth = 9;
      roundRect(ctx, 224, beltY - 2, 64, 38, 9);
      ctx.stroke();
    }
    // Amber denim fly + scoop pockets
    ctx.strokeStyle = '#F2B83B';
    ctx.lineWidth = 5;
    ctx.setLineDash([9, 6]);
    ctx.beginPath();
    ctx.moveTo(256, beltY + 36);
    ctx.lineTo(256, 504);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(110, beltY + 34, 68, 0, 0.48 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(402, beltY + 34, 68, 0.52 * Math.PI, Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (pantsId === 'cargo_shorts') {
    // Woven utility belt + matte buckle + button fly
    ctx.fillStyle = '#4A3F32';
    ctx.fillRect(20, beltY, 472, 30);
    ctx.fillStyle = '#FFB830';
    roundRect(ctx, 230, beltY - 2, 52, 34, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(74, 63, 50, 0.55)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(256, beltY + 34);
    ctx.lineTo(256, 504);
    ctx.stroke();
  } else if (pantsId === 'sport_shorts' || pantsId === 'joggers') {
    // Ribbed elastic waistband + white athletic drawstrings
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(20, beltY, 472, 28);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(242, beltY + 14); ctx.quadraticCurveTo(226, beltY + 56, 232, beltY + 78); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(270, beltY + 14); ctx.quadraticCurveTo(286, beltY + 56, 280, beltY + 78); ctx.stroke();
  }

  return c;
}

export function createLegOutfitDecalCanvas(pantsId = 'off') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  if (pantsId === 'jeans') {
    ctx.strokeStyle = '#F2B83B';
    ctx.lineWidth = 6;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.arc(128, 22, 84, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (pantsId === 'overalls_jeans') {
    // Reinforced workwear knee/thigh patch with amber stitching!
    ctx.fillStyle = 'rgba(24, 48, 96, 0.48)';
    roundRect(ctx, 48, 76, 160, 118, 26);
    ctx.fill();
    ctx.strokeStyle = '#F2B83B';
    ctx.lineWidth = 6;
    ctx.setLineDash([9, 6]);
    roundRect(ctx, 48, 76, 160, 118, 26);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (pantsId === 'cargo_shorts') {
    // Stitched cargo pocket + flap + button!
    ctx.fillStyle = 'rgba(92, 74, 52, 0.26)';
    roundRect(ctx, 44, 62, 168, 134, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(72, 56, 38, 0.65)';
    ctx.lineWidth = 5;
    roundRect(ctx, 44, 62, 168, 134, 22);
    ctx.stroke();
    ctx.fillStyle = 'rgba(92, 74, 52, 0.42)';
    roundRect(ctx, 40, 56, 176, 46, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4A3F32';
    ctx.beginPath();
    ctx.arc(128, 82, 9, 0, Math.PI * 2);
    ctx.fill();
  } else if (pantsId === 'sport_shorts') {
    // Crisp white retro athletic hem stripe!
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 18, 186, 220, 24, 10);
    ctx.fill();
  } else if (pantsId === 'joggers') {
    // Twin vertical athletic stripes!
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(46, 8, 18, 240);
    ctx.fillStyle = '#FF6B4A';
    ctx.fillRect(72, 8, 14, 240);
  }
  return c;
}

// ===========================================================================
// PHASE 4: PHOTO-TO-ACCESSORY FORGE (`prints: false` Digital Game Accessories)
// ===========================================================================
export const KID_DRAWING_PRESETS = {
  sword: {
    id: 'sword',
    name: 'Cardboard Spark Sword',
    slot: 'hand',
    scaleMm: 62,
    stats: { speed: 1, spin: 0, torque: 2, glow: 1 },
  },
  wings: {
    id: 'wings',
    name: 'Rainbow Sketch Wings',
    slot: 'wings',
    scaleMm: 52,
    stats: { speed: 2, spin: 1, torque: 0, glow: 2 },
  },
  crest: {
    id: 'crest',
    name: 'Lightning Crown Crest',
    slot: 'crown',
    scaleMm: 36,
    stats: { speed: 2, spin: 2, torque: 0, glow: 1 },
  },
};

export function renderKidPresetToCanvas(presetId = 'sword') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  // Warm white sketchbook paper background (so corner flood-fill segments it authentically!)
  ctx.fillStyle = '#fcfaf5';
  ctx.fillRect(0, 0, 256, 256);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (presetId === 'sword') {
    // Bold kid-drawn hero blade + star crossguard
    ctx.fillStyle = '#2E6FDB';
    ctx.strokeStyle = '#20232A';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(128, 20);
    ctx.lineTo(156, 62);
    ctx.lineTo(150, 174);
    ctx.lineTo(106, 174);
    ctx.lineTo(100, 62);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Central bright cyan energy stripe
    ctx.strokeStyle = '#8ef0ff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(128, 42);
    ctx.lineTo(128, 162);
    ctx.stroke();

    // Coral & Gold crossguard + pommel
    ctx.fillStyle = '#FFB830';
    ctx.strokeStyle = '#20232A';
    ctx.lineWidth = 6;
    roundRect(ctx, 68, 170, 120, 26, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FF6B4A';
    roundRect(ctx, 112, 196, 32, 40, 10);
    ctx.fill();
    ctx.stroke();
    drawStar(ctx, 128, 183, 5, 14, 6, '#FF6B4A');
  } else if (presetId === 'wings') {
    // Single bold right-wing sketch (mirrored automatically into flapping Left + Right wings!)
    const grad = ctx.createLinearGradient(40, 40, 224, 210);
    grad.addColorStop(0, '#FF6B4A');
    grad.addColorStop(0.5, '#FFB830');
    grad.addColorStop(1, '#1FA6A0');
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#20232A';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(42, 140);
    ctx.bezierCurveTo(46, 56, 152, 24, 222, 48);
    ctx.bezierCurveTo(234, 88, 198, 126, 172, 134);
    ctx.bezierCurveTo(206, 154, 196, 206, 144, 220);
    ctx.bezierCurveTo(96, 228, 52, 192, 42, 140);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    drawStar(ctx, 148, 92, 5, 22, 10, '#ffffff');
    ctx.fillStyle = '#7C4DFF';
    ctx.beginPath();
    ctx.arc(132, 172, 16, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Lightning Crown Crest
    ctx.fillStyle = '#FFB830';
    ctx.strokeStyle = '#FF6B4A';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(148, 22);
    ctx.lineTo(72, 134);
    ctx.lineTo(126, 134);
    ctx.lineTo(96, 232);
    ctx.lineTo(188, 112);
    ctx.lineTo(134, 112);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  return c;
}

export function segmentForegroundMask(sourceCanvas, threshold = 38) {
  const W = 96, H = 96;
  const work = document.createElement('canvas');
  work.width = W;
  work.height = H;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(sourceCanvas, 0, 0, W, H);
  const img = wctx.getImageData(0, 0, W, H);
  const d = img.data;

  // Check if image already has a transparent background
  let transparentCount = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 128) transparentCount++;
  }

  const bg = new Uint8Array(W * H);
  if (transparentCount > W * H * 0.1) {
    for (let p = 0; p < W * H; p++) {
      if (d[p * 4 + 3] < 128) bg[p] = 1;
    }
  } else {
    // Sample average corner color (4 corners, 3x3 patches)
    let sr = 0, sg = 0, sb = 0, cnt = 0;
    for (const [cx, cy] of [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2]]) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const idx = ((cy + dy) * W + (cx + dx)) * 4;
          sr += d[idx]; sg += d[idx + 1]; sb += d[idx + 2];
          cnt++;
        }
      }
    }
    const br = sr / cnt, bgc = sg / cnt, bb = sb / cnt;
    const thrSq = (threshold * 1.95) ** 2;

    // Corner-seeded flood fill
    const queue = new Int32Array(W * H);
    let qHead = 0, qTail = 0;
    const seed = (x, y) => {
      const p = y * W + x;
      if (bg[p]) return;
      const idx = p * 4;
      const distSq = (d[idx] - br) ** 2 + (d[idx + 1] - bgc) ** 2 + (d[idx + 2] - bb) ** 2;
      if (distSq <= thrSq) {
        bg[p] = 1;
        queue[qTail++] = p;
      }
    };
    for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
    for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }

    while (qHead < qTail) {
      const p = queue[qHead++];
      const x = p % W, y = (p / W) | 0;
      if (x > 0) seed(x - 1, y);
      if (x < W - 1) seed(x + 1, y);
      if (y > 0) seed(x, y - 1);
      if (y < H - 1) seed(x, y + 1);
    }
  }

  // Foreground mask (with 1-px border margin so contour always closes cleanly!)
  const fg = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const p = y * W + x;
      if (!bg[p]) fg[p] = 1;
    }
  }

  // 1-pass 3x3 morphological closing to bridge thin gaps
  const closed = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) sum += fg[(y + dy) * W + (x + dx)];
      }
      closed[y * W + x] = sum >= 4 ? 1 : 0;
    }
  }

  // Keep largest connected foreground component
  const bestMask = keepLargestComponent(closed, W, H);

  // Build crisp cutout preview canvas
  const prev = document.createElement('canvas');
  prev.width = W;
  prev.height = H;
  const pctx = prev.getContext('2d');
  const outImg = pctx.createImageData(W, H);
  let fgCount = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (bestMask[p]) {
      outImg.data[i] = d[i];
      outImg.data[i + 1] = d[i + 1];
      outImg.data[i + 2] = d[i + 2];
      outImg.data[i + 3] = 255;
      fgCount++;
    } else {
      outImg.data[i] = 28;
      outImg.data[i + 1] = 34;
      outImg.data[i + 2] = 52;
      outImg.data[i + 3] = 34;
    }
  }
  pctx.putImageData(outImg, 0, 0);

  return { mask: bestMask, width: W, height: H, previewCanvas: prev, fgCount };
}

function keepLargestComponent(mask, W, H) {
  const vis = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  let best = [];
  for (let p = 0; p < W * H; p++) {
    if (!mask[p] || vis[p]) continue;
    let h = 0, t = 0;
    vis[p] = 1;
    q[t++] = p;
    const comp = [];
    while (h < t) {
      const cur = q[h++];
      comp.push(cur);
      const x = cur % W, y = (cur / W) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
          const np = ny * W + nx;
          if (mask[np] && !vis[np]) {
            vis[np] = 1;
            q[t++] = np;
          }
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  const out = new Uint8Array(W * H);
  for (const p of best) out[p] = 1;
  return out;
}

// Moore-Neighbor outer boundary trace -> Douglas-Peucker -> Chaikin smoothing
function traceBoundaryContour(mask, W, H) {
  let startX = -1, startY = -1;
  for (let y = 1; y < H - 1 && startX < 0; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (mask[y * W + x]) { startX = x; startY = y; break; }
    }
  }
  if (startX < 0) {
    // Fallback rounded circle if blank image
    const pts = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      pts.push([W / 2 + Math.cos(a) * 26, H / 2 + Math.sin(a) * 26]);
    }
    return pts;
  }

  // Clockwise 8-neighborhood offsets
  const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const contour = [[startX, startY]];
  let cx = startX, cy = startY, backDir = 0;
  for (let step = 0; step < W * H * 2; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const dIdx = (backDir + 1 + k) % 8;
      const nx = cx + dirs[dIdx][0];
      const ny = cy + dirs[dIdx][1];
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && mask[ny * W + nx]) {
        cx = nx; cy = ny;
        backDir = (dIdx + 4) % 8;
        found = true;
        break;
      }
    }
    if (!found || (cx === startX && cy === startY && contour.length > 4)) break;
    contour.push([cx, cy]);
  }
  return contour;
}

function simplifyDP(pts, eps) {
  if (pts.length <= 4) return pts;
  let maxDist = 0, idx = 0;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    let t = lenSq > 1e-6 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const dist = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    if (dist > maxDist) { maxDist = dist; idx = i; }
  }
  if (maxDist > eps) {
    const left = simplifyDP(pts.slice(0, idx + 1), eps);
    const right = simplifyDP(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

function chaikinClosed(pts, passes = 1) {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const next = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    cur = next;
  }
  return cur;
}

export async function trySamScanEndpoint(sourceCanvas) {
  try {
    const dataUrl = sourceCanvas.toDataURL('image/png');
    const resp = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (!resp.ok) return { ok: false, message: `/api/scan returned ${resp.status} — using instant local cutout` };
    const json = await resp.json();
    return { ok: true, data: json, message: 'Segmented with SAM 3.1!' };
  } catch {
    return { ok: false, message: 'SAM /api/scan offline in static viewer — using <15 ms local cutout' };
  }
}

export function buildPhotoAccessoryMesh(THREE, sourceCanvas, seg, opts = {}) {
  const {
    slot = 'hand',
    thicknessMm = 5.0,
    scaleMm = 54.0,
    rimColor = '#ff6b4a',
    stats = { speed: 1, spin: 1, torque: 1, glow: 1 },
  } = opts;

  const { mask, width: W, height: H } = seg;
  const rawLoop = traceBoundaryContour(mask, W, H);
  const halfIdx = Math.floor(rawLoop.length / 2);
  const simplified = simplifyDP(rawLoop.slice(0, halfIdx + 1), 1.45)
    .slice(0, -1)
    .concat(simplifyDP(rawLoop.slice(halfIdx).concat([rawLoop[0]]), 1.45).slice(0, -1));
  const smoothPx = chaikinClosed(simplified.length >= 4 ? simplified : rawLoop, 1);

  // Bounding box in mask pixel space -> map to physical mm AND exact [0..1] image UVs!
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const [px, py] of smoothPx) {
    if (px < xMin) xMin = px;
    if (px > xMax) xMax = px;
    if (py < yMin) yMin = py;
    if (py > yMax) yMax = py;
  }
  const spanPx = Math.max(8, Math.max(xMax - xMin, yMax - yMin));
  const mmPerPx = scaleMm / spanPx;
  const cxPx = 0.5 * (xMin + xMax);

  // Build THREE.Shape in (x_mm, y_mm) with bottom of silhouette at y_mm = 0!
  const shape = new THREE.Shape();
  smoothPx.forEach(([px, py], idx) => {
    const xm = (px - cxPx) * mmPerPx;
    const ym = (yMax - py) * mmPerPx;
    if (idx === 0) shape.moveTo(xm, ym);
    else shape.lineTo(xm, ym);
  });
  shape.closePath();

  const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
    depth: thicknessMm,
    bevelEnabled: true,
    bevelThickness: 0.85,
    bevelSize: 0.75,
    bevelSegments: 2,
    curveSegments: 2,
  });
  extrudeGeo.translate(0, 0, -thicknessMm * 0.5);
  extrudeGeo.computeVertexNormals();

  // Map planar UVs directly back to `sourceCanvas` [0..1] so front & back show crisp photo art!
  const posAttr = extrudeGeo.attributes.position;
  const uvAttr = extrudeGeo.attributes.uv;
  for (let i = 0; i < posAttr.count; i++) {
    const xm = posAttr.getX(i);
    const ym = posAttr.getY(i);
    const px = xm / mmPerPx + cxPx;
    const py = yMax - ym / mmPerPx;
    uvAttr.setXY(i, Math.max(0, Math.min(1, px / W)), Math.max(0, Math.min(1, 1 - py / H)));
  }
  uvAttr.needsUpdate = true;

  const tex = new THREE.CanvasTexture(sourceCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const faceMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.42,
    metalness: 0.02,
  });
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: rimColor,
    roughness: 0.34,
    clearcoat: 0.42,
  });

  const root = new THREE.Group();
  const triCount = Math.round(posAttr.count / 3);

  if (slot === 'wings') {
    // Double flapping back wings mounted on a Coral Spark 2x2 hub!
    const hub = new THREE.Mesh(new THREE.BoxGeometry(22, 16, 5), rimMat);
    hub.castShadow = true;
    root.add(hub);

    const leftPivot = new THREE.Group();
    leftPivot.position.set(8, 2, -2);
    const leftMesh = new THREE.Mesh(extrudeGeo, [faceMat, rimMat]);
    leftMesh.castShadow = true;
    leftMesh.position.set(scaleMm * 0.36, -scaleMm * 0.32, 0);
    leftPivot.add(leftMesh);

    const rightPivot = new THREE.Group();
    rightPivot.position.set(-8, 2, -2);
    const rightMesh = new THREE.Mesh(extrudeGeo, [faceMat, rimMat]);
    rightMesh.castShadow = true;
    rightMesh.scale.x = -1;
    rightMesh.position.set(-scaleMm * 0.36, -scaleMm * 0.32, 0);
    rightPivot.add(rightMesh);

    root.add(leftPivot, rightPivot);
    root.userData = { digitalOnly: true, prints: false, slot, stats, triCount: triCount * 2, leftPivot, rightPivot };
    return root;
  }

  const bodyMesh = new THREE.Mesh(extrudeGeo, [faceMat, rimMat]);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;

  if (slot === 'hand') {
    // Visual Ø 6.60 mm Coral Spark handle along +X (matching Kip's rightHandCgripParent!)
    const grip = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 28, 20), rimMat);
    handle.castShadow = true;
    handle.position.y = 12;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 4, 20), rimMat);
    collar.position.y = 25;
    bodyMesh.position.y = 26;
    grip.add(handle, collar, bodyMesh);
    // Align +Y blade along Kip's hand grip +X axis!
    grip.rotation.z = -Math.PI / 2;
    grip.position.set(-12, -11.4, 2.3);
    root.add(grip);
  } else if (slot === 'crown') {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(23.6, 5.0, 11.6), rimMat);
    pad.position.y = 2.5;
    pad.castShadow = true;
    bodyMesh.position.y = 4.2;
    root.add(pad, bodyMesh);
  } else if (slot === 'hood') {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(23.6, 5.5, 23.6), rimMat);
    pad.position.y = 2.75;
    pad.castShadow = true;
    bodyMesh.position.y = 4.8;
    root.add(pad, bodyMesh);
  }

  root.userData = { digitalOnly: true, prints: false, slot, stats, triCount };
  return root;
}

export function encodeToyContractHash(state) {
  const payload = {
    format: 'toyventor.toy/1',
    id: `kip-${state.head || 'classic'}`,
    name: state.name || 'Kip Custom Loadout',
    kind: state.vehicle && state.vehicle !== 'none' ? 'vehicle' : 'figure',
    prints: !state.hasPhotoAccessory,
    col: { c1: '#f4efe6', c2: '#ff6b4a' },
    parts: state.parts || [],
    stats: state.stats || { speed: 2, spin: 2, torque: 2, glow: 2 },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `#toy=${b64}`;
}
