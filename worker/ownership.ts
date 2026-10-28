// Ownership API backed by D1. Player identity is an anonymous device
// UUID in the x-device-id header today; real accounts map onto the same
// player_id column later without a schema change.
import {
  isPlayerId,
  validateOwnershipRecord,
  ITEM_TYPES,
  type OwnedItemType,
  type OwnershipRecord,
} from "../shared/ownership";
import { validateToy } from "../shared/toy";

/** Minimal D1 surface this module uses (avoids a types dependency). */
export interface D1Like {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<unknown>;
      all: () => Promise<{ results: Record<string, unknown>[] }>;
    };
  };
}

export interface OwnershipEnv {
  DB?: D1Like;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleOwnership(
  request: Request,
  env: OwnershipEnv,
  rest: string,
): Promise<Response> {
  if (!env.DB) return json({ error: "ownership store not bound", mode: "local-only" }, 501);
  const playerId = request.headers.get("x-device-id");
  if (!isPlayerId(playerId)) return json({ error: "missing or invalid x-device-id" }, 400);
  const db = env.DB;

  if (request.method === "GET" && rest === "") {
    const { results } = await db
      .prepare("SELECT item_type, item_id, payload FROM ownership WHERE player_id = ? ORDER BY created_at")
      .bind(playerId)
      .all();
    const items = results.map((row) => {
      let payload: unknown;
      try {
        payload = typeof row.payload === "string" ? JSON.parse(row.payload) : undefined;
      } catch {
        payload = undefined; // corrupt row degrades to id-only, never throws
      }
      return { type: row.item_type, id: row.item_id, ...(payload !== undefined ? { payload } : {}) };
    });
    return json({ items });
  }

  if (request.method === "POST" && rest === "") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    const errors = validateOwnershipRecord(body);
    if (errors.length > 0) return json({ error: "invalid record", errors }, 422);
    const record = body as OwnershipRecord;
    if (record.type === "toy") {
      const toyErrors = validateToy(record.payload);
      if (toyErrors.length > 0) return json({ error: "invalid toy payload", errors: toyErrors }, 422);
    }
    await db
      .prepare(
        "INSERT INTO ownership (player_id, item_type, item_id, payload) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(player_id, item_type, item_id) DO UPDATE SET payload = excluded.payload",
      )
      .bind(playerId, record.type, record.id, record.payload === undefined ? null : JSON.stringify(record.payload))
      .run();
    console.log(JSON.stringify({ event: "ownership_put", type: record.type }));
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const [type, id] = rest.replace(/^\//, "").split("/");
    if (!ITEM_TYPES.includes(type as OwnedItemType) || !id)
      return json({ error: "expected /api/ownership/:type/:id" }, 422);
    await db
      .prepare("DELETE FROM ownership WHERE player_id = ? AND item_type = ? AND item_id = ?")
      .bind(playerId, type, decodeURIComponent(id))
      .run();
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}
