-- Theme songs: the weekly quota per device and the monthly budget for everyone (rules in shared/songQuota.ts, SQL in worker/songStore.ts), and a grown-up's choices.
-- The Worker also creates these on first use when the migration has not been applied yet (CREATE TABLE IF NOT EXISTS, as the parent tables do), so applying it is
-- a tidy-up and not a prerequisite. Nothing here holds a child's name, words or audio: a song's name and words live in `payload` only so a retried tap gets the same song back.
CREATE TABLE IF NOT EXISTS song_reservations (
  key TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  month_key TEXT NOT NULL,
  songs INTEGER NOT NULL,
  state TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  refund_reason TEXT,
  task TEXT,
  payload TEXT,
  stored INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_song_res_device_week ON song_reservations (device_id, week_key);
CREATE INDEX IF NOT EXISTS idx_song_res_month ON song_reservations (month_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_song_res_task ON song_reservations (task) WHERE task IS NOT NULL;

CREATE TABLE IF NOT EXISTS song_settings (
  device_id TEXT PRIMARY KEY,
  maker_on INTEGER,
  weekly_limit INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
