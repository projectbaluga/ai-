PRAGMA foreign_keys = ON;

CREATE TABLE pending_actions (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL CHECK (action_type IN ('create_borrower', 'create_loan', 'record_payment')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirming', 'confirmed', 'rejected', 'failed')),
  result_entity_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TEXT
);

CREATE INDEX idx_pending_actions_status_expiry ON pending_actions(status, expires_at);
