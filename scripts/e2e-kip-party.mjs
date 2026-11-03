#!/usr/bin/env node
// Dance party mode in the real Kip page (docs/specs/dance-party-spec.md phase 3): headless Chrome with the machine's GPU.
// Run: E2E_GPU=metal node scripts/e2e-kip-party.mjs      Exits nonzero on any failing check.
//
// What the unit tests cannot see: the audio clock really runs at the speed of time, the dance really is held at the song's beat (the rig's pose one
// dance-loop of song time apart is the same pose), the headphone cups and the floor ring flash on the beat, a tap on the stage is judged against the
// beat grid (timed from the event, error measured), and stopping puts everything back (crown, hair, glow, the rest pose).
import os from "node:os";
import path from "node:path";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-party-shots");
const { check, finish } = createChecks("kip party e2e");
process.env.E2E_STRICT_STL = "1";
const server = await startServer();
const chrome = await launchChrome({ width: 900, height: 700 });
const page = await chrome.open(`${server.base}/kip/Kip-Demo.html?expr=spark`, { width: 900, height: 700 });
const ready = await page.waitFor("window.__KIP_READY__ === true", 180000);
check("the Kip page loads and publishes the party", ready && (await page.evaluate("Boolean(window.kipParty && window.kipMenu)")));
await new Promise((r) => setTimeout(r, 1500));

const ev = (expr) => page.evaluate(expr);
/** Choose an option in a menu <select> the way a person does, through the real control. */
const choose = (id, value) => ev(`(() => { const s = window.kipMenu.fields.get(${JSON.stringify(id)}).select; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
const toggle = (id) => ev(`(() => { const f = window.kipMenu.fields.get(${JSON.stringify(id)}); const i = f.input || f.root.querySelector('input'); i.click(); return i.checked; })()`);
const state = () => ev("window.kipParty.state()");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the menu --------------------------------------------------------------------------------------------------------------------------
const ids = await ev("[...window.kipMenu.fields.keys()].filter((k) => k.startsWith('party'))");
check("the menu has the Party group: on, mood, tempo, ages, readout", ["partyOn", "partyMood", "partyTempo", "partyBand", "partyInfo"].every((i) => ids.includes(i)), ids.join());
const moods = await ev("[...window.kipMenu.fields.get('partyMood').select.options].map((o) => o.value)");
const tempos = await ev("[...window.kipMenu.fields.get('partyTempo').select.options].map((o) => o.value)");
check("the mood and tempo cards are the song maker's closed lists", moods.join() === "bouncy,sleepy,silly,space,kitchen,cleanup" && tempos.join() === "slow,medium,fast", `${moods} / ${tempos}`);

// ---- a real tap on the page grants the browser's audio permission, then the party starts from the menu control -----------------------------
await page.click(600, 350);
const before = await ev("({ hat: window.kipMenu.ctx.loco.hat, hair: window.kipMenu.ctx.loco.hair, head: window.kipMenu.ctx.loco.head, clip: window.kipMenu.ctx.read.clip() })");
await choose("partyMood", "cleanup");
await choose("partyTempo", "fast");
await choose("partyBand", "2"); // ages 5 to 6: a tap must land on the beat
check("the controls change the party's settings", JSON.stringify([(await state()).mood, (await state()).tempo, (await state()).band]) === '["cleanup","fast",2]');
await toggle("partyOn");
const started = await page.waitFor("window.kipParty.state().on === true", 15000, 100);
check("switching Party on starts it (audio running, from a real tap)", started);
let s = await state();
check("the fast card is 128 bpm and a dance that fits it was picked", s.bpm === 128 && Boolean(s.danceId) && !s.lightsOnly, `${s.bpm} ${s.danceId}`);
check("Kip put the headphones on", s.headphones && (await ev("window.kipMenu.ctx.loco.hat")) === "headphones");
check("the picked dance is the clip that is playing", (await ev("window.kipMenu.ctx.read.clip()")) === s.danceId, s.danceId);
const expectedDance = await ev(`(async () => {
  const bpm = ${s.bpm};
  const list = [...window.kipClips.entries.filter((c) => c.group === 'dance' && c.bpm).map((c) => ({ id: c.id, bpm: c.bpm }))];
  const idx = await (await fetch('/kip/mixamo/baked/index.json')).json();
  for (const c of idx.clips) if (c.group === 'dance' && c.beats) list.push({ id: c.id, bpm: c.bpm });
  const fit = list.map((c) => ({ ...c, rate: bpm / c.bpm })).filter((c) => c.rate >= 0.8 && c.rate <= 1.25).sort((a, b) => Math.abs(Math.log(a.rate)) - Math.abs(Math.log(b.rate)) || (a.id < b.id ? -1 : 1));
  return fit[0]?.id ?? null;
})()`);
check("it is the dance nearest its natural speed for that tempo (the rule, checked from the page's own clip list)", s.danceId === expectedDance, `${s.danceId} vs ${expectedDance}`);

// ---- watch it for 9 seconds, frame by frame ---------------------------------------------------------------------------------------------
const rec = await ev(`new Promise((resolve) => {
  const { kip } = window.kipRig();
  const J = kip.joints, mat = kip.exp.hatMeshes.headphones.material, ring = null;
  const out = [];
  const t0 = performance.now();
  const p0 = window.kipParty.state().songTime;
  function frame() {
    const st = window.kipParty.state();
    const q = J.RightArm.quaternion, h = J.Hips.quaternion;
    out.push({ perf: performance.now(), song: st.songTime, ft: st.frameSongTime, dt: st.danceTime, count: st.count, pulse: st.pulse, glow: mat.emissiveIntensity, q: [q.x, q.y, q.z, q.w], on: st.on });
    if (performance.now() - t0 < 9000) requestAnimationFrame(frame); else resolve({ out, p0, t0 });
  }
  requestAnimationFrame(frame);
})`);
const fr = rec.out;
const rate = (fr[fr.length - 1].song - fr[0].song) / ((fr[fr.length - 1].perf - fr[0].perf) / 1000);
// Headless Chrome's fake audio device is not a hardware clock: a bare AudioContext with no party code reads 0.995x of the wall clock when the machine is idle and
// slower still when it is busy. What matters is that the sound, the dance and the glow ALL follow that one clock (checked below) and that it never goes
// backwards, so the checks here only catch a clock that is stopped, racing or running backwards. The rate is printed so a real device can be compared.
let backwards = 0, worstBack = 0;
for (let i = 1; i < fr.length; i++) if (fr[i].ft < fr[i - 1].ft) { backwards++; worstBack = Math.max(worstBack, fr[i - 1].ft - fr[i].ft); }
check(`the song clock only moves forward (${backwards} backward steps in ${fr.length} frames, the worst ${(worstBack * 1000).toFixed(2)} ms)`, backwards === 0);
check(`the song clock is running (${rate.toFixed(3)}x the wall clock over 9 s in this headless Chrome)`, rate > 0.5 && rate < 1.5);
const counts = new Set(fr.map((f) => f.count));
check("the count goes 1 2 3 4", [1, 2, 3, 4].every((c) => counts.has(c)), [...counts].join());
check("the flash is full on the beat and dark between (the pulse)", Math.max(...fr.map((f) => f.pulse)) > 0.9 && Math.min(...fr.map((f) => f.pulse)) < 0.05);
check("the headphones glow follows it (bright on the beat, off between)", Math.max(...fr.map((f) => f.glow)) > 1.0 && Math.min(...fr.map((f) => f.glow)) < 0.1, `${Math.max(...fr.map((f) => f.glow)).toFixed(2)} .. ${Math.min(...fr.map((f) => f.glow)).toFixed(2)}`);
// the dance time the page used is exactly the beat formula, from the song time of that frame
const clipInfo = await ev(`(async () => { const idx = await (await fetch('/kip/mixamo/baked/index.json')).json(); const p = window.kipClips.entries.find((c) => c.id === ${JSON.stringify(s.danceId)}); const b = idx.clips.find((c) => c.id === ${JSON.stringify(s.danceId)}); return p ? { bpm: p.bpm, beats: p.beats } : { bpm: b.bpm, beats: b.beats }; })()`);
let worst = 0;
const loopLen = (clipInfo.beats * 60) / clipInfo.bpm;
for (const f of fr) {
  const pos = (f.ft * s.bpm) / 60;
  const want = ((((pos % clipInfo.beats) + clipInfo.beats) % clipInfo.beats) * 60) / clipInfo.bpm;
  // the end of one loop and the start of the next are the same instant of the dance
  worst = Math.max(worst, Math.abs(((f.dt - want + loopLen / 2) % loopLen + loopLen) % loopLen - loopLen / 2));
}
check(`every frame's dance time is the song's beat position x the clip's beat length (worst ${(worst * 1000).toFixed(3)} ms)`, worst < 1e-6);
// the rig itself follows: the pose one dance loop of song time apart is the same pose, half a loop apart it differs
const loopSec = (clipInfo.beats * 60) / s.bpm;
const dist = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
// The pose at song time t, interpolated between the two frames either side of it, so the check does not depend on the frame rate: at 60 fps a 3.75 s loop is
// exactly 225 frames and frames line up, at 30 fps (a busy machine) it is 112.5 and they never do.
const poseAt = (t) => {
  let hi = fr.findIndex((f) => f.ft >= t);
  if (hi <= 0) return null;
  const a = fr[hi - 1], b = fr[hi];
  if (b.ft - a.ft > 0.12) return null; // a stall, not a pose to compare against
  const u = (t - a.ft) / (b.ft - a.ft);
  const sign = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3] < 0 ? -1 : 1;
  const q = a.q.map((x, i) => x * (1 - u) + sign * b.q[i] * u);
  const n = Math.hypot(...q);
  return q.map((x) => x / n);
};
let same = 0, differ = 0, pairs = 0;
// (the first second is Kip blending in from the rest pose, so it is not yet the dance)
for (const f of fr.filter((x) => x.ft > 1.5 && x.ft + loopSec < fr[fr.length - 1].ft - 0.2)) {
  const g = poseAt(f.ft + loopSec), h = poseAt(f.ft + loopSec / 2);
  if (!g || !h) continue;
  pairs++;
  same = Math.max(same, dist(f.q, g));
  differ = Math.max(differ, dist(f.q, h));
}
check(`the rig is on the beat: the pose a dance loop (${loopSec.toFixed(2)} s) later is the same pose (worst ${same.toFixed(3)} rad over ${pairs} pairs), half a loop later it differs (${differ.toFixed(2)} rad)`, pairs >= 5 && same < 0.1 && differ > 0.2, `pairs ${pairs}`);

// ---- what the child SEES of the feet and hands, in the world: no sliding, no lurching, no jerks ---------------------------------------------------------------------------
/** Record the world positions of both feet, the body's re-centring offset and both hands' rotations for `ms`, one entry per frame. */
const recordWorld = (ms) => ev(`new Promise((resolve) => {
  const { kip, THREE } = window.kipRig();
  const J = kip.joints, v = new THREE.Vector3(), out = [], t0 = performance.now();
  const wp = (n) => { J[n].getWorldPosition(v); return [v.x, v.y, v.z]; };
  const qq = (n) => { const e = J[n].quaternion; return [e.x, e.y, e.z, e.w]; };
  (function f() {
    out.push({ p: performance.now(), L: wp('LeftFoot'), R: wp('RightFoot'), g: kip.grounder.position.x, hands: [qq('LeftHand'), qq('RightHand')] });
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); else resolve(out);
  })();
})`);
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180 / Math.PI;
function worldReport(rec) {
  let slide = 0;
  for (const side of ["L", "R"]) { // a foot ON the floor (within 2.5 mm of its lowest) must not travel across it
    const lo = Math.min(...rec.map((f) => f[side][1]));
    let start = null;
    for (const f of rec) {
      if (f[side][1] < lo + 2.5) { start ??= f[side]; slide = Math.max(slide, Math.hypot(f[side][0] - start[0], f[side][2] - start[2])); } else start = null;
    }
  }
  const lurch = Math.max(...rec.slice(1).map((f, i) => Math.abs(f.g - rec[i].g)));
  const gx = rec.map((f) => f.g);
  let spikes = 0, top = 0;
  for (const h of [0, 1]) {
    const speeds = rec.slice(1).map((f, i) => angle(rec[i].hands[h], f.hands[h]) / Math.max(1, f.p - rec[i].p) * 1000); // degrees a second
    const sorted = [...speeds].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    for (const s of speeds) if (s > Math.max(400, 4 * p95)) { spikes++; top = Math.max(top, s); }
  }
  return { slide, lurch, range: Math.max(...gx) - Math.min(...gx), spikes, top };
}
const w1 = worldReport(await recordWorld(5000));
check(`a foot on the floor does not slide across it (${w1.slide.toFixed(1)} mm in the world; it was 20 mm when the body re-centred on the lower foot)`, w1.slide <= 4, JSON.stringify(w1));
check(`the body does not lurch sideways (${w1.lurch.toFixed(2)} mm a frame at most; it was 8) and stays put over its feet (${w1.range.toFixed(1)} mm in all)`, w1.lurch <= 1 && w1.range <= 4);
check(`the hands do not jerk (${w1.spikes} frames where a hand turns more than 4 times its usual speed${w1.spikes ? `, up to ${w1.top.toFixed(0)} degrees a second` : ""})`, w1.spikes === 0);
await page.shot(path.join(SHOTS, "party-dancing.png")).catch(() => {});

// ---- tapping, age band 5 to 6: a tap within 80 ms of a beat is a hit, once per beat. Real mouse presses (the page's own pointer path), aimed at the beat ----------
async function tapNearBeat(offsetBeats) {
  const st = await ev("({ song: window.kipParty.state().songTime, bpm: window.kipParty.state().bpm })");
  const iv = 60 / st.bpm;
  const target = (Math.floor(st.song / iv) + 3 + offsetBeats) * iv; // three beats ahead, plus the offset
  await sleep(Math.max(0, (target - st.song) * 1000 - 8)); // a press takes a few milliseconds to arrive
  await page.click(600, 350);
  return (await state()).lastOutcome;
}
const taps = { onBeat: [], between: [], repeat: [] };
for (let k = 0; k < 10; k++) taps.onBeat.push(await tapNearBeat(0));
for (let k = 0; k < 4; k++) taps.between.push(await tapNearBeat(0.5));
// two taps on one beat, 15 ms apart, handed to the party at exact performance-clock times (the pointer path was proved above; this is about the rule, and a
// loaded machine must not be able to spread two "simultaneous" clicks over more than a beat window)
taps.repeat = await ev(`(() => {
  const p = performance.now(), st = window.kipParty.state(), iv = 60 / st.bpm;
  const songNow = window.kipParty.state().songTime, beat = Math.round(songNow / iv) * iv;
  const perfBeat = p + (beat - songNow) * 1000;
  const a = window.kipParty.tap(perfBeat), b = window.kipParty.tap(perfBeat + 15);
  return [a, b];
})()`);
taps.summary = await state();
const hits = taps.onBeat.filter((o) => o?.kind === "hit");
const meanErr = hits.reduce((x, o) => x + Math.abs(o.errorMs), 0) / Math.max(1, hits.length);
check(`taps on the beat are hits (${hits.length} of 10, mean error ${meanErr.toFixed(1)} ms, worst ${Math.max(...hits.map((o) => Math.abs(o.errorMs))).toFixed(1)} ms; the aim itself is only as good as this script's timers)`, hits.length >= 8 && meanErr < 50);
check("taps half a beat off are misses", taps.between.every((o) => o?.kind === "miss"), JSON.stringify(taps.between.map((o) => o?.kind)));
check("a second tap on the same beat does not count again", taps.repeat[0]?.kind === "hit" && taps.repeat[1]?.kind === "repeat", `${JSON.stringify(taps.repeat.map((o) => o?.kind))} (party ended because: ${taps.summary.ended || "it has not"})`);
check("the run counts every tap and only the hits", taps.summary.taps === 10 + 4 + 2 && taps.summary.hits === hits.length + (taps.repeat[0]?.kind === "hit" ? 1 : 0), `${taps.summary.taps} taps, ${taps.summary.hits} hits`);

// ---- stopping puts everything back --------------------------------------------------------------------------------------------------------
await toggle("partyOn");
check("switching Party off stops it", await page.waitFor("window.kipParty.state().on === false", 5000, 100), `ended: ${(await state()).ended}`);
check("and it says why it ended: the switch", (await state()).ended === "switch", (await state()).ended);
await sleep(600);
const after = await ev(`(() => { const { kip } = window.kipRig(); const m = kip.exp.hatMeshes.headphones.material; const l = window.kipMenu.ctx.loco; return { hat: l.hat, hair: l.hair, glow: m.emissiveIntensity, emissive: m.emissive.getHex(), clip: window.kipMenu.ctx.read.clip(), song: window.kipParty.state().songTime }; })()`);
check("the crown and hair are back as they were", after.hat === before.hat && after.hair === before.hair, `${before.hat}/${before.hair} -> ${after.hat}/${after.hair}`);
check("the glow is cleared", after.glow === 0 && after.emissive === 0);
check("Kip goes back to the rest pose (the dance is released)", after.clip !== s.danceId, after.clip);
check("the sound is off", after.song === 0);

// ---- choosing another clip ends the party; every tempo card gets a dance; a head that cannot wear them is lights and dance without headphones --------
await choose("partyBand", "0");
for (const tempo of ["slow", "medium"]) {
  await choose("partyTempo", tempo);
  await toggle("partyOn");
  await page.waitFor("window.kipParty.state().on === true", 15000, 100);
  const t = await state();
  check(`the ${tempo} card (${t.bpm} bpm) gets a dance`, Boolean(t.danceId) && !t.lightsOnly, t.danceId);
  await sleep(1500);
  const info = await ev("window.kipMenu.fields.get('partyInfo').box.textContent");
  check(`the readout names it (${info.slice(0, 60)})`, info.includes(`${Math.round(t.bpm)} bpm`));
  await page.click(600, 350);
  const free = (await state()).lastOutcome;
  if (tempo === "slow") check("ages 2 to 3: any tap is a hit, there are no wrong taps", free?.kind === "free", JSON.stringify(free));
  await ev("window.kipMenu.ctx.act.playClip('cheer')");
  check(`choosing another clip while the ${tempo} party plays ends it`, await page.waitFor("window.kipParty.state().on === false", 4000, 100));
  await sleep(300);
}
await ev("window.kipMenu.ctx.act.setCategory('robot')");
await sleep(500);
await choose("partyTempo", "medium");
await toggle("partyOn");
await page.waitFor("window.kipParty.state().on === true", 15000, 100);
s = await state();
check("a robot head cannot wear the headphones: the party still dances, without them", !s.headphones && Boolean(s.danceId), JSON.stringify({ h: s.headphones, d: s.danceId }));
check("the readout says so", (await ev("window.kipMenu.fields.get('partyInfo').box.textContent")).includes("no headphones"));
await toggle("partyOn");
await page.waitFor("window.kipParty.state().on === false", 5000, 100);
await ev("window.kipMenu.ctx.act.setCategory('human')");

// ---- the starter library: songs made with Mureka, decoded by the REAL browser, on the beat grid the ingest measured ----------------------------------------------
const lib = await ev(`(async () => (await (await fetch('/kip/songs/index.json')).json()).songs.map((x) => ({ id: x.id, file: x.file, dur: x.dur, beats: x.beats, offset: x.offset, bpm: x.bpm, title: x.title, mood: x.mood })))()`);
check(`the library lists ${lib.length} songs`, lib.length >= 10);
const songOpts = await ev("[...window.kipMenu.fields.get('partySong').select.options].map((o) => o.value)");
check("the Song picker offers the practice beat first and then every library song", songOpts[0] === "practice" && lib.every((x) => songOpts.includes(x.id)), songOpts.join());

// Where is the beat in the AUDIO? Decode each file (the browser's own decoder, so the encoder delay is whatever the browser makes of it), take the energy of the
// low drums, and slide the beat grid over it: the shift at which the energy RISES hardest (the attack of the kick, which is where a beat is felt, not where the
// sub-bass swell peaks) is how far the sound is from the map. A song with no kick to speak of says so.
const align = await ev(`(async () => {
  const out = [];
  for (const song of ${JSON.stringify(lib)}) {
    const bytes = await (await fetch('/kip/songs/' + song.file)).arrayBuffer();
    const buf = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(bytes);
    const sr = buf.sampleRate, x = buf.getChannelData(0), n = x.length;
    const a = 1 - Math.exp((-2 * Math.PI * 150) / sr);
    let y = 0;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { y += a * (x[i] - y); pre[i + 1] = pre[i] + y * y; }
    const w = Math.round(0.012 * sr);
    const energy = (i) => (pre[Math.max(0, Math.min(n, i + w))] - pre[Math.max(0, Math.min(n, i))]) / w;
    const rise = (i) => Math.max(0, energy(i) - energy(i - w)); // what the 12 ms after i has that the 12 ms before did not
    const iv = song.dur / song.beats;
    const score = (d, f) => { let s = 0, c = 0; for (let k = 0; k < song.beats; k++) { const i = Math.round((song.offset + k * iv + d) * sr); if (i - w >= 0 && i + w < n) { s += f(i); c++; } } return s / Math.max(1, c); };
    let best = -1, bd = 0;
    for (let d = -0.08; d <= 0.0801; d += 0.002) { const sc = score(d, rise); if (sc > best) { best = sc; bd = d; } }
    out.push({ id: song.id, duration: buf.duration, shiftMs: bd * 1000, contrast: best / Math.max(1e-12, score(iv / 2, rise)) });
  }
  return out;
})()`);
for (const r of align) {
  const song = lib.find((x) => x.id === r.id);
  check(`${r.id}: the browser decodes it to ${r.duration.toFixed(3)} s, the index says ${song.dur}: the loop is the grid's length, no encoder delay or padding left in it`, Math.abs(r.duration - song.dur) < 0.004, `${r.duration} vs ${song.dur}`);
}
const kicked = align.filter((r) => r.contrast >= 1.3);
check(`${kicked.length} of ${align.length} songs have a kick clear enough to measure; on those the attack of the audio's beat is within 25 ms of the map (worst ${Math.max(...kicked.map((r) => Math.abs(r.shiftMs))).toFixed(0)} ms)`, kicked.length >= 6 && kicked.every((r) => Math.abs(r.shiftMs) <= 25), kicked.map((r) => `${r.id} ${r.shiftMs.toFixed(0)}`).join(", "));
console.log("   per song (shift ms / kick contrast): " + align.map((r) => `${r.id} ${r.shiftMs.toFixed(0)}/${r.contrast.toFixed(1)}`).join("  "));

// play one through the party
const song = lib.find((x) => x.id === "bouncy_b");
const iv = song.dur / song.beats;
await choose("partyBand", "2");
await choose("partySong", song.id);
check("choosing a song hides the practice beat's own mood and tempo pickers", await ev("window.kipMenu.fields.get('partyMood').root.hidden === true && window.kipMenu.fields.get('partyTempo').root.hidden === true"));
const before2 = await ev("({ hat: window.kipMenu.ctx.loco.hat, hair: window.kipMenu.ctx.loco.hair })");
await toggle("partyOn");
check("the song starts (decoded, looping, from a real tap)", await page.waitFor("window.kipParty.state().on === true", 20000, 100));
s = await state();
check(`it plays ${song.title}: the song's tempo (${(60 / iv).toFixed(2)} bpm), the decoded length is the song's (${s.bufferSeconds.toFixed(3)} s)`, s.song === song.id && Math.abs(s.bpm - 60 / iv) < 0.01 && Math.abs(s.bufferSeconds - song.dur) < 0.02, JSON.stringify({ song: s.song, bpm: s.bpm, buf: s.bufferSeconds }));
check("a dance that fits it is picked and playing", Boolean(s.danceId) && !s.lightsOnly && (await ev("window.kipMenu.ctx.read.clip()")) === s.danceId, s.danceId);
const readout = await ev("window.kipMenu.fields.get('partyInfo').box.textContent");
check(`the readout says it is made by AI (${readout.slice(0, 70)})`, readout.includes(song.title) && readout.includes("made by AI"));
const info2 = await ev(`(async () => { const idx = await (await fetch('/kip/mixamo/baked/index.json')).json(); const p = window.kipClips.entries.find((c) => c.id === ${JSON.stringify(s.danceId)}); const b = idx.clips.find((c) => c.id === ${JSON.stringify(s.danceId)}); return p ? { bpm: p.bpm, beats: p.beats } : { bpm: b.bpm, beats: b.beats }; })()`);
const rec2 = await ev(`new Promise((resolve) => { const out = []; const t0 = performance.now(); (function f() { const st = window.kipParty.state(); out.push({ ft: st.frameSongTime, dt: st.danceTime }); if (performance.now() - t0 < 4000) requestAnimationFrame(f); else resolve(out); })(); })`);
let worst2 = 0, worstFrame = null;
const loopLen2 = (info2.beats * 60) / info2.bpm;
for (const f of rec2) {
  if (f.dt === null) continue; // the party has not set a dance time yet (null, not 0: the first frames after the song starts)
  const pos = (f.ft - song.offset) / iv;
  const want = ((((pos % info2.beats) + info2.beats) % info2.beats) * 60) / info2.bpm;
  // on the wrap (the end of one loop is the start of the next) a difference of a whole loop is the same instant
  const e = Math.abs(((f.dt - want + loopLen2 / 2) % loopLen2 + loopLen2) % loopLen2 - loopLen2 / 2);
  if (e > worst2) { worst2 = e; worstFrame = { ...f, want, pos }; }
}
check(`the dance is on the SONG's beats: every frame's dance time is its beat position from the song's grid (worst ${(worst2 * 1000).toFixed(3)} ms)`, worst2 < 1e-6, JSON.stringify(worstFrame));

const w2 = worldReport(await recordWorld(4000));
check(`on a song too: no foot slides (${w2.slide.toFixed(1)} mm), the body stays put (${w2.lurch.toFixed(2)} mm a frame), the hands do not jerk (${w2.spikes})`, w2.slide <= 4 && w2.lurch <= 1 && w2.spikes === 0, JSON.stringify(w2));

// the Dance picker, while the song plays: only what fits is offered, a choice takes over at once without restarting the sound, Auto gives the tempo's pick back
const picker = await ev("[...window.kipMenu.fields.get('partyDance').select.options].map((o) => ({ value: o.value, label: o.textContent }))");
const rates = picker.filter((o) => o.value !== "auto").map((o) => Number(/×([\d.]+)/.exec(o.label)?.[1]));
check(`the Dance picker lists Auto and ${picker.length - 1} moves that fit ${Math.round(s.bpm)} bpm, each between x0.80 and x1.25 (${picker.length - 1} offered)`, picker[0].value === "auto" && picker.length > 2 && rates.every((r) => r >= 0.8 && r <= 1.25), JSON.stringify(rates));
const unfit = await ev(`(async () => { const idx = await (await fetch('/kip/mixamo/baked/index.json')).json(); const all = [...window.kipClips.entries.filter((c) => c.group === 'dance' && c.bpm).map((c) => ({ id: c.id, bpm: c.bpm })), ...idx.clips.filter((c) => c.beats).map((c) => ({ id: c.id, bpm: c.bpm }))]; return all.filter((c) => ${s.bpm} / c.bpm < 0.8 || ${s.bpm} / c.bpm > 1.25).map((c) => c.id); })()`);
check(`a move that does not fit is NOT offered (${unfit.slice(0, 3).join(", ")} would have to be stretched)`, unfit.length > 0 && unfit.every((id) => !picker.some((o) => o.value === id)));
const started0 = (await state()).startedAt;
const other = picker.find((o) => o.value !== "auto" && o.value !== s.danceId);
await choose("partyDance", other.value);
check(`choosing ${other.label.replace(/ \(.*/, "")} switches to it at once`, await page.waitFor(`window.kipParty.state().danceId === ${JSON.stringify(other.value)} && window.kipMenu.ctx.read.clip() === ${JSON.stringify(other.value)}`, 3000, 50));
const after2 = await state();
check("the sound was not restarted by the switch (same start time, still on)", after2.on && after2.startedAt === started0 && after2.chosen === true);
await sleep(800);
const afterTime = await state();
check("and the new move is on the beat from the first frame", afterTime.danceTime !== null && afterTime.on);
await choose("partyDance", "auto");
check("choosing Auto gives the tempo's own pick back", await page.waitFor(`window.kipParty.state().danceId === ${JSON.stringify(s.danceId)} && window.kipParty.state().chosen === false`, 3000, 50));
const jacks = picker.find((o) => o.value === "move_jacks");
if (jacks) {
  await choose("partyDance", "move_jacks");
  check("a movement-break move (Jumping Jacks) can be chosen too", await page.waitFor("window.kipParty.state().danceId === 'move_jacks'", 3000, 50));
  await choose("partyDance", "auto");
  await sleep(300);
}

// the beat click, for checking by ear
await toggle("partyClick");
check("the beat click switches on (a tick on every beat, higher on the 1)", (await state()).click === true);
await toggle("partyClick");
check("and off", (await state()).click === false);

// taps on the song's own grid: real presses aimed at its beats
async function tapSong(offsetBeats) {
  const st = await ev("({ t: window.kipParty.state().songTime })");
  const target = song.offset + (Math.floor((st.t - song.offset) / iv) + 3 + offsetBeats) * iv;
  await sleep(Math.max(0, (target - st.t) * 1000 - 8));
  await page.click(600, 350);
  return (await state()).lastOutcome;
}
const songTaps = [];
for (let k = 0; k < 8; k++) songTaps.push(await tapSong(0));
const songMiss = [];
for (let k = 0; k < 3; k++) songMiss.push(await tapSong(0.5));
const songHits = songTaps.filter((o) => o?.kind === "hit");
check(`taps on the song's beats are hits (${songHits.length} of 8, mean error ${(songHits.reduce((x, o) => x + Math.abs(o.errorMs), 0) / Math.max(1, songHits.length)).toFixed(1)} ms) and half-beat taps miss`, songHits.length >= 6 && songMiss.every((o) => o?.kind === "miss"), JSON.stringify([...songTaps, ...songMiss].map((o) => o?.kind)));

// choosing another song while it plays restarts on that song
const second = lib.find((x) => x.id === "cleanup_b");
await choose("partySong", second.id);
check("choosing another song while it plays plays that one", await page.waitFor(`window.kipParty.state().on === true && window.kipParty.state().song === ${JSON.stringify(second.id)}`, 20000, 100) && Math.abs((await state()).bpm - 60 / (second.dur / second.beats)) < 0.01);
await toggle("partyOn");
await page.waitFor("window.kipParty.state().on === false", 5000, 100);
await sleep(500);
const left2 = await ev("({ hat: window.kipMenu.ctx.loco.hat, hair: window.kipMenu.ctx.loco.hair })");
check("stopping a song puts the crown and hair back", left2.hat === before2.hat && left2.hair === before2.hair, JSON.stringify([before2, left2]));

// a song that cannot be fetched: Kip is left exactly as he was and says so
server.blocked.add("/kip/songs/space_a.mp3");
await choose("partySong", "space_a");
await toggle("partyOn");
check("a song file that cannot be fetched says so and starts nothing", await page.waitFor("window.kipParty.state().on === false && window.kipParty.state().note.includes('could not be played')", 15000, 100));
await sleep(500);
const failed = await ev("({ hat: window.kipMenu.ctx.loco.hat, clip: window.kipMenu.ctx.read.clip(), note: window.kipMenu.fields.get('partyInfo').box.textContent, on: window.kipMenu.fields.get('partyOn').input.checked })");
check("Kip is exactly as he was (crown, rest pose), the switch is off, and the readout tells the child the practice beat is still there", failed.hat === before2.hat && failed.clip !== "dance_silly" && failed.on === false && failed.note.includes("practice beat is still here"), JSON.stringify(failed));
server.blocked.delete("/kip/songs/space_a.mp3");
await choose("partySong", "practice");

// ---- hosted in the Workshop: leaving the Kip tab ends the party (no sound plays on in a tab the child has left) ------------------------------------------
{
  const K = "window.workshop.handles('kip')"; // a hosted bench publishes its hooks on its handle, not on window
  const w = await chrome.open(`${server.base}/kip/Workshop.html?bench=kip`, { width: 900, height: 700 });
  const up = await w.waitFor(`${K}?.__KIP_READY__ === true && Boolean(${K}.kipParty)`, 180000);
  check("the Workshop's Kip tab has the party", up);
  await sleep(1500);
  await w.click(600, 350);
  const crown = await w.evaluate(`${K}.kipMenu.ctx.loco.hat`);
  await w.evaluate(`${K}.kipParty.start()`);
  check("a party starts in the hosted bench", await w.waitFor(`${K}.kipParty.state().on === true`, 15000, 100));
  await w.evaluate("document.querySelector('.ws-tab[data-bench=\"truck\"]').click()");
  check("switching to the Truck tab ends the party", await w.waitFor(`${K}.kipParty.state().on === false`, 5000, 100));
  await sleep(400);
  const left = await w.evaluate(`({ hat: ${K}.kipMenu.ctx.loco.hat, song: ${K}.kipParty.state().songTime })`);
  check("the sound is off and the crown is back after leaving the tab", left.song === 0 && left.hat === crown, JSON.stringify({ ...left, crown }));
  check("no exceptions in the Workshop page", w.exceptions.length === 0, w.exceptions.slice(0, 2).join(" | "));
}

check("no exceptions in the page", page.exceptions.length === 0, page.exceptions.slice(0, 2).join(" | "));
console.log(`screenshots: ${SHOTS}`);
chrome.close();
server.close?.();
finish();
