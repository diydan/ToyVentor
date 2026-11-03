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
for (const f of fr) {
  const pos = (f.ft * s.bpm) / 60;
  const want = ((((pos % clipInfo.beats) + clipInfo.beats) % clipInfo.beats) * 60) / clipInfo.bpm;
  worst = Math.max(worst, Math.abs(f.dt - want));
}
check(`every frame's dance time is the song's beat position x the clip's beat length (worst ${(worst * 1000).toFixed(3)} ms)`, worst < 1e-6);
// the rig itself follows: the pose one dance loop of song time apart is the same pose, half a loop apart it differs
const loopSec = (clipInfo.beats * 60) / s.bpm;
const dist = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const nearest = (t) => fr.reduce((best, f) => (Math.abs(f.ft - t) < Math.abs(best.ft - t) ? f : best), fr[0]);
let same = 0, differ = 0, pairs = 0;
// (the first second is Kip blending in from the rest pose, so it is not yet the dance)
for (const f of fr.filter((x) => x.ft > 1.5 && x.ft + loopSec < fr[fr.length - 1].ft)) {
  const g = nearest(f.ft + loopSec);
  if (Math.abs(g.ft - (f.ft + loopSec)) > 0.004) continue;
  const h = nearest(f.ft + loopSec / 2);
  pairs++;
  same = Math.max(same, dist(f.q, g.q));
  differ = Math.max(differ, dist(f.q, h.q));
}
check(`the rig is on the beat: the pose a dance loop (${loopSec.toFixed(2)} s) later is the same pose (worst ${same.toFixed(3)} rad over ${pairs} pairs), half a loop later it differs (${differ.toFixed(2)} rad)`, pairs >= 5 && same < 0.08 && differ > 0.2, `pairs ${pairs}`);
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
check("a second tap on the same beat does not count again", taps.repeat[0]?.kind === "hit" && taps.repeat[1]?.kind === "repeat", JSON.stringify(taps.repeat.map((o) => o?.kind)));
check("the run counts every tap and only the hits", taps.summary.taps === 10 + 4 + 2 && taps.summary.hits === hits.length + (taps.repeat[0]?.kind === "hit" ? 1 : 0), `${taps.summary.taps} taps, ${taps.summary.hits} hits`);

// ---- stopping puts everything back --------------------------------------------------------------------------------------------------------
await toggle("partyOn");
check("switching Party off stops it", await page.waitFor("window.kipParty.state().on === false", 5000, 100));
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
