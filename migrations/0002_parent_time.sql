-- Parent time gates & daily STEM earned-time ledger.
-- Keyed by (player_id, day) in the family's stored IANA timezone so unused or
-- earned minutes never roll over across local midnight.
CREATE TABLE IF NOT EXISTS parent_settings (
  player_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_ledger (
  player_id TEXT NOT NULL,
  day TEXT NOT NULL,
  used_seconds INTEGER NOT NULL DEFAULT 0,
  earned_minutes INTEGER NOT NULL DEFAULT 0,
  extra_parent_minutes INTEGER NOT NULL DEFAULT 0,
  session_used_seconds INTEGER NOT NULL DEFAULT 0,
  completed_ids TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, day)
);

CREATE INDEX IF NOT EXISTS idx_time_ledger_player ON time_ledger (player_id);
