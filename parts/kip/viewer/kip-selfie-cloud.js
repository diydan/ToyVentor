// Opt-in "Smart face": the ONLY selfie code that talks to a server. Everything else (kip-selfie.js, kip-selfie-image.js) stays on the device.
//
// What it does, and only after a grown-up has said yes on the consent screen and passed the app's parent gate:
//   - faceParts: send ONE resized JPEG of the current picture; the server asks Meta's SAM 3.1 where the eyes and mouth are and
//     returns three points (fractions of the picture), which the selfie uses for its "line up" step.
//   - cartoon: send ONE resized JPEG; the server asks Muse Image to redraw it as a flat cartoon and returns that picture.
//
// Rules (tested in tests/kip-selfie-cloud.test.ts and scripts/e2e-kip-selfie.mjs):
//   - Nothing is sent unless one of these methods is called, and the selfie only calls them after the consent screen and the gate.
//   - Same-origin relative URLs only, to the three endpoints below. No cookies, no storage writes, no URL or #toy= field ever holds
//     image data. The one storage access is a READ of the app's anonymous device id, so the grown-up PIN set in the app applies.
//   - The proof token from the parent gate lives in this closure only (a few minutes), never anywhere else.
//   - The picture is resized to at most MAX_SIDE px and re-encoded as JPEG before it leaves; the server rejects anything bigger.
//   - The server's answers are never shown raw: every status maps to one calm sentence for a child (describeStatus).

export const CONSENT_VERSION = 'v1';
export const ENDPOINTS = Object.freeze({
  gate: '/api/parent/gate',
  faceParts: '/api/selfie/face-parts',
  cartoon: '/api/selfie/cartoon',
});
export const MAX_SIDE = 768;
export const JPEG_QUALITY = 0.85;
/** The app's anonymous device id lives under this key (src/lib/sync.ts). */
export const DEVICE_KEY = 'toyforge:device:v1';

const DEVICE_RE = /^[A-Za-z0-9-]{16,64}$/;

/** One calm sentence per server status. Unknown statuses read as "unavailable". */
export function describeStatus(status) {
  switch (status) {
    case 'disabled': return 'The online helper is not turned on here. You can still tap the eyes and mouth yourself.';
    case 'gate-required': return 'The grown-up check ran out. Please ask a grown-up again.';
    case 'consent-required': return 'A grown-up needs to say yes first.';
    case 'slow-down': return 'Too many tries. Please wait a minute and try again.';
    case 'too-large':
    case 'invalid': return 'That picture could not be sent. Try another one.';
    case 'no-match': return 'The helper could not find the eyes and mouth. Tap them yourself with Line up eyes & mouth.';
    case 'offline': return 'No connection to the online helper. You can still tap the eyes and mouth yourself.';
    default: return 'The online helper is busy. You can still tap the eyes and mouth yourself.';
  }
}

/** Reads the app's device id; never writes. Returns null when there is none (or storage is blocked). */
export function readDeviceId(storage) {
  try {
    const s = storage ?? globalThis.localStorage;
    const v = s && s.getItem(DEVICE_KEY);
    return v && DEVICE_RE.test(v) ? v : null;
  } catch { return null; }
}

/** The picture as a JPEG data URL no bigger than `maxSide` on its long side (a canvas or ImageBitmap-like source). */
export function toJpegDataUrl(source, maxSide = MAX_SIDE, quality = JPEG_QUALITY) {
  const k = Math.min(1, maxSide / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * k)), h = Math.max(1, Math.round(source.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); // JPEG has no transparency
  g.drawImage(source, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality);
}

/** Bytes a data URL's base64 payload decodes to. */
export function dataUrlBytes(dataUrl) {
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : '';
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

/**
 * The cloud client. `fetchImpl` and `deviceId` are injectable for tests. `now` is injectable for proof expiry.
 * Every method resolves to a plain object with a `status` and never throws on a network or server problem.
 */
export function createSelfieCloud({ fetchImpl, deviceId, now = () => Date.now() } = {}) {
  const doFetch = fetchImpl ?? ((...a) => fetch(...a));
  const sessionId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `session-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  const device = deviceId ?? (() => readDeviceId() ?? sessionId);
  let proof = null; // { token, expiresAt }: memory only

  const base = () => ({ 'content-type': 'application/json', 'x-device-id': device() });
  const proofLive = () => Boolean(proof && proof.expiresAt > now() + 5000);

  async function post(url, headers, body, signal) {
    let res;
    try {
      res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', signal });
    } catch (e) {
      return { status: e && e.name === 'AbortError' ? 'aborted' : 'offline', http: 0 };
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    return { http: res.status, data };
  }

  return {
    hasProof: proofLive,
    clearProof() { proof = null; },

    /** Ask the app's parent gate for a question: { mode: 'math' | 'pin', a, b, challengeToken } or { status }. */
    async challenge(signal) {
      const r = await post(ENDPOINTS.gate, base(), { action: 'challenge' }, signal);
      if (r.status) return { status: r.status };
      const d = r.data;
      if (r.http === 200 && d && typeof d.a === 'number' && typeof d.b === 'number' && typeof d.challengeToken === 'string') {
        return { status: 'ok', mode: d.mode === 'pin' ? 'pin' : 'math', a: d.a, b: d.b, challengeToken: d.challengeToken, cooldownUntil: d.cooldownUntil ?? null };
      }
      return { status: r.http === 501 ? 'disabled' : 'unavailable' };
    },

    /** Answer the question (math) or type the PIN. On success the proof is kept in memory. */
    async verify({ challengeToken, answer, pin }, signal) {
      const body = typeof pin === 'string' ? { action: 'verify', pin } : { action: 'verify', challengeToken, answer: Number(answer) };
      const r = await post(ENDPOINTS.gate, base(), body, signal);
      if (r.status) return { status: r.status };
      const d = r.data;
      if (r.http === 200 && d && d.ok && typeof d.proofToken === 'string') {
        proof = { token: d.proofToken, expiresAt: Number(d.expiresAt) || now() + 120000 };
        return { status: 'ok' };
      }
      if (r.http === 403) return { status: 'wrong', attemptsRemaining: d && d.attemptsRemaining, retryAfterSeconds: d && d.retryAfterSeconds, cooldown: Boolean(d && d.error === 'pin_cooldown') };
      return { status: 'unavailable' };
    },

    /** Eyes and mouth of the picture, as fractions: { status: 'ok', eyes: [{x,y},{x,y}], mouth: {x,y} } or { status }. */
    async faceParts(imageDataUrl, signal) {
      return call(ENDPOINTS.faceParts, imageDataUrl, signal, (d) => (d.eyes && d.mouth ? { eyes: d.eyes, mouth: d.mouth } : null));
    },

    /** The picture redrawn as a cartoon: { status: 'ok', image: dataUrl } or { status }. */
    async cartoon(imageDataUrl, signal) {
      return call(ENDPOINTS.cartoon, imageDataUrl, signal, (d) => (typeof d.image === 'string' && d.image.startsWith('data:image/') ? { image: d.image } : null));
    },
  };

  async function call(url, imageDataUrl, signal, pick) {
    if (!proofLive()) return { status: 'gate-required' };
    const headers = { ...base(), 'x-parent-proof': proof.token, 'x-selfie-consent': CONSENT_VERSION };
    const r = await post(url, headers, { image: imageDataUrl }, signal);
    if (r.status) return { status: r.status };
    const d = r.data && typeof r.data === 'object' ? r.data : {};
    if (r.http === 401 || d.status === 'gate-required') { proof = null; return { status: 'gate-required' }; }
    if (r.http === 200 && d.status === 'ok') {
      const got = pick(d);
      return got ? { status: 'ok', ...got } : { status: 'unavailable' };
    }
    return { status: typeof d.status === 'string' ? d.status : 'unavailable' };
  }
}
