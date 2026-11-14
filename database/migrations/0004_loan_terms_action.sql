PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_pending_actions_status_expiry;
ALTER TABLE pending_actions RENAME TO pending_actions_old;

CREATE TABLE pending_actions (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'create_borrower',
    'create_loan',
    'record_payment',
    'update_borrower',
    'archive_borrower',
    'update_loan_terms'
  )),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirming', 'confirmed', 'rejected', 'failed')),
  result_entity_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TEXT
);

INSERT INTO pending_actions (
  id, action_type, payload_json, status, result_entity_id, expires_at, created_at, confirmed_at
)
SELECT id, action_type, payload_json, status, result_entity_id, expires_at, created_at, confirmed_at
FROM pending_actions_old;

DROP TABLE pending_actions_old;
CREATE INDEX idx_pending_actions_status_expiry ON pending_actions(status, expires_at);

PRAGMA foreign_keys = ON;
