PRAGMA foreign_keys = ON;

CREATE TABLE borrowers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);

CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  borrower_id TEXT NOT NULL REFERENCES borrowers(id),
  principal_minor INTEGER NOT NULL CHECK (principal_minor > 0),
  currency TEXT NOT NULL DEFAULT 'PHP',
  interest_type TEXT NOT NULL DEFAULT 'none'
    CHECK (interest_type IN ('none', 'fixed', 'percentage')),
  interest_value REAL NOT NULL DEFAULT 0 CHECK (interest_value >= 0),
  interest_period TEXT NOT NULL DEFAULT 'one_time'
    CHECK (interest_period IN ('one_time', 'monthly')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paid', 'void')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL REFERENCES loans(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  paid_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_borrowers_name ON borrowers(full_name);
CREATE INDEX idx_loans_borrower ON loans(borrower_id);
CREATE INDEX idx_payments_loan_paid_at ON payments(loan_id, paid_at);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
