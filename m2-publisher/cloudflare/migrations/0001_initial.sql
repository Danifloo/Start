CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL COLLATE NOCASE UNIQUE,
  story_key TEXT NOT NULL UNIQUE,
  caption TEXT NOT NULL,
  source_url TEXT NOT NULL,
  image_rights TEXT NOT NULL,
  images_json TEXT NOT NULL,
  scheduled_ms INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'SCHEDULED',
  container_id TEXT,
  media_id TEXT,
  permalink TEXT,
  last_error TEXT,
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_status_schedule ON posts(status, scheduled_ms);
CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_ms INTEGER NOT NULL,
  action TEXT NOT NULL,
  post_id TEXT,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_limits (
  fingerprint TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_started_ms INTEGER NOT NULL
);
