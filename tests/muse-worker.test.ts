import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMuseSpark } from "../worker/muse";

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
});
