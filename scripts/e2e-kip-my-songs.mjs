#!/usr/bin/env node
// "My songs": a child's own theme song becomes a party song, in the real Kip page (headless Chrome with the machine's GPU).
// Run: E2E_GPU=metal node scripts/e2e-kip-my-songs.mjs      Exits nonzero on any failing check.
//
// What is real: the Kip page, the Describe tab's theme card, kip-my-songs.js (fetch, decode with the browser's own decoder, measure the beat, plan and cut the
// bars), the bundled analyzer, the party's checker and engine, the rig. What is stood in: the app's /api/theme-song route (no key, no money), which answers with a
// SYNTHETIC song (a kick on every beat of 106 bpm and a loud unsteady burst in its last 5 s, like the provider's appended watermark).
import os from "node:os";
import path from "node:path";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-my-songs-shots");
const { check, finish } = createChecks("kip my songs e2e");

// ---- a synthetic song as WAV bytes ---------------------------------------------------------------------------------------------------------------
function wavSong({ bpm = 106, seconds = 50, first = 0.54, sr = 22050, watermark = true, noise = false } = {}) {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  const iv = 60 / bpm;
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  if (noise) for (let i = 0; i < n; i++) x[i] = 0.3 * rnd();
  else {
    for (let k = 0; first + k * iv < seconds - (watermark ? 5 : 0); k++) {
      const t0 = Math.round((first + k * iv) * sr);
      const amp = k % 4 === 0 ? 0.9 : 0.5;
      for (let i = 0; i < 0.12 * sr && t0 + i < n; i++) x[t0 + i] += amp * Math.sin((2 * Math.PI * (70 + 40 * Math.exp(-i / (0.02 * sr))) * i) / sr) * Math.exp(-i / (0.04 * sr));
      const h0 = Math.round((first + k * iv + iv / 2) * sr);
      for (let i = 0; i < 0.02 * sr && h0 + i < n; i++) x[h0 + i] += 0.15 * Math.sin(i * 1.9) * Math.exp(-i / (0.005 * sr));
    }
    if (watermark) for (let i = Math.round((seconds - 5) * sr); i < n; i++) x[i] += 0.5 * rnd() * (0.5 + 0.5 * Math.sin(i / 900));
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return buf;
}
const SONG = wavSong();
const SHORT = wavSong({ seconds: 10, watermark: false });   // too short to dance to: measured and refused

// ---- the stand-in route ---------------------------------------------------------------------------------------------------------------------------
const TASK = "170010186285099";
const SHORT_TASK = "170010186285100";
const GONE_TASK = "170010186285111";
const RETRY_TASK = "170010186285222";
const route = { audioFetches: [], statusPolls: 0, enabled: true, down: new Set() };
const server = await startServer();
server.mock("GET", "/api/theme-song", ({ search }) => {
  if (!search.has("id")) return { json: { ok: true, enabled: route.enabled } };
  const id = search.get("id");
  if (search.get("audio") === "1") {
    route.audioFetches.push(id);
    if (id === GONE_TASK) return { status: 404, json: { error: "gone" } };
    if (route.down.has(id)) return { status: 503, json: { error: "unavailable" } };
    return { raw: id === SHORT_TASK ? SHORT : SONG, type: "audio/wav" };
  }
  route.statusPolls++;
  return { json: { status: "ready", url: "https://cdn.mureka.example/a.mp3", durationMs: 50000 } };
});
server.mock("POST", "/api/theme-song", () => ({ json: {
  contract: 1, name: "Stompy Big Buddy", mood: "bouncy", tempo: "medium", instruments: ["drums"], ai: true, task: TASK,
  verse: ["See my tall metal buddy", "He can march and sway", "Shiny tummy glows with light", "Clapping hands for happy play"],
  chorus: ["Stompy Big Buddy march with me", "We will stomp and shout hooray", "Spin around and clap with glee", "Happy steps are here to stay"],
} }));

process.env.E2E_STRICT_STL = "1";
const chrome = await launchChrome({ width: 900, height: 700 });
let code = 0;
try {
  const page = await chrome.open(`${server.base}/kip/Kip-Demo.html?expr=spark`, { width: 900, height: 700 });
  const ev = (expr) => page.evaluate(expr);
  const choose = (id, value) => ev(`(() => { const s = window.kipMenu.fields.get(${JSON.stringify(id)}).select; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  const toggle = (id) => ev(`(() => { const f = window.kipMenu.fields.get(${JSON.stringify(id)}); const i = f.input || f.root.querySelector('input'); i.click(); return i.checked; })()`);
  const options = () => ev("[...window.kipMenu.fields.get('partySong').select.options].map((o) => ({ value: o.value, label: o.textContent }))");
  const state = () => ev("window.kipParty.state()");

  console.log("\n[1] the page has My songs and nothing of mine yet");
  check("the Kip page loads and publishes the party and My songs", (await page.waitFor("window.__KIP_READY__ === true", 180000)) && (await ev("Boolean(window.kipParty && window.kipMySongs && window.kipDescribe?.theme)")));
  await ev("localStorage.removeItem('tv.themeSongs.v1'); localStorage.removeItem('tv.themeSongBeats.v1')");
  check("the Song picker has the practice beat and the starter songs, none of mine", (await options()).every((o) => !o.value.startsWith("my_")) && (await options()).length >= 13, JSON.stringify((await options()).map((o) => o.value)));
  await new Promise((r) => setTimeout(r, 800));

  console.log("\n[2] a theme song is made in Describe & build: it is measured at once and offered in the party's Song picker");
  check("the card starts the song (name and words in)", (await ev("window.kipDescribe.theme.start('a giant stomping robot')")) === true);
  check("when the song is ready it is measured and appears in the picker", await page.waitFor(`[...window.kipMenu.fields.get('partySong').select.options].some((o) => o.value === 'my_${TASK}')`, 40000, 250), JSON.stringify((await options()).map((o) => o.value)));
  const mine = (await options()).find((o) => o.value === `my_${TASK}`);
  check("it is labelled My song, with its name and its measured tempo", mine?.label === "My song: Stompy Big Buddy (106)", mine?.label);
  check("its audio came through the app's own route (same origin), once", route.audioFetches.filter((i) => i === TASK).length === 1, JSON.stringify(route.audioFetches));
  const entry = await ev("window.kipMySongs.entries()[0]");
  check("the entry is library-shaped: AI label, whole bars, the watermark's 5 seconds left off", entry.ai === true && entry.beats === entry.bars * 4 && entry.bars >= 15 && entry.dur <= 50 - 5 + 0.2 && Math.abs(entry.bpm - 106) < 1, JSON.stringify(entry));
  const kept = await ev("JSON.parse(localStorage.getItem('tv.themeSongBeats.v1'))");
  check("the measuring result (not the audio) is kept for next time", kept[TASK]?.ok === true && JSON.stringify(kept).length < 2000);

  console.log("\n[3] Kip dances to it");
  await page.click(600, 350); // a real tap grants the browser's audio permission
  check("choosing it in the picker selects it", (await choose("partySong", `my_${TASK}`)) === `my_${TASK}`);
  await choose("partyBand", "2");
  await toggle("partyOn");
  check("switching Party on starts it from the cut (the bytes came from the page's own WAV)", await page.waitFor("window.kipParty.state().on === true", 20000, 100), JSON.stringify(await state()));
  let s = await state();
  check("the party's tempo is the song's measured tempo and a dance that fits it was picked", Math.abs(s.bpm - entry.bpm) < 0.01 && Boolean(s.danceId) && !s.lightsOnly, `${s.bpm} ${s.danceId}`);
  check("the song is the loop of the planned cut (its length, to the sample)", Math.abs(s.bufferSeconds - entry.dur) < 0.01, `${s.bufferSeconds} vs ${entry.dur}`);
  check("Kip put the headphones on and the picked dance is the clip playing", s.headphones && (await ev("window.kipMenu.ctx.read.clip()")) === s.danceId);
  const t0 = (await state()).songTime;
  await new Promise((r) => setTimeout(r, 3000));
  const t1 = (await state()).songTime;
  check("the song clock runs at the speed of time", Math.abs(t1 - t0 - 3) < 0.4, `${t1 - t0}`);
  s = await state();
  check("the beat count moves and the dance is held on the beat grid", s.count !== null && s.danceTime !== null && s.pulse >= 0, JSON.stringify({ count: s.count, dt: s.danceTime }));
  await page.shot(path.join(SHOTS, "dancing-to-my-song.png"));
  await toggle("partyOn");
  check("switching Party off stops it and gives Kip back his crown", await page.waitFor("window.kipParty.state().on === false", 8000, 100) && (await ev("window.kipMenu.ctx.loco.hat")) !== "headphones");

  console.log("\n[4] a song that cannot be danced to is not offered, and is not measured again and again");
  const before = route.audioFetches.length;
  const r1 = await ev(`window.kipMySongs.add({ task: '${SHORT_TASK}', name: 'Tiny', mood: 'bouncy' })`);
  check("a too-short song is measured and refused with a reason", r1 && r1.ok === false && r1.reason === "too_short", JSON.stringify(r1));
  check("the picker does not list it", !(await options()).some((o) => o.value === `my_${SHORT_TASK}`));
  await ev(`localStorage.setItem('tv.themeSongs.v1', JSON.stringify([{ name: 'Tiny', url: 'https://x/y.mp3', task: '${SHORT_TASK}', mood: 'bouncy', verse: [], chorus: [] }, ...JSON.parse(localStorage.getItem('tv.themeSongs.v1') || '[]')]))`);
  await ev("window.kipMySongs.catchUp()");
  check("a refused song is remembered as refused: no second fetch", route.audioFetches.filter((i) => i === SHORT_TASK).length === 1 && route.audioFetches.length === before + 1, JSON.stringify(route.audioFetches));

  console.log("\n[4b] a song whose audio cannot be fetched right now is NOT written off: it is tried again later");
  route.down.add(RETRY_TASK);
  const r2 = await ev(`window.kipMySongs.add({ task: '${RETRY_TASK}', name: 'Later', mood: 'bouncy' })`);
  check("the failed fetch answers nothing and remembers nothing", r2 === null && !(await ev("JSON.parse(localStorage.getItem('tv.themeSongBeats.v1'))"))["${RETRY_TASK}"], JSON.stringify(r2));
  route.down.delete(RETRY_TASK);
  await ev(`localStorage.setItem('tv.themeSongs.v1', JSON.stringify([{ name: 'Later', url: 'https://x/z.mp3', task: '${RETRY_TASK}', mood: 'bouncy', verse: [], chorus: [] }, ...JSON.parse(localStorage.getItem('tv.themeSongs.v1') || '[]')]))`);
  await ev("window.kipMySongs.catchUp()");
  check("once the audio is there, the next catch-up measures it and offers it", await page.waitFor(`[...window.kipMenu.fields.get('partySong').select.options].some((o) => o.value === 'my_${RETRY_TASK}')`, 15000, 250));

  console.log("\n[5] next visit: the picker is complete from storage, with no audio fetched");
  const fetchedBefore = route.audioFetches.length;
  await ev("setTimeout(() => location.reload(), 50)");
  await new Promise((r) => setTimeout(r, 2000));
  check("the page loads again", await page.waitFor("window.__KIP_READY__ === true", 180000));
  check("My song is in the picker straight away", await page.waitFor(`[...window.kipMenu.fields.get('partySong').select.options].some((o) => o.value === 'my_${TASK}')`, 20000, 250));
  check("no audio was fetched to build the picker", route.audioFetches.length === fetchedBefore, `${fetchedBefore} -> ${route.audioFetches.length}`);

  console.log("\n[6] a song whose audio can no longer be had leaves Kip exactly as he was");
  await ev(`(() => { const beats = JSON.parse(localStorage.getItem('tv.themeSongBeats.v1')); const songs = JSON.parse(localStorage.getItem('tv.themeSongs.v1'));
    const e = { ...beats['${TASK}'].entry, id: 'my_${GONE_TASK}', file: 'my_${GONE_TASK}.mp3', title: 'Gone Song' };
    beats['${GONE_TASK}'] = { ok: true, entry: e }; songs.unshift({ name: 'Gone Song', url: 'https://x/y.mp3', task: '${GONE_TASK}', mood: 'bouncy', verse: [], chorus: [] });
    localStorage.setItem('tv.themeSongBeats.v1', JSON.stringify(beats)); localStorage.setItem('tv.themeSongs.v1', JSON.stringify(songs)); })()`);
  await ev("window.kipParty.refreshSongs()");
  check("the song is offered (its measuring is remembered)", await page.waitFor(`[...window.kipMenu.fields.get('partySong').select.options].some((o) => o.value === 'my_${GONE_TASK}')`, 10000, 250));
  await page.click(600, 350);
  await choose("partySong", `my_${GONE_TASK}`);
  const hatBefore = await ev("window.kipMenu.ctx.loco.hat");
  const started = await ev("window.kipParty.start()");
  const after = await state();
  check("starting it fails, says so, and the practice beat is offered", started === false && after.on === false && /could not be played/.test(after.note), after.note);
  check("Kip is exactly as he was: the same crown, no headphones", (await ev("window.kipMenu.ctx.loco.hat")) === hatBefore && hatBefore !== "headphones");
  check("no page exceptions", page.exceptions.length === 0, page.exceptions.join(" | "));
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  chrome.close();
  server.close();
}
finish();
process.exit(process.exitCode ?? code);
