-- Ownership: what each player (anonymous device id for now) owns.
-- Payload carries the full toy/character JSON so a new device can
-- rebuild its Toybox from the server; parts/skins reference set ids.
CREATE TABLE IF NOT EXISTS ownership (
  player_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('toy', 'part', 'skin', 'character')),
  item_id TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_ownership_player ON ownership (player_id);
