-- Extend loan records with explicit repayment and interest cadence.
-- Existing records are preserved and legacy interest_period values are copied to the new field.
ALTER TABLE loans ADD COLUMN due_date TEXT
  CHECK (due_date IS NULL OR (length(due_date) = 10 AND due_date GLOB '????-??-??'));
ALTER TABLE loans ADD COLUMN repayment_timing_note TEXT;
ALTER TABLE loans ADD COLUMN repayment_frequency TEXT NOT NULL DEFAULT 'one_time'
  CHECK (repayment_frequency IN ('one_time', 'daily', 'weekly', 'biweekly', 'monthly'));
ALTER TABLE loans ADD COLUMN installment_count INTEGER
  CHECK (installment_count IS NULL OR installment_count > 0);
ALTER TABLE loans ADD COLUMN installment_amount_minor INTEGER
  CHECK (installment_amount_minor IS NULL OR installment_amount_minor > 0);
ALTER TABLE loans ADD COLUMN interest_frequency TEXT NOT NULL DEFAULT 'one_time'
  CHECK (interest_frequency IN ('one_time', 'daily', 'weekly', 'monthly', 'annual'));

UPDATE loans SET interest_frequency = interest_period;
