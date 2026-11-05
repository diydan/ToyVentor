-- Accounts groundwork (docs/specs/accounts-and-new-user-spec.md 2.4). INERT: the Worker never reads or writes these tables unless ACCOUNTS=on (worker/accounts.ts).
-- A grown-up signs in with an emailed one-time link; a child is a profile under a family and never has an email or a login. 0001 to 0003 are never edited:
-- `device_claims` is a MAPPING from a device id to a family; nothing in `ownership`, `parent_settings`, `time_ledger` or `song_*` is re-keyed or copied.
-- No address is stored: `email_hash` is the SHA-256 of the lower-cased address (with an optional secret pepper). Link and session tokens are stored only as their SHA-256.
-- All times are epoch milliseconds. Every statement is CREATE ... IF NOT EXISTS, and worker/accounts.ts runs the same statements on first use, so applying this file is tidy, not required.
CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, created_ms INTEGER NOT NULL, timezone TEXT, deleted_ms INTEGER);
CREATE TABLE IF NOT EXISTS parents (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, email_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK (role IN ('parent', 'self')), created_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_parents_family ON parents (family_id);
CREATE TABLE IF NOT EXISTS children (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, first_name TEXT NOT NULL, favourites_json TEXT NOT NULL, under13 INTEGER NOT NULL, created_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_children_family ON children (family_id);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, parent_id TEXT NOT NULL, family_id TEXT NOT NULL, created_ms INTEGER NOT NULL, last_used_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions (parent_id);
CREATE TABLE IF NOT EXISTS login_links (token_hash TEXT PRIMARY KEY, email_hash TEXT NOT NULL, role TEXT NOT NULL, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, used_ms INTEGER);
CREATE INDEX IF NOT EXISTS idx_login_links_email ON login_links (email_hash);
CREATE TABLE IF NOT EXISTS device_claims (device_id TEXT PRIMARY KEY, family_id TEXT NOT NULL, claimed_by TEXT NOT NULL, claimed_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_device_claims_family ON device_claims (family_id);
CREATE TABLE IF NOT EXISTS consents (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, kind TEXT NOT NULL, at_ms INTEGER NOT NULL, version INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_consents_family ON consents (family_id);
CREATE TABLE IF NOT EXISTS account_rate (bucket TEXT NOT NULL, key TEXT NOT NULL, window_ms INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (bucket, key, window_ms));
