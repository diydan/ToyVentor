import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMuseSpark } from "../worker/muse";
import type { BackendEnv } from "../worker/modelBackend";

const RECIPE = {
  format: "toyventor.level/1",
  id: "kid-world",
  name: "Garden of lanterns",
  theme: "garden",
  props: [{ type: "lantern", x: 12 }],
  spots: [{ part: "character.hat.flower", hide: "scarecrow", x: 6 }],
};

function stubModel(text: string, status = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text }] }] }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function post(body: unknown): Request {
  return new Request("https://toyventor.com/api/muse/spark", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("muse spark route", () => {
  it("returns the recipe and a warm line", async () => {
    const fetchMock = stubModel(JSON.stringify({ say: "I made you a garden!", recipe: RECIPE }));
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden with lanterns", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { say: string; recipe: { theme: string } };
    expect(body.say).toBe("I made you a garden!");
    expect(body.recipe.theme).toBe("garden");
    // The model call must carry the kid-safe rules.
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(call[1].body));
    expect(sent.model).toBe("muse-spark-1.3");
    expect(sent.input).toContain("ages 4 to 10");
    expect(sent.input).toContain("a garden with lanterns");
  });

  it("reads output_text as well as the raw output array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ output_text: JSON.stringify({ say: "ok", recipe: RECIPE }) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "hello", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(200);
  });

  it("cleans em dashes out of what a kid reads", async () => {
    stubModel(JSON.stringify({ say: "Here you go \u2014 a garden!", recipe: RECIPE }));
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    const body = (await res.json()) as { say: string };
    expect(body.say).not.toContain("\u2014");
    expect(body.say).toContain(",");
  });

  it("refuses a recipe the game could not load", async () => {
    stubModel(JSON.stringify({ say: "ok", recipe: { format: "something/else" } }));
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(502);
  });

  it("refuses models other than muse-spark", async () => {
    const res = await handleMuseSpark(
      post({ model: "muse-wonder-1.0", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(422);
  });

  it("needs an input, a json body, and a configured key", async () => {
    expect((await handleMuseSpark(post({ model: "muse-spark" }), { MODEL_API_KEY: "k" })).status).toBe(422);
    expect(
      (
        await handleMuseSpark(
          new Request("https://toyventor.com/api/muse/spark", {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: "hi",
          }),
          { MODEL_API_KEY: "k" },
        )
      ).status,
    ).toBe(415);
    expect((await handleMuseSpark(post({ model: "muse-spark", input: "hi" }), {})).status).toBe(503);
  });

  it("replaces a say line that fails the kid-safe text check", async () => {
    stubModel(JSON.stringify({ say: "A scary haunted place, visit evil.example now!", recipe: RECIPE }));
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { say: string };
    expect(body.say).toBe("Here is your world!");
  });

  it("replaces a recipe name that fails the kid-safe text check", async () => {
    stubModel(JSON.stringify({ say: "ok", recipe: { ...RECIPE, name: "Haunted blood land" } }));
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    const body = (await res.json()) as { recipe: { name: string } };
    expect(body.recipe.name).toBe("My world");
  });

  it("replaces a say line that repeats the child's own words", async () => {
    stubModel(JSON.stringify({ say: "You said my secret treehouse password is bananas!", recipe: RECIPE }));
    const res = await handleMuseSpark(
      post({
        model: "muse-spark",
        input: 'Rules here.\nThe child said: "my secret treehouse password is bananas"',
        format: "json",
      }),
      { MODEL_API_KEY: "test-key" },
    );
    const body = (await res.json()) as { say: string };
    expect(body.say).toBe("Here is your world!");
  });

  it("retries without the reasoning parameter after a 400", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (bodies.length === 1) return new Response("unknown parameter", { status: 400 });
        return new Response(
          JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ say: "ok", recipe: RECIPE }) }] }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(200);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("reasoning");
    expect(bodies[1]).not.toHaveProperty("reasoning");
  });

  it("does not retry when the time budget is already spent", async () => {
    const now = vi.spyOn(Date, "now");
    let tick = 1_000_000;
    now.mockImplementation(() => tick);
    const fetchMock = vi.fn(async () => {
      tick += 60_000;
      return new Response("unknown parameter", { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    now.mockRestore();
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks our own model again when the proxy drops the connection before any token", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) return new Response("upstream reset", { status: 500 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ say: "ok", recipe: RECIPE }) } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const selfEnv: BackendEnv = {
      MODEL_BACKEND: "self",
      SELF_TEXT_URL: "https://glimmer.example.test/v1",
      SELF_TEXT_MODEL: "muse-glimmer-30B",
      SELF_TEXT_API: "chat",
    };
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden", format: "json" }),
      selfEnv,
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps upstream error details out of the browser response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid api key sk-SECRETDETAIL", { status: 500 })),
    );
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("SECRETDETAIL");
    expect(text).not.toContain("invalid api key");
  });

  it("keeps fetch failure details out of the browser response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("dial tcp 10.0.0.9:443 SECRETDETAIL");
      }),
    );
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("SECRETDETAIL");
  });

  it("redacts contact details before the words reach the model", async () => {
    let sent = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body)).input as string;
        return new Response(
          JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ say: "ok", recipe: RECIPE }) }] }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const res = await handleMuseSpark(
      post({
        model: "muse-spark",
        input: 'A garden please. My email is sam@example.com and my number is 555-123-4567.',
        format: "json",
      }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(200);
    expect(sent).not.toContain("sam@example.com");
    expect(sent).not.toContain("555-123-4567");
    expect(sent).toContain("[email removed]");
    expect(sent).toContain("[number removed]");
    expect(sent).toContain("A garden please.");
  });

  it("answers a GET with the route status for the deploy check", async () => {
    const res = await handleMuseSpark(
      new Request("https://toyventor.com/api/muse/spark"),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; configured: boolean };
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(true);
  });

  it("answers 429 past ten requests a minute from one IP, without calling upstream", async () => {
    const fetchMock = stubModel(JSON.stringify({ say: "ok", recipe: RECIPE }));
    const withIp = (body: unknown) =>
      new Request("https://toyventor.com/api/muse/spark", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" },
        body: JSON.stringify(body),
      });
    const statuses: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const res = await handleMuseSpark(
        withIp({ model: "muse-spark", input: "a garden", format: "json" }),
        { MODEL_API_KEY: "test-key" },
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10)).toEqual(new Array(10).fill(200));
    expect(statuses.slice(10)).toEqual(new Array(5).fill(429));
    expect(fetchMock).toHaveBeenCalledTimes(10);
    const rejected = await handleMuseSpark(
      withIp({ model: "muse-spark", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(await rejected.text()).toContain("one world at a time");
  });

  it("clamps recipe coordinates into the playable strip", async () => {
    stubModel(
      JSON.stringify({
        say: "ok",
        recipe: {
          ...RECIPE,
          props: [{ type: "lantern", x: 99999 }],
          spots: [{ part: "character.hat.flower", hide: "scarecrow", x: -5 }],
        },
      }),
    );
    const res = await handleMuseSpark(
      post({ model: "muse-spark", input: "a garden", format: "json" }),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recipe: { props: { x: number }[]; spots: { x: number }[] };
    };
    expect(body.recipe.props[0]?.x).toBe(45);
    expect(body.recipe.spots[0]?.x).toBe(0);
  });

  it("rejects a chunked body over the byte cap without buffering it", async () => {
    const big = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"input":"${"x".repeat(100_000)}"}`));
        controller.close();
      },
    });
    const res = await handleMuseSpark(
      new Request("https://toyventor.com/api/muse/spark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: big,
        duplex: "half",
      } as RequestInit),
      { MODEL_API_KEY: "test-key" },
    );
    expect(res.status).toBe(413);
  });
});
