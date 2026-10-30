import { describe, expect, it } from "vitest";
import { isPlayerId, validateOwnershipRecord } from "../shared/ownership";
import worker from "../worker/index";
import type { D1Like } from "../worker/ownership";

const toy = {
  id: "toy-1", name: "Cup", kind: "other", sizeClass: "small",
  lengthMm: 110, widthMm: 55,
  attachPoints: [{ id: "top", label: "Top" }], source: "scan",
};
const DEVICE = "12345678-1234-1234-1234-123456789abc";

/** Tiny in-memory D1 stand-in keyed like the real primary key. */
function fakeDb(): D1Like {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    prepare: (sql) => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (sql.startsWith("INSERT")) {
            const [player, type, id, payload] = values as [string, string, string, string];
            rows.set(`${player}|${type}|${id}`, { item_type: type, item_id: id, payload });
          } else if (sql.startsWith("DELETE")) {
            const [player, type, id] = values as [string, string, string];
            rows.delete(`${player}|${type}|${id}`);
          }
          return {};
        },
        all: async () => {
          const [player] = values as [string];
          return {
            results: [...rows.entries()]
              .filter(([k]) => k.startsWith(`${player}|`))
              .map(([, v]) => v),
          };
        },
      }),
    }),
  };
}

const call = (env: object, path: string, init: RequestInit = {}) =>
  worker.fetch(
    new Request(`http://local${path}`, {
      ...init,
      headers: { "x-device-id": DEVICE, "content-type": "application/json", ...(init.headers ?? {}) },
    }),
    env as never,
  );

describe("validation", () => {
  it("accepts good ids and rejects traversal-y ones", () => {
    expect(isPlayerId(DEVICE)).toBe(true);
    expect(isPlayerId("../../etc/passwd0000")).toBe(false);
    expect(isPlayerId("short")).toBe(false);
    expect(isPlayerId(null)).toBe(false);
  });
  it("rejects unknown types and oversized payloads", () => {
    expect(validateOwnershipRecord({ type: "gold", id: "x" }).join(" ")).toMatch(/type/);
    expect(validateOwnershipRecord({ type: "part", id: "p", payload: "x".repeat(500_000) }).join(" ")).toMatch(/over/);
    expect(validateOwnershipRecord({ type: "part", id: "p" })).toEqual([]);
  });
  it("accepts progression payloads in the character lane", () => {
    expect(
      validateOwnershipRecord({
        type: "character",
        id: "progression:v1",
        payload: { totalXp: 42, missionStars: {} },
      }),
    ).toEqual([]);
  });
});

describe("/api/ownership", () => {
  it("returns 501 local-only without a DB binding", async () => {
    const res = await call({}, "/api/ownership");
    expect(res.status).toBe(501);
  });

  it("round-trips a toy and isolates players", async () => {
    const env = { DB: fakeDb() };
    const post = await call(env, "/api/ownership", {
      method: "POST",
      body: JSON.stringify({ type: "toy", id: toy.id, payload: toy }),
    });
    expect(post.status).toBe(200);
    const list = (await (await call(env, "/api/ownership")).json()) as { items: unknown[] };
    expect(list.items).toEqual([{ type: "toy", id: "toy-1", payload: toy }]);

    const other = await worker.fetch(
      new Request("http://local/api/ownership", {
        headers: { "x-device-id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
      }),
      env as never,
    );
    expect(((await other.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it("rejects bad toy payloads and deletes", async () => {
    const env = { DB: fakeDb() };
    const bad = await call(env, "/api/ownership", {
      method: "POST",
      body: JSON.stringify({ type: "toy", id: "x", payload: { id: "x" } }),
    });
    expect(bad.status).toBe(422);

    await call(env, "/api/ownership", {
      method: "POST",
      body: JSON.stringify({ type: "part", id: "p1" }),
    });
    const del = await call(env, "/api/ownership/part/p1", { method: "DELETE" });
    expect(del.status).toBe(200);
    const list = (await (await call(env, "/api/ownership")).json()) as { items: unknown[] };
    expect(list.items).toEqual([]);
  });

  it("self-bootstraps when a fresh local D1 lacks the ownership table", async () => {
    let tableReady = false;
    const base = fakeDb();
    const unmigrated: D1Like = {
      prepare: (sql) => ({
        bind: (...values: unknown[]) => ({
          run: async () => {
            if (sql.startsWith("CREATE TABLE")) {
              tableReady = true;
              return {};
            }
            if (sql.startsWith("CREATE INDEX")) return {};
            if (!tableReady) throw new Error("D1_ERROR: no such table: ownership: SQLITE_ERROR");
            return base.prepare(sql).bind(...values).run();
          },
          all: async () => {
            if (!tableReady) throw new Error("D1_ERROR: no such table: ownership: SQLITE_ERROR");
            return base.prepare(sql).bind(...values).all();
          },
        }),
      }),
    };

    const getRes = await call({ DB: unmigrated }, "/api/ownership");
    expect(getRes.status).toBe(200);
    expect(tableReady).toBe(true);
    expect(await getRes.json()).toEqual({ items: [] });
  });

  it("returns 503 local-only JSON instead of throwing on unexpected D1 errors", async () => {
    const broken: D1Like = {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            throw new Error("D1_ERROR: disk I/O error");
          },
          all: async () => {
            throw new Error("D1_ERROR: disk I/O error");
          },
        }),
      }),
    };
    const res = await call({ DB: broken }, "/api/ownership");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "ownership store unavailable",
      mode: "local-only",
    });
  });
});
