#!/usr/bin/env node
// The end-of-level song and the IN-GAME dance party, in the real game at 390x844 (headless Chrome, Metal GPU). Run: node scripts/e2e-game-party.mjs
//
// Boots the real app on its own vite port and plays the real Garden. A level win is made the way the engine makes one (the save's `lastWin` changes, the engine's poll
// raises `missionSolved`), so the real React handler runs. What is stood in: the app's /api/theme-song route (no key, no money): it answers with a SYNTHETIC song, a kick on
// every beat of 106 bpm with a loud unsteady burst in its last 5 s (like the provider's appended watermark), and /api/voice with silence.
// What is real: the card, the flow, the audio decode, the beat measurement, the cut, the audio engine (a looping buffer on the game's own audio context), the character's
// dance, and the camera. The beat lock is MEASURED: the character's hips are sampled every frame against the song clock, and the lowest points must land on the beats.
// Env: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS. Exits nonzero on any failing check.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5196);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9348);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-game-party-profile";
const SHOTS = process.env.E2E_SHOTS ?? "";
const APP = `http://localhost:${DEV_PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeoutMs = 60000, everyMs = 250, label = "?" } = {}) {
  const end = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`timeout waiting for ${label}: ${String(last)}`);
    await sleep(everyMs);
  }
}

// ---- the synthetic song (WAV) and the stand-in route ---------------------------------------------------------------------------------------------
function wavSong({ bpm = 106, seconds = 50, first = 0.54, sr = 22050 } = {}) {
  const n = Math.round(seconds * sr), x = new Float32Array(n), iv = 60 / bpm;
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  for (let k = 0; first + k * iv < seconds - 5; k++) {
    const t0 = Math.round((first + k * iv) * sr), amp = k % 4 === 0 ? 0.9 : 0.5;
    for (let i = 0; i < 0.12 * sr && t0 + i < n; i++) x[t0 + i] += amp * Math.sin((2 * Math.PI * (70 + 40 * Math.exp(-i / (0.02 * sr))) * i) / sr) * Math.exp(-i / (0.04 * sr));
    const h0 = Math.round((first + k * iv + iv / 2) * sr);
    for (let i = 0; i < 0.02 * sr && h0 + i < n; i++) x[h0 + i] += 0.15 * Math.sin(i * 1.9) * Math.exp(-i / (0.005 * sr));
  }
  for (let i = Math.round((seconds - 5) * sr); i < n; i++) x[i] += 0.5 * rnd() * (0.5 + 0.5 * Math.sin(i / 900));
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return b;
}
const SONG_B64 = wavSong().toString("base64");
const SILENT_B64 = (() => { const n = 2400, bytes = n * 2, b = Buffer.alloc(44 + bytes); b.write("RIFF", 0); b.writeUInt32LE(36 + bytes, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(bytes, 40); return b.toString("base64"); })();
const TASK = "170010186285777";
const NAMED = { contract: 1, name: "Brave Bridge Builder", mood: "bouncy", tempo: "medium", instruments: ["drums"], ai: true, task: TASK,
  verse: ["Planks go down one by one", "Over the river we run", "Hammer tap and bolt turn", "Look at the bridge we built"], chorus: ["Brave Bridge Builder, hooray", "We built it all today", "Brave Bridge Builder, hooray", "Cross it and play"] };
const route = { enabled: true, ready: false, probes: 0, posts: [], statusPolls: 0, audioFetches: 0, quota: null, warms: 0, probeDelayMs: 0, devices: new Set(), settingsReads: 0, settingsPosts: 0, settings: { makerOn: true, limit: 5 } };

class Cdp {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); this.exceptions = []; }
  connect() {
    return new Promise((res, rej) => {
      const ws = new WebSocket(this.url); this.ws = ws;
      ws.addEventListener("open", () => res(), { once: true });
      ws.addEventListener("error", rej, { once: true });
      ws.addEventListener("message", (ev) => {
        let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.id != null && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id);
          m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
        } else if (m.method === "Runtime.exceptionThrown") {
          this.exceptions.push(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || "exception");
        } else if (m.method === "Fetch.requestPaused") {
          const { requestId, request } = m.params;
          const u = new URL(request.url);
          if (u.pathname.startsWith("/api/theme-song")) { const dev = request.headers["x-device-id"] ?? request.headers["X-Device-Id"]; if (dev) route.devices.add(dev); }
          const json = (status, body) => this.send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
          if (u.pathname.startsWith("/api/parent/")) json(503, { error: "blocked in this test: the game uses its local fallback" });
          else if (u.pathname === "/api/voice") this.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "audio/wav" }], body: SILENT_B64 }).catch(() => {});
          else if (u.pathname === "/api/theme-song/warm") { route.warms++; json(202, { ok: true, status: "accepted" }); }
          else if (u.pathname === "/api/theme-song/settings") {
            if (request.method === "GET") { route.settingsReads++; json(200, { settings: route.settings, quota: { limit: route.settings.limit, used: 0, left: route.settings.limit, resetsOn: "2026-11-09", makerOn: route.settings.makerOn } }); }
            else { route.settingsPosts++; json(401, { status: "gate-required" }); }
          }
          else if (u.pathname === "/api/theme-song") {
            if (request.method === "POST") {
              route.posts.push(request.postData ?? "");
              let sent = {}; try { sent = JSON.parse(request.postData ?? "{}"); } catch {}
              if (sent.kind === "prompt" && /gun/.test(sent.description ?? "")) json(422, { error: "Let's pick a different idea!", reason: "idea_not_allowed" });
              else if (sent.kind === "prompt") json(200, { ...NAMED, name: "Sleepy Cat Lullaby", chorus: ["Sleepy Cat Lullaby, hush", "Purr and curl up small", "Sleepy Cat Lullaby, hush", "Dream of one and all"], task: String(BigInt(TASK) + BigInt(route.posts.length)) });
              else json(200, NAMED);
            }
            else if (!u.searchParams.has("id")) { route.probes++; const answer = () => (route.enabled ? json(200, { ok: true, enabled: true, ...(route.quota ? { quota: route.quota } : {}) }) : json(503, { error: "off" })); if (route.probeDelayMs) setTimeout(answer, route.probeDelayMs); else answer(); }
            else if (u.searchParams.get("audio") === "1") { route.audioFetches++; this.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "audio/wav" }], body: SONG_B64 }).catch(() => {}); }
            else { route.statusPolls++; json(200, route.ready ? { status: "ready", url: "https://cdn.mureka.ai/a.mp3", durationMs: 50000 } : { status: "making" }); }
          } else this.send("Fetch.continueRequest", { requestId }).catch(() => {});
        }
      });
    });
  }
  send(method, params = {}) { const id = this.id++; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r?.exceptionDetails) throw new Error("evaluate threw: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r?.result?.value;
  }
  async tapAt(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
}

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `  [${detail}]`}`); };
const world = (cdp, expr) => cdp.ev(`(() => { const w = window.__tvWorld; if (!w) return null; return ${expr}; })()`);
const phase = (cdp) => cdp.ev(`document.querySelector('[data-testid="song-card"]')?.getAttribute('data-phase') ?? (document.querySelector('[data-testid="song-offer"]') ? 'offer' : 'none')`);
const centreOf = (cdp, sel) => cdp.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
/** Tap the centre of an element, or say which one is missing. */
const tap = async (cdp, sel) => { const c = await centreOf(cdp, sel); if (!c) throw new Error(`nothing to tap: ${sel} (page: ${await cdp.ev(`document.body.innerText.slice(0, 200)`)})`); await cdp.tapAt(c.x, c.y); };
const shot = async (cdp, name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64")); };
const win = (cdp, key = "garden.bridge") => world(cdp, `(() => { try { const S = w.handle && w.handle.S; if (!S) return "no save object on the handle"; S.lastWin = { key: ${JSON.stringify(key)}, tier: 1, attempts: 1, error: 0, stats: [], at: Date.now() }; document.querySelector("canvas").dispatchEvent(new MouseEvent("click", { bubbles: true })); /* the engine looks at the save when the host is clicked or the legacy code notifies; mtWin notifies */ return true; } catch (e) { return "threw: " + e; } })()`);

async function loadApp(cdp) {
  // record every looping song the page starts, and the context it is on, so the song clock can be read from here
  const hook = `(() => { window.__songs = []; const start = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (when, ...a) { if (this.loop && this.buffer && this.buffer.duration > 8) window.__songs.push({ ctx: this.context, when, loopEnd: this.loopEnd, dur: this.buffer.duration, node: this, stopped: false }); return start.call(this, when, ...a); }; const stop = AudioBufferSourceNode.prototype.stop; AudioBufferSourceNode.prototype.stop = function (...a) { const s = window.__songs.find((x) => x.node === this); if (s) s.stopped = true; return stop.apply(this, a); }; })();`;
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.removeItem("tv.themeSongs.v1"); } catch (e) {} ${hook}` });
  try {
    await cdp.send("Page.navigate", { url: APP });
    await waitFor(() => cdp.ev(`!!document.querySelector("canvas") && !!(window.__tvWorld && window.__tvWorld.props)`), { label: "stage + dev handle" });
  } finally { await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }); }
  await sleep(2000);
  await cdp.ev(`(() => { const t = document.querySelector("#title"); if (t && !t.hidden) document.querySelector("#play")?.click(); })()`);
  await sleep(1500);
  await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips" });
}

async function main() {
  const dev = spawn("npx", ["vite", "--port", String(DEV_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  const killAll = () => { try { chrome.kill(); } catch {} try { dev.kill(); } catch {} };
  process.on("SIGINT", () => { killAll(); process.exit(130); });
  try {
    await waitFor(async () => (await fetch(APP)).ok || null, { label: APP });
    await waitFor(async () => (await fetch(`http://localhost:${DEBUG_PORT}/json/version`)).ok || null, { label: "chrome" });
    await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
    const targets = await waitFor(async () => { const l = (await (await fetch(`http://localhost:${DEBUG_PORT}/json/list`)).json()).filter((t) => t.url === "about:blank"); return l.length ? l : null; }, { label: "new tab" });
    const cdp = new Cdp(targets[0].webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/voice*" }, { urlPattern: "*/api/theme-song*" }, { urlPattern: "*/api/parent/*" }] });

    // ---- 1. the route is ON: a win offers the song ----
    console.log("\n[1] a win offers the song");
    await loadApp(cdp);
    check("setup: the character can dance and nothing is offered yet", (await phase(cdp)) === "none");
    const won = await win(cdp);
    check("setup: the win was recorded on the save the way the engine records one", won === true, String(won));
    const offered = await waitFor(async () => ((await phase(cdp)) === "offer" ? true : null), { timeoutMs: 15000, label: "the offer" }).catch(() => false);
    check("a solved mission offers 'Make a song about it'", offered === true, `${await phase(cdp)} | toast=${await cdp.ev(`document.querySelector(".tv-xp-toast")?.textContent ?? null`)} | exceptions=${cdp.exceptions.slice(0, 2).join(" ; ")} | lastWin=${await world(cdp, `JSON.stringify(w.handle.S.lastWin)`)} | probes=${route.probes}`);
    const btn = await centreOf(cdp, ".tv-song-make");
    check("the button is a real touch target (at least 56 px high) and on the screen", btn && btn.h >= 56 && btn.x > 0 && btn.x < 390 && btn.y > 0 && btn.y < 844, JSON.stringify(btn));
    check("the offer woke our own song model while the child decides (a free no-op unless the model is ours): one warm-up, with the device id", await waitFor(async () => (route.warms === 1 ? true : null), { timeoutMs: 5000, label: "the warm-up" }).catch(() => false), `warms=${route.warms}`);
    check("it asked the route once, with a free probe (nothing posted yet)", route.probes === 1 && route.posts.length === 0, `${route.probes} ${route.posts.length}`);
    await shot(cdp, "1-offer");

    // ---- 2. a tap: the song is named at once, its words show, it is being sung ----
    console.log("\n[2] the tap makes the song");
    await cdp.tapAt(btn.x, btn.y);
    const making = await waitFor(async () => ((await phase(cdp)) === "making" ? true : null), { timeoutMs: 15000, label: "making" }).catch(() => false);
    check("the card shows the song being made", making === true, await phase(cdp));
    check("exactly one request was made, with only the level sentence, kind 'level' and a key for this tap", route.posts.length === 1 && (({ key, ...rest }) => JSON.stringify(rest) === JSON.stringify({ description: "I finished building a bridge with my toy.", kind: "level" }) && /^[A-Za-z0-9_-]{8,64}$/.test(key))(JSON.parse(route.posts[0])), route.posts.join("|"));
    check("the name is on the card", (await cdp.ev(`document.querySelector(".tv-song-name")?.textContent`)) === "Brave Bridge Builder");
    check("it says the song takes about a minute and is labelled as made by AI", /about a minute/.test(await cdp.ev(`document.querySelector(".tv-song-note")?.textContent`)) && (await cdp.ev(`document.querySelector(".tv-song-ai")?.textContent`)) === "Made by AI");
    check("the words are there, behind 'The words'", (await cdp.ev(`document.querySelector(".tv-song-words p")?.textContent`)).includes("Planks go down one by one"));
    check("the offer button is gone", (await cdp.ev(`!document.querySelector('[data-testid="song-offer"]')`)));
    await shot(cdp, "2-making");
    check("no party yet: the character is not dancing", (await world(cdp, `w.getMix().busyAction`)) !== "dance");

    // ---- 3. the song is ready: the party starts BY ITSELF ----
    console.log("\n[3] the song is ready and the party starts");
    route.ready = true;
    const dancing = await waitFor(async () => ((await phase(cdp)) === "dancing" ? true : null), { timeoutMs: 40000, label: "dancing" }).catch(() => false);
    check("the card goes to 'Dance party' with no further tap", dancing === true, await phase(cdp));
    check("the audio came through the route's relay, once", route.audioFetches === 1, String(route.audioFetches));
    await sleep(900);
    check("the character is dancing (the driver reports the dance, so the camera pushes in)", (await world(cdp, `w.getMix().busyAction`)) === "dance" && (await world(cdp, `w.getMix().beatDancing`)) === true);
    const song = await cdp.ev(`(() => { const s = window.__songs.at(-1); return s ? { loopEnd: s.loopEnd, dur: s.dur, when: s.when, loop: true } : null; })()`);
    check("a looping song is playing on the game's audio context, cut to whole bars before the watermark", song && song.loopEnd > 30 && song.loopEnd <= 45.3 && Math.abs(song.dur - song.loopEnd) < 0.05, JSON.stringify(song));
    check("the card says Stop the party", /Stop the party/.test(await cdp.ev(`document.querySelector(".tv-song-row")?.textContent`)));
    check("the song was kept for the Kip bench's My songs", (await cdp.ev(`JSON.parse(localStorage.getItem("tv.themeSongs.v1") || "[]")[0]?.name`)) === "Brave Bridge Builder");
    await shot(cdp, "3-dancing");

    // ---- 4. the dance is ON the beat, and the party takes turns between the dances that fit the tempo ----
    console.log("\n[4] the dance is on the beat, and the dances take turns");
    const SECONDS = 30;
    const recP = cdp.ev(`new Promise((resolve) => {
      const s = window.__songs.at(-1), out = [], t0 = performance.now();
      function frame() { const ts = s.ctx.getOutputTimestamp && s.ctx.getOutputTimestamp(); const heard = ts && ts.performanceTime > 0 ? ts.contextTime + (performance.now() - ts.performanceTime) / 1000 : s.ctx.currentTime - (s.ctx.outputLatency || s.ctx.baseLatency || 0); out.push([heard - s.when, window.__tvWorld.P.rig.g.position.y, window.__tvWorld.getMix().beatClip]); if (performance.now() - t0 < ${SECONDS * 1000}) requestAnimationFrame(frame); else resolve(out); }
      requestAnimationFrame(frame);
    })`);
    // while it records: a picture of each dance, a moment after the party reaches it
    const shotOf = new Set();
    for (let k = 0; k < SECONDS * 3; k++) {
      const name = await world(cdp, `w.getMix().beatClip`);
      if (name && !shotOf.has(name)) { await sleep(900); await shot(cdp, `4-dance-${name}`); shotOf.add(name); }
      await sleep(330);
    }
    const rec = await recP;
    const bpm = 106, beatsPerLoop = Math.round(song.loopEnd * bpm / 60), interval = song.loopEnd / beatsPerLoop;
    const order = []; for (const r of rec) if (r[2] && order.at(-1) !== r[2]) order.push(r[2]);
    check("the party took turns between the dances that fit this tempo, the nearest natural speed first: Samba, Hip Hop, Silly", order.slice(0, 3).join() === "dance,dance_hiphop,dance_silly", order.join());
    check("each dance got its own turn of about 16 beats (9 s), switching on the bar line", (() => { const first = rec.findIndex((r) => r[2] === "dance_hiphop"); return first > 0 && Math.abs(rec[first][0] - (song.loopEnd * 0 + 16 * interval / (song.loopEnd / beatsPerLoop) * (60 / bpm) * 0 + 16 * (60 / 106.29))) < 0.6; })(), JSON.stringify(order));
    const phaseOf = (clip) => {
      const rows = rec.filter((r) => r[2] === clip);
      if (!rows.length) return null;
      const t0 = rows[0][0] + 1, t1 = rows.at(-1)[0] - 1; // leave the ease-in and the cross-fade out
      const seg = rows.filter((r) => r[0] > t0 && r[0] < t1);
      const ys = seg.map((r) => r[1]); const lo = Math.min(...ys), hi = Math.max(...ys);
      const lows = [];
      for (let i = 2; i < seg.length - 2; i++) if (seg[i][1] < seg[i - 1][1] && seg[i][1] <= seg[i + 1][1] && seg[i][1] < (hi + lo) / 2) lows.push(seg[i][0]);
      let sx = 0, sy = 0;
      for (const t of lows) { const ph = (((t - 0.02) / (60 / 106.29)) % 1 + 1) % 1; sx += Math.cos(2 * Math.PI * ph); sy += Math.sin(2 * Math.PI * ph); }
      let secs = 0; for (let i = 1; i < seg.length; i++) if (seg[i][0] - seg[i - 1][0] < 0.1) secs += seg[i][0] - seg[i - 1][0]; // only the time actually spent on this dance (a dance can come round twice)
      return { lows: lows.length, range: hi - lo, R: Math.hypot(sx, sy) / Math.max(1, lows.length), phase: Math.atan2(sy, sx) / (2 * Math.PI), secs };
    };
    for (const clip of ["dance", "dance_hiphop", "dance_silly"]) {
      const m = phaseOf(clip);
      console.log(`      ${clip.padEnd(13)} ${m ? `${m.lows} low points in ${m.secs.toFixed(1)} s, mean phase ${m.phase.toFixed(3)} beat, consistency R=${m.R.toFixed(2)}, hips range ${m.range.toFixed(3)}` : "NOT SEEN"}`);
      check(`${clip}: the character really bounces (hips move at least 4 cm in stage units)`, m && m.range > 0.04, JSON.stringify(m));
      check(`${clip}: the hips dip about once a beat or more (a floor, not a count: the dances have small extra dips)`, m && m.lows >= Math.floor(m.secs / (60 / 106.29)) * 0.6, JSON.stringify(m));
      check(`${clip}: the low points land ON the beats: within 0.2 of a beat, and they keep to it`, m && Math.abs(m.phase) < 0.2 && m.R > 0.5, JSON.stringify(m));
    }
    check("every dance was seen and photographed", shotOf.size >= 3, [...shotOf].join());

    // ---- 5. stop: the song stops, the dance eases out ----
    console.log("\n[5] stop, and dance again");
    const stopBtn = await centreOf(cdp, ".tv-song-btn");
    await cdp.tapAt(stopBtn.x, stopBtn.y);
    check("the card says the party is over", await waitFor(async () => ((await phase(cdp)) === "over" ? true : null), { timeoutMs: 5000, label: "over" }).catch(() => false));
    await sleep(900);
    check("the song stopped and the character is idle again", (await cdp.ev(`window.__songs.at(-1).stopped`)) === true && (await world(cdp, `w.getMix().busyAction`)) !== "dance");
    await shot(cdp, "5-over");

    // ---- 6. dance again: the cut is kept, so nothing is fetched ----
    const fetchesBefore = route.audioFetches + route.statusPolls + route.posts.length;
    const again = await cdp.ev(`[...document.querySelectorAll(".tv-song-btn")].find((b) => /Dance again/.test(b.textContent))?.getBoundingClientRect().toJSON()`);
    check("there is a 'Dance again' button", Boolean(again), "");
    await cdp.tapAt(again.x + again.width / 2, again.y + again.height / 2);
    check("it dances again", await waitFor(async () => ((await phase(cdp)) === "dancing" ? true : null), { timeoutMs: 10000, label: "dancing again" }).catch(() => false));
    await sleep(800);
    check("with no new request to the route", route.audioFetches + route.statusPolls + route.posts.length === fetchesBefore, `${fetchesBefore} -> ${route.audioFetches + route.statusPolls + route.posts.length}`);
    const again2 = await cdp.ev(`({ songs: window.__songs.length, lastStopped: window.__songs.at(-1).stopped })`);
    check("the character dances again and a second song was started (the last one is playing, not stopped)", (await world(cdp, `w.getMix().busyAction`)) === "dance" && again2.songs === 2 && again2.lastStopped === false, JSON.stringify({ again2, action: await world(cdp, `w.getMix().busyAction`) }));

    // ---- 7. a party does not follow the child onto the Map ----
    console.log("\n[7] the Map ends the party");
    const mapBtn = await centreOf(cdp, ".tv-map-fab");
    await cdp.tapAt(mapBtn.x, mapBtn.y);
    await sleep(1200);
    check("opening the Map stopped the song and the dance", (await cdp.ev(`window.__songs.at(-1).stopped`)) === true && (await world(cdp, `w.getMix().busyAction`)) !== "dance");

    // ---- 7b. the Map's Songs sheet: make a song from an idea, dance to a kept one ----
    console.log("\n[7b] the Map's Songs sheet");
    const songsBtn = await centreOf(cdp, ".tv-map-songs");
    check("the Map has a Songs button (a real touch target, at least 48 px)", songsBtn && songsBtn.h >= 48, JSON.stringify(songsBtn));
    await cdp.tapAt(songsBtn.x, songsBtn.y);
    check("the Songs sheet opens in place of the Map", await waitFor(async () => (await cdp.ev(`!!document.querySelector('[data-testid="songs-sheet"]') && !document.querySelector('.tv-map-track')`)) || null, { timeoutMs: 8000, label: "songs sheet" }).catch(() => false));
    await sleep(600); // the sheet asks the route if it is on (a free GET) before it shows the maker
    check("it lists the song made at the end of the level, with a Dance button", (await cdp.ev(`[...document.querySelectorAll(".tv-songs-item")].map((li) => li.querySelector(".tv-songs-name").textContent)`)).join("|") === "Brave Bridge Builder");
    check("there are six idea chips and the Make button waits for an idea", (await cdp.ev(`document.querySelectorAll(".tv-songs-idea").length`)) === 6 && (await cdp.ev(`document.querySelector(".tv-songs-make").disabled`)) === true);
    const idea = await centreOf(cdp, ".tv-songs-idea");
    await cdp.tapAt(idea.x, idea.y);
    check("tapping an idea fills the box (it can still be changed)", (await cdp.ev(`document.querySelector(".tv-songs-input").value`)) === "a sleepy cat" && (await cdp.ev(`document.querySelector(".tv-songs-make").disabled`)) === false);
    await shot(cdp, "7b-songs-sheet");
    const postsBefore = route.posts.length;
    const make = await centreOf(cdp, ".tv-songs-make");
    check("the Make button is a real touch target (at least 56 px)", make.h >= 56, JSON.stringify(make));
    await cdp.tapAt(make.x, make.y);
    const madeIdea = await waitFor(async () => (route.posts.length === postsBefore + 1 ? true : null), { timeoutMs: 15000, label: "the idea song" }).catch(() => false);
    check("one request was made: only the idea, kind 'prompt' and a key for this tap", madeIdea && (({ key, ...rest }) => JSON.stringify(rest) === JSON.stringify({ description: "a sleepy cat", kind: "prompt" }) && /^[A-Za-z0-9_-]{8,64}$/.test(key))(JSON.parse(route.posts.at(-1))), route.posts.at(-1));
    check("the Map and the sheet closed so the stage is in view", await cdp.ev(`!document.querySelector('[data-testid="songs-sheet"]') && !document.querySelector('.tv-map-track')`));
    check("the same card takes over, with the new song's name, and the party starts", await waitFor(async () => ((await phase(cdp)) === "dancing" && (await cdp.ev(`document.querySelector(".tv-song-name")?.textContent`)) === "Sleepy Cat Lullaby" ? true : null), { timeoutMs: 40000, label: "idea party" }).catch(() => false), await phase(cdp));
    check("the character dances to it", (await world(cdp, `w.getMix().busyAction`)) === "dance");
    await shot(cdp, "7b-idea-party");

    // dance to the OLDER kept song from the list
    await tap(cdp, ".tv-song-btn"); // Stop the party
    await sleep(700);
    await tap(cdp, ".tv-map-fab");
    await sleep(800);
    await tap(cdp, ".tv-map-songs");
    await sleep(800);
    check("the list now has both songs, newest first", (await cdp.ev(`[...document.querySelectorAll(".tv-songs-item .tv-songs-name")].map((e) => e.textContent)`)).join("|") === "Sleepy Cat Lullaby|Brave Bridge Builder");
    const fetchesBeforeDance = route.audioFetches, postsBeforeDance = route.posts.length;
    const older = await cdp.ev(`(() => { const b = document.querySelectorAll(".tv-songs-dance")[1]; b.scrollIntoView({ block: "nearest" }); return b.getBoundingClientRect().toJSON(); })()`);
    check("each song has a labelled Dance button", (await cdp.ev(`document.querySelectorAll(".tv-songs-dance")[1].getAttribute("aria-label")`)) === "Dance to Brave Bridge Builder");
    await cdp.tapAt(older.x + older.width / 2, older.y + older.height / 2);
    check("Dance on the older song starts a party for THAT song", await waitFor(async () => ((await phase(cdp)) === "dancing" && (await cdp.ev(`document.querySelector(".tv-song-name")?.textContent`)) === "Brave Bridge Builder" ? true : null), { timeoutMs: 40000, label: "kept party" }).catch(() => false), await phase(cdp));
    check("its audio was fetched again through the relay, and no new song was ordered", route.audioFetches === fetchesBeforeDance + 1 && route.posts.length === postsBeforeDance, `${fetchesBeforeDance} -> ${route.audioFetches}, posts ${postsBeforeDance} -> ${route.posts.length}`);

    // an idea the route turns away
    await tap(cdp, ".tv-map-fab");
    await sleep(800);
    await tap(cdp, ".tv-map-songs");
    await sleep(800);
    await cdp.ev(`(() => { const i = document.querySelector(".tv-songs-input"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "a gun"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(200);
    const make2 = await centreOf(cdp, ".tv-songs-make");
    await cdp.tapAt(make2.x, make2.y);
    check("an idea the route refuses shows its own kind sentence and starts nothing", await waitFor(async () => ((await phase(cdp)) === "failed" && /different idea/.test(await cdp.ev(`document.querySelector(".tv-song-note")?.textContent`)) ? true : null), { timeoutMs: 10000, label: "refused idea" }).catch(() => false), await phase(cdp));
    check("no party and no song for it", (await world(cdp, `w.getMix().busyAction`)) !== "dance");

    check("no page exceptions (route ON)", cdp.exceptions.length === 0, cdp.exceptions.slice(0, 3).join(" | "));

    // ---- 7c. the weekly limit ----
    console.log("\n[7c] the weekly limit");
    check("every song request carried one device id (the weekly limit is per device)", route.devices.size === 1 && [...route.devices][0].length >= 8, JSON.stringify([...route.devices]));
    route.quota = { limit: 5, used: 5, left: 0, resetsOn: "2026-11-09", makerOn: true };
    await cdp.send("Page.reload");
    await waitFor(() => cdp.ev(`!!document.querySelector("canvas") && !!(window.__tvWorld && window.__tvWorld.props)`), { label: "reload" });
    await sleep(2500);
    await cdp.ev(`(() => { const t = document.querySelector("#title"); if (t && !t.hidden) document.querySelector("#play")?.click(); })()`);
    await sleep(1500);
    await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips after the reload" });
    check("the kept songs survived the reload", (await cdp.ev(`JSON.parse(localStorage.getItem("tv.themeSongs.v1") || "[]").length`)) >= 1);
    route.posts.length = 0;
    await win(cdp, "garden.bridge2");
    await sleep(3500);
    check("with no song left this week a win offers nothing", (await phase(cdp)) === "none", await phase(cdp));
    await shot(cdp, "7c-before-map");
    await tap(cdp, ".tv-map-fab");
    await sleep(1200);
    await shot(cdp, "7c-after-map-tap");
    if (!(await cdp.ev(`!!document.querySelector(".tv-map-songs")`))) throw new Error(`Map did not show Songs: buttons=${await cdp.ev(`[...document.querySelectorAll("button")].map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 24)).join(" | ")`)}`);
    route.probeDelayMs = 1800; // the route is slow to answer: what does the sheet say while it waits?
    await tap(cdp, ".tv-map-songs");
    await sleep(500);
    check("while the route has not answered the sheet says it is checking, never that songs are resting", (await cdp.ev(`document.querySelector(".tv-songs-lead")?.getAttribute("data-mode")`)) === "checking" && !/resting/.test(await cdp.ev(`document.querySelector("[data-testid=songs-sheet]")?.innerText ?? ""`)), await cdp.ev(`document.querySelector("[data-testid=songs-sheet]")?.innerText ?? ""`));
    await sleep(2200);
    route.probeDelayMs = 0;
    check("the Songs sheet says there are no new songs until Monday and offers no Make button", /until Monday/.test(await cdp.ev(`document.querySelector(".tv-songs-lead")?.textContent ?? ""`)) && (await cdp.ev(`!document.querySelector(".tv-songs-make")`)));
    check("the songs already made are still listed to dance to", (await cdp.ev(`document.querySelectorAll(".tv-songs-item").length`)) >= 1);
    route.quota = { limit: 5, used: 2, left: 3, resetsOn: "2026-11-09", makerOn: true };
    await tap(cdp, "[data-testid=songs-sheet] .tv-ctl"); // Back
    await sleep(500);
    await tap(cdp, ".tv-map-songs");
    await sleep(900);
    check("with three songs left the sheet counts them", /3 new songs left this week/.test(await cdp.ev(`document.querySelector(".tv-songs-note")?.textContent ?? ""`)), await cdp.ev(`document.querySelector(".tv-songs-note")?.textContent ?? ""`));
    await shot(cdp, "7c-songs-left");
    route.quota = { limit: 5, used: 0, left: 5, resetsOn: "2026-11-09", makerOn: false };
    await tap(cdp, "[data-testid=songs-sheet] .tv-ctl");
    await sleep(500);
    await tap(cdp, ".tv-map-songs");
    await sleep(900);
    check("with songs switched off by a grown-up the sheet says so and offers no Make button", /switched off by a grown-up/.test(await cdp.ev(`document.querySelector(".tv-songs-lead")?.textContent ?? ""`)) && (await cdp.ev(`!document.querySelector(".tv-songs-make")`)));
    route.quota = null;

    // ---- 8. the route is OFF: no offer, nothing posted ----
    console.log("\n[8] the route is off");
    route.enabled = false; route.posts.length = 0; route.probes = 0; const warmsBeforeOff = route.warms;
    await loadApp(cdp);
    await win(cdp);
    await sleep(3000);
    check("a win offers nothing when theme songs are off", (await phase(cdp)) === "none", await phase(cdp));
    check("it asked once (the free probe) and posted nothing", route.probes === 1 && route.posts.length === 0, `${route.probes} ${route.posts.length}`);
    check("and with theme songs off nothing was woken either", route.warms === warmsBeforeOff, `${warmsBeforeOff} -> ${route.warms}`);
    const mapOff = await centreOf(cdp, ".tv-map-fab");
    await cdp.tapAt(mapOff.x, mapOff.y);
    await sleep(900);
    const songsOff = await centreOf(cdp, ".tv-map-songs");
    await cdp.tapAt(songsOff.x, songsOff.y);
    await sleep(900);
    check("with theme songs off the Songs sheet says it is resting and offers nothing to make", /resting/.test(await cdp.ev(`document.querySelector(".tv-songs-lead")?.textContent ?? ""`)) && (await cdp.ev(`!document.querySelector(".tv-songs-make") && !document.querySelector(".tv-songs-input")`)));
    check("it still shows My songs (empty here)", /No songs yet/.test(await cdp.ev(`document.querySelector(".tv-songs-empty")?.textContent ?? ""`)));
    // ---- 9. the Grown-ups sheet has a Songs section ----
    console.log("\n[9] the Grown-ups sheet");
    route.enabled = true; route.settings = { makerOn: true, limit: 3 }; route.settingsReads = 0; route.settingsPosts = 0; route.quota = null;
    const seed = `try { sessionStorage.setItem("toyforge:parent-controls:v1", "off"); localStorage.setItem("toyforge:demo-mode:v1", "1"); } catch (e) {}`;
    const { identifier: seedId } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: seed });
    await cdp.send("Page.navigate", { url: APP });
    await waitFor(() => cdp.ev(`!!document.querySelector("canvas") && !!document.querySelector(".tv-ctl-gear")`), { label: "the game with the grown-up checks off" });
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedId });
    await sleep(2500);
    await cdp.ev(`(() => { const t = document.querySelector("#title"); if (t && !t.hidden) document.querySelector("#play")?.click(); })()`);
    await sleep(1200);
    await cdp.ev(`document.querySelector(".tv-ctl-gear").click(); 0`);
    check("the sheet opens straight onto the settings (the checks are off in this tab)", await waitFor(async () => (await cdp.ev(`!!document.querySelector(".tv-parent-modal [data-testid=song-settings]")`)) || null, { timeoutMs: 15000, label: "songs section" }).catch(() => false));
    await sleep(500);
    const sec = (q) => cdp.ev(`document.querySelector("[data-testid=song-settings] ${q}")?.textContent ?? null`);
    check("it shows the maker on and the weekly limit read from the Worker", (await cdp.ev(`document.querySelector("[data-testid=song-settings]").innerText`)).includes("Song maker: On") && (await sec("[data-testid=song-limit]")) === "3");
    check("its buttons are labelled and the section says what it does", (await cdp.ev(`!!document.querySelector('[data-testid=song-settings] [aria-label="Fewer songs a week"]') && !!document.querySelector('[data-testid=song-settings] [aria-label="More songs a week"]')`)) && /written and sung by AI/.test(await cdp.ev(`document.querySelector("[data-testid=song-settings]").innerText`)));
    await cdp.ev(`document.querySelector("[data-testid=song-settings]").scrollIntoView({ block: "center" }); 0`);
    await shot(cdp, "9-grownups-songs");
    await cdp.ev(`document.querySelector('[data-testid=song-settings] [aria-label="More songs a week"]').click(); 0`);
    await sleep(600);
    check("in this tab the unlock is the local-only one, so the change is NOT sent and the grown-up is told to unlock first", route.settingsPosts === 0 && /Unlock with the grown-up check/.test(await cdp.ev(`document.querySelector("[data-testid=song-settings]").innerText`)) && (await sec("[data-testid=song-limit]")) === "3");
    check("no page exceptions (grown-ups sheet)", cdp.exceptions.length === 0, cdp.exceptions.slice(0, 3).join(" | "));

    // with the route off the section is simply not there
    route.enabled = false;
    await cdp.send("Page.reload");
    await waitFor(() => cdp.ev(`!!document.querySelector("canvas") && !!document.querySelector(".tv-ctl-gear")`), { label: "reload (route off)" });
    await sleep(2500);
    await cdp.ev(`(() => { const t = document.querySelector("#title"); if (t && !t.hidden) document.querySelector("#play")?.click(); })()`);
    await sleep(1200);
    await cdp.ev(`document.querySelector(".tv-ctl-gear").click(); 0`);
    await sleep(2500);
    check("with theme songs off the Grown-ups sheet has no Songs section at all", (await cdp.ev(`!!document.querySelector(".tv-parent-modal")`)) && (await cdp.ev(`!document.querySelector("[data-testid=song-settings]")`)));

    check("no page exceptions (route OFF)", cdp.exceptions.length === 0, cdp.exceptions.slice(0, 3).join(" | "));
    killAll();
  } catch (err) {
    check("e2e ran to completion", false, String(err && err.stack || err));
    killAll();
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main();
