-- M2 Publisher · Cloudflare D1 (SQLite). Apply BEFORE deployment.
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  topic_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  source_url TEXT NOT NULL,
  rights TEXT NOT NULL,
  images_json TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN
    ('QUEUED','SENDING','PREPARING','PUBLISHING','VERIFYING','PUBLISHED','UNCERTAIN','MISSED','NEEDS_REVIEW')),
  meta_container_id TEXT,
  meta_media_id TEXT,
  permalink TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_due ON posts(status,scheduled_at);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_recent ON events(created_at DESC);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
