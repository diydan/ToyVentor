// A D1 stand-in on real SQLite (node:sqlite), so a migration and the SQL in worker/songStore.ts are run for real, not guessed at.
// Only what the Worker uses: prepare(sql).bind(...).run() / .all() / .first(). Throws the same "no such table" message D1 does.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export interface SqliteD1 {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<{ success: true; meta: { changes: number } }>;
      all: () => Promise<{ results: Record<string, unknown>[] }>;
      first: () => Promise<Record<string, unknown> | null>;
    };
  };
  /** The statements run so far, newest last (a test can count them). */
  log: string[];
  /** Plain access for assertions. */
  raw: DatabaseSync;
}

export function sqliteD1(opts: { migrations?: string[] } = {}): SqliteD1 {
  const db = new DatabaseSync(":memory:");
  for (const file of opts.migrations ?? []) db.exec(fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8"));
  const log: string[] = [];
  return {
    log,
    raw: db,
    prepare: (sql) => ({
      bind: (...values) => {
        const args = values.map((v) => (v === undefined ? null : v)) as never[];
        return {
          run: async () => { log.push(sql); const r = db.prepare(sql).run(...args); return { success: true as const, meta: { changes: Number(r.changes) } }; },
          all: async () => { log.push(sql); return { results: db.prepare(sql).all(...args) as Record<string, unknown>[] }; },
          first: async () => { log.push(sql); return (db.prepare(sql).get(...args) as Record<string, unknown> | undefined) ?? null; },
        };
      },
    }),
  };
}
