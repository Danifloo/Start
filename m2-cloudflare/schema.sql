PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  story_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_date TEXT NOT NULL,
  rights TEXT NOT NULL,
  images_json TEXT NOT NULL,
  scheduled_at TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','CLAIMED','VERIFYING','PUBLISHED','QUOTA_PAUSED','REVIEW_REQUIRED','MISSED','CANCELLED')),
  container_id TEXT,
  media_id TEXT,
  permalink TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_due ON posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
