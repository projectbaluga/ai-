CREATE TABLE IF NOT EXISTS login_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  updated_at INTEGER NOT NULL
);
