import { beforeEach, describe, expect, it, vi } from "vitest";

// Service-worker strategy tests. The worker source (public/sw.js) registers
// on a stubbed ServiceWorkerGlobalScope; each test drives the captured
// install/fetch listeners with a scripted network.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => unknown;

const listeners: Record<string, AnyHandler[]> = {};
const store = new Map<string, string>();
const network = new Map<string, string>();
const pendingPuts: Promise<unknown>[] = [];
let networkHits = 0;
let networkDown = false;

function installFakes(): void {
  vi.stubGlobal("self", {
    location: { origin: "http://localhost:4173" },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    addEventListener: (type: string, fn: AnyHandler) => {
      listeners[type] ??= [];
      listeners[type].push(fn);
    },
  });
  const cacheStub = {
    match: async (req: Request | string): Promise<Response | undefined> => {
      const url = typeof req === "string" ? req : req.url;
      const body = store.get(url);
      return body === undefined ? undefined : new Response(body, { status: 200 });
    },
    put: (req: Request, res: Response): Promise<void> => {
      const done = res
        .clone()
        .text()
        .then((body) => {
          store.set(req.url, body);
        });
      pendingPuts.push(done);
      return done;
    },
    addAll: async (urls: string[]): Promise<void> => {
      for (const u of urls) {
        const absolute = new URL(u, "http://localhost:4173").href;
        const res = await fetch(absolute);
        if (!res.ok) throw new TypeError(`precache failed: ${u}`);
        store.set(absolute, await res.text());
      }
    },
  };
  vi.stubGlobal("caches", {
    open: async () => cacheStub,
    keys: async () => ["toyventor-stale-test"],
    delete: async () => true,
    match: (req: Request) => cacheStub.match(req),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string): Promise<Response> => {
      const url = typeof input === "string" ? input : input.url;
      networkHits += 1;
      if (networkDown) throw new Error("offline");
      const body = network.get(url);
      if (body === undefined) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200 });
    }),
  );
}

installFakes();
// The worker is plain JS with no types; side-effect import registers it on the stub.
// @ts-ignore - no declaration file for the service worker source
await import("../public/sw.js");

function dispatch(type: string, event: object): void {
  for (const fn of listeners[type] ?? []) fn(event);
}

async function install(): Promise<void> {
  let pending: Promise<unknown> = Promise.resolve();
  dispatch("install", { waitUntil: (p: Promise<unknown>) => (pending = p) });
  await pending;
  await Promise.resolve();
  await Promise.resolve();
}

async function fetchThrough(url: string, mode = "navigate"): Promise<Response | null> {
  const request = new Request(url);
  Object.defineProperty(request, "mode", { value: mode });
  let answered: Promise<Response> | null = null;
  dispatch("fetch", {
    request,
    respondWith: (p: Promise<Response>) => (answered = p),
  });
  const result = answered ? await answered : null;
  // Let floating cache.put() writes land before the next request.
  for (let i = 0; i < 50 && pendingPuts.length > 0; i += 1) {
    await Promise.all(pendingPuts.splice(0));
    await new Promise((r) => setImmediate(r));
  }
  return result;
}

beforeEach(() => {
  store.clear();
  network.clear();
  networkHits = 0;
  networkDown = false;
  network.set("http://localhost:4173/", "shell-v1");
  network.set("http://localhost:4173/manifest.webmanifest", "{}");
  network.set("http://localhost:4173/icon.svg", "<svg></svg>");
});

describe("service worker cache strategy", () => {
  it("serves the fresh shell after a redeploy, not the cached copy", async () => {
    network.set("http://localhost:4173/", "shell-v1");
    network.set("http://localhost:4173/manifest.webmanifest", "{}");
    network.set("http://localhost:4173/icon.svg", "<svg></svg>");
    await install();
    expect(await (await fetchThrough("http://localhost:4173/"))?.text()).toBe("shell-v1");

    network.set("http://localhost:4173/", "shell-v2");
    expect(await (await fetchThrough("http://localhost:4173/"))?.text()).toBe("shell-v2");
  });

  it("falls back to the cached shell when offline", async () => {
    network.set("http://localhost:4173/", "shell-v1");
    network.set("http://localhost:4173/manifest.webmanifest", "{}");
    network.set("http://localhost:4173/icon.svg", "<svg></svg>");
    await install();
    networkDown = true;
    expect(await (await fetchThrough("http://localhost:4173/"))?.text()).toBe("shell-v1");
  });

  it("keeps immutable build assets cache-first", async () => {
    network.set("http://localhost:4173/assets/app.js", "bytes-v1");
    await install();
    networkHits = 0;
    expect(await (await fetchThrough("http://localhost:4173/assets/app.js", "no-cors"))?.text())
      .toBe("bytes-v1");
    network.set("http://localhost:4173/assets/app.js", "bytes-v2");
    expect(await (await fetchThrough("http://localhost:4173/assets/app.js", "no-cors"))?.text())
      .toBe("bytes-v1");
    expect(networkHits).toBe(1);
  });

  it("leaves api, cross-origin and the worker itself on the network", async () => {
    await install();
    expect(await fetchThrough("http://localhost:4173/api/scan", "no-cors")).toBeNull();
    expect(await fetchThrough("https://cdn.example.com/lib.js", "no-cors")).toBeNull();
    expect(await fetchThrough("http://localhost:4173/sw.js", "no-cors")).toBeNull();
  });
});
