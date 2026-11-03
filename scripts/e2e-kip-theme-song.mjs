#!/usr/bin/env node
// The theme song card (parts/kip/viewer/kip-theme-song.js) inside the Describe & build tab, in headless Chrome. Run: node scripts/e2e-kip-theme-song.mjs
//
// What is real: the page, the tab, the card, the starter-library index and its mp3 names. What is stood in: the app's own routes (/api/describe and /api/theme-song),
// so nothing is spent and no key is read: the Worker route itself is covered in tests/theme-song-worker.test.ts and by scripts/probe-theme-song.ts against the real services.
// The card is driven through `window.__describe.theme` for the scenarios and through the real Build button for the one that proves the song starts WITH the build.
// Env: E2E_CHROME, E2E_SHOTS (see scripts/lib/kip-e2e.mjs).
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChecks, launchChrome } from "./lib/kip-e2e.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWER = path.join(ROOT, "parts/kip/viewer");
const PUBLIC = path.join(ROOT, "public");
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-theme-song-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const { check, finish } = createChecks("theme song card e2e");
const recipes = JSON.parse(fs.readFileSync(path.join(VIEWER, "kip-describe-recipes.json"), "utf8"));
const skate = recipes.recipes.find((r) => r.id === "skateboard");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".stl": "model/stl", ".css": "text/css", ".mp3": "audio/mpeg" };

// ---- the stand-ins ------------------------------------------------------------------------------------------------------------------------
const GOOD = { contract: 1, name: "Stompy Big Buddy", mood: "bouncy", tempo: "medium", instruments: ["drums"], ai: true, task: "170010186285057",
  verse: ["See my tall metal buddy", "He can march and sway", "Shiny tummy glows with light", "Clapping hands for happy play"],
  chorus: ["Stompy Big Buddy march with me", "We will stomp and shout hooray", "Spin around and clap with glee", "Happy steps are here to stay"] };
const theme = { enabled: true, post: { status: 200, body: GOOD }, polls: [], seen: [], gets: 0, postAt: 0, describeAnsweredAt: 0 };
const describeStub = { delayMs: 0, seen: [] };
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };

const web = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/theme-song") {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      if (req.method === "POST") { theme.postAt = Date.now(); theme.seen.push({ method: "POST", body: raw }); return json(res, theme.post.status, theme.post.body); }
      if (!u.searchParams.has("id")) { theme.seen.push({ method: "GET", probe: true }); return json(res, theme.enabled ? 200 : 503, theme.enabled ? { ok: true, enabled: true } : { error: "off" }); }
      theme.gets++; theme.seen.push({ method: "GET", id: u.searchParams.get("id") });
      return json(res, 200, theme.polls.length > 1 ? theme.polls.shift() : (theme.polls[0] ?? { status: "making" }));
    });
    return;
  }
  if (u.pathname === "/api/describe") {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => setTimeout(() => {
      theme.describeAnsweredAt = Date.now();
      json(res, 200, { contract: 1, title: skate.title, note: `Muse picked "${skate.title}", a checked build.`, validated: true, steps: skate.steps, poses: skate.reference.poses });
    }, describeStub.delayMs));
    return;
  }
  if (u.pathname === "/api/voice") { res.writeHead(503); res.end("voice unavailable"); return; }
  const p = decodeURIComponent(u.pathname);
  const cands = [];
  if (p.startsWith("/kip/tools/")) cands.push(path.join(VIEWER, "tools", p.slice("/kip/tools/".length)));
  if (p.startsWith("/kip/") && !p.slice(5).includes("/")) cands.push(path.join(VIEWER, p.slice(5)));
  cands.push(path.join(PUBLIC, p));
  const file = cands.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => web.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${web.address().port}`;

const chrome = await launchChrome({ width: 1100, height: 900 });
let code = 0;
try {
  const page = await chrome.open(`${base}/kip/tools/describe-harness.html?stepMs=300&theme=/api/theme-song&themePoll=250&de=/api/describe`);
  const ev = (expr) => page.evaluate(expr);
  const card = (sel) => ev(`document.querySelector('.kts-card ${sel}')?.textContent ?? ''`);
  const hidden = () => ev("document.querySelector('.kts-card').hidden");
  const reset = () => { theme.seen.length = 0; theme.gets = 0; theme.polls = []; theme.post = { status: 200, body: GOOD }; theme.enabled = true; };
  // a recording stand-in for the browser's Audio: headless Chrome has no speakers and a script click is not a user gesture
  await ev(`(() => { window.__audios = []; window.Audio = class { constructor(src) { this.src = src; this.playing = false; this.loop = false; window.__audios.push(this); } play() { this.playing = true; return Promise.resolve(); } pause() { this.playing = false; } addEventListener() {} }; })()`);
  const audios = () => ev("window.__audios.map((a) => ({ src: a.src, playing: a.playing, loop: a.loop }))");
  await ev("localStorage.removeItem('tv.themeSongs.v1')");

  console.log("\n[1] the card is there but hidden until a song starts");
  check("the page and the tab load", await page.waitFor("window.__describeReady === true", 120000));
  check("the card exists inside the panel and is hidden", (await ev("!!document.querySelector('.kdb-panel .kts-card')")) && (await hidden()));
  check("the card says the song is made by AI", (await card(".kts-ai")) === "Made by AI");

  console.log("\n[2] a song starts: the name and the words show at once, then the song arrives");
  reset();
  theme.polls = [{ status: "making" }];            // stays "making" until the stand-in is playing (released below)
  const started = await ev("window.__describe.theme.start('a giant stomping robot')");
  check("start resolves true once the NAME is in", started === true);
  check("the probe (a free GET) came first, then one POST with only the description", theme.seen[0]?.probe === true && theme.seen[1]?.method === "POST" && JSON.parse(theme.seen[1].body).description === "a giant stomping robot" && Object.keys(JSON.parse(theme.seen[1].body)).length === 1, JSON.stringify(theme.seen.slice(0, 2)));
  check("the card shows", !(await hidden()));
  check("it shows the creation's name", (await card(".kts-name")) === "Stompy Big Buddy");
  check("it says the song takes about a minute and the child can keep building", /about a minute/.test(await card(".kts-status")) && /keep building/.test(await card(".kts-status")), await card(".kts-status"));
  check("the words are there: verse and chorus", (await card(".kts-lyrics p")).includes("See my tall metal buddy") && (await card(".kts-lyrics p")).includes("Stompy Big Buddy march with me"));
  check("a stand-in button appears (a starter-library tune of the same mood)", await page.waitFor("!document.querySelector('.kts-card button:not(.kts-play)').hidden", 10000));
  check("no play-your-song button yet", await ev("document.querySelector('.kts-play').hidden"));
  await page.shot(path.join(SHOTS, "making.png"));

  console.log("\n[3] the stand-in tune plays while the song is made, then swaps to the song");
  await ev("document.querySelector('.kts-card button:not(.kts-play)').click()");
  let a = await audios();
  check("the stand-in is a bouncy library mp3, looping, playing", a.length === 1 && /^\/kip\/songs\/bouncy_[a-z]\.mp3$/.test(a[0].src.replace(base, "")) && a[0].loop === true && a[0].playing === true, JSON.stringify(a));
  theme.polls = [{ status: "ready", url: "https://cdn.example/song.mp3", durationMs: 49000 }];   // now the song finishes
  check("the song becomes ready and the card says so", await page.waitFor("/ready/.test(document.querySelector('.kts-status').textContent)", 20000), await card(".kts-status"));
  a = await audios();
  check("the stand-in was stopped and the real song is playing (it was already playing, so it swaps at once)", a.length === 2 && a[0].playing === false && a[1].src === "https://cdn.example/song.mp3" && a[1].playing === true && a[1].loop === false, JSON.stringify(a));
  check("the play button is shown and the stand-in button is gone", !(await ev("document.querySelector('.kts-play').hidden")) && (await ev("document.querySelector('.kts-card button:not(.kts-play)').hidden")));
  const kept = await ev("JSON.parse(localStorage.getItem('tv.themeSongs.v1') || '[]')");
  check("the song is kept in this browser's list, with its words", kept.length === 1 && kept[0].name === "Stompy Big Buddy" && kept[0].url === "https://cdn.example/song.mp3" && kept[0].verse.length === 4, JSON.stringify(kept).slice(0, 200));
  const getsAtReady = theme.gets;
  await new Promise((r) => setTimeout(r, 900));
  check("polling stops once the song is ready", theme.gets === getsAtReady, `${getsAtReady} -> ${theme.gets}`);
  await ev("document.querySelector('.kts-play').click()");
  check("pressing the play button stops the song", (await audios())[1].playing === false && (await card(".kts-play")) === "Play your song");
  await ev("document.querySelector('.kts-play').click()");
  check("pressing it again plays it from the kept link", (await audios()).length === 3 && (await audios())[2].src === "https://cdn.example/song.mp3");
  await page.shot(path.join(SHOTS, "ready.png"));

  console.log("\n[4] when the route is off, the card stays hidden and nothing is asked twice");
  reset();
  // a fresh page: the "is it on" answer is remembered for the life of a tab
  const off = await chrome.open(`${base}/kip/tools/describe-harness.html?stepMs=300&theme=/api/theme-song&themePoll=250`);
  await off.waitFor("window.__describeReady === true", 120000);
  theme.enabled = false;
  const startedOff = await off.evaluate("window.__describe.theme.start('a race car')");
  check("start resolves false", startedOff === false);
  check("the card is hidden and no POST was sent", (await off.evaluate("document.querySelector('.kts-card').hidden")) && !theme.seen.some((s) => s.method === "POST"), JSON.stringify(theme.seen));
  check("it asked once (the free probe) and not again on a second start", (await off.evaluate("window.__describe.theme.start('a race car')")) === false && theme.seen.filter((s) => s.probe).length === 1);

  console.log("\n[5] a failed order or a failed song leaves the name and the words, never a broken card");
  reset();
  theme.polls = [{ status: "failed" }];
  await ev("window.__describe.theme.start('a robot')");
  check("a failed song says so kindly and keeps the name", await page.waitFor("/could not be finished/.test(document.querySelector('.kts-status').textContent)", 15000) && (await card(".kts-name")) === "Stompy Big Buddy", await card(".kts-status"));
  check("a failed song offers no play button and no stand-in", (await ev("document.querySelector('.kts-play').hidden")) && (await ev("document.querySelector('.kts-card button:not(.kts-play)').hidden")));
  reset();
  theme.post = { status: 200, body: { ...GOOD, task: null, songError: "The song studio could not start this one." } };
  await ev("window.__describe.theme.start('a robot')");
  check("an order that could not start shows the name and the words and says so", (await card(".kts-name")) === "Stompy Big Buddy" && /could not start/.test(await card(".kts-status")) && theme.gets === 0, await card(".kts-status"));
  reset();
  theme.post = { status: 502, body: { error: "no song this time" } };
  const startedBad = await ev("window.__describe.theme.start('a robot')");
  check("a refused song (the gate said no) hides the card and does not throw", startedBad === false && (await hidden()));

  console.log("\n[6] the song starts WITH the build, not after it");
  reset();
  describeStub.delayMs = 1500;               // the build takes a moment to answer; the song must not wait for it
  theme.polls = [{ status: "making" }];
  await ev("window.__describe.setText('a skateboard'); document.querySelector('.kdb-go').click()");
  check("the name appears while the build is still being found", await page.waitFor("document.querySelector('.kts-name').textContent === 'Stompy Big Buddy'", 20000));
  const postAt = theme.postAt;
  await page.waitFor("window.__describe.view && window.__describe.view.meshes.length > 0", 180000);
  check("the build's own answer left the server AFTER the song's POST arrived (they ran side by side, the song did not wait)", theme.describeAnsweredAt > 0 && postAt < theme.describeAnsweredAt, `post ${postAt}, describe answered ${theme.describeAnsweredAt}`);
  check("the build still finishes and draws its parts", await page.waitFor(`window.__describe.view && window.__describe.view.meshes.length === ${skate.steps.length}`, 180000));
  check("the card and the build sit in the same panel, the card above the play controls", await ev("(() => { const p = document.querySelector('.kdb-panel'); const c = p.querySelector('.kts-card'), b = p.querySelector('.kdb-build'); return !!(c.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); })()"));

  console.log("\n[7] a new build replaces the old song, and an old answer cannot land on the new card");
  reset();
  theme.polls = [{ status: "ready", url: "https://cdn.example/OLD.mp3", durationMs: 1000 }];
  theme.post = { status: 200, body: { ...GOOD, name: "Old Name", task: "111111111" } };
  const first = ev("window.__describe.theme.start('first')");
  theme.post = { status: 200, body: { ...GOOD, name: "New Name", task: "222222222" } };
  await first;
  await ev("window.__describe.theme.start('second')");
  check("the card shows the newest name", (await card(".kts-name")) === "New Name", await card(".kts-name"));
  await new Promise((r) => setTimeout(r, 1200));
  const list = await ev("JSON.parse(localStorage.getItem('tv.themeSongs.v1') || '[]').map((s) => s.name)");
  check("a stale answer never reached the saved list", !list.includes("Old Name"), JSON.stringify(list));

  console.log("\n[8] closing the panel stops the sound and the page has no errors");
  await ev("window.__describe.theme.start('a robot')"); // makes sure something can be playing
  await ev("window.__describe.close()");
  check("nothing is playing after the panel closes", (await audios()).every((x) => !x.playing));
  check("no page exceptions", page.exceptions.length === 0, page.exceptions.join(" | "));
  const peeked = await ev("document.querySelector('.kdb-panel').textContent.includes('Made by AI')");
  check("the AI label is part of the panel", peeked === true);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  chrome.close();
  web.close();
}
finish();
process.exit(process.exitCode ?? code);
