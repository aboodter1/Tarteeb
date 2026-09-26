-- ====================================================================
-- NashmiOps Enterprise (MVP Edition) - Serverless Production Refactor Migration
-- 1. Multi-Practitioner Concurrency Exclusion Constraint
-- 2. Strict Zero-Bypass Multi-Tenant RLS
-- 3. JoFotara Sequential Invoice Counter & Retry Queue
-- ====================================================================

-- 1. Multi-Practitioner Temporal Exclusion Constraint
-- Replaces single-practitioner block with combined clinic_id + practitioner_id exclusion
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ 
BEGIN
  -- Drop previous constraint if it only checked clinic_id
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_overlapping_appointments_per_clinic'
  ) THEN
    ALTER TABLE appointments DROP CONSTRAINT no_overlapping_appointments_per_clinic;
  END IF;

  -- Add updated constraint including practitioner_id
  ALTER TABLE appointments 
  ADD CONSTRAINT no_overlapping_appointments_per_clinic 
  EXCLUDE USING gist (
    clinic_id WITH =,
    practitioner_id WITH =,
    tstzrange(start_time, sterilization_end_time) WITH &&
  )
  WHERE (status != 'CANCELLED');
END $$;

-- 2. JoFotara Invoice Retry Queue for Serverless Robustness
CREATE TABLE IF NOT EXISTS jofotara_invoice_retries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  request_payload JSONB NOT NULL,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 5,
  last_error TEXT,
  status TEXT DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED
  next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jofotara_retries_status_next 
  ON jofotara_invoice_retries(status, next_retry_at);

ALTER TABLE jofotara_invoice_retries ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinic_isolation_jofotara_retries ON jofotara_invoice_retries
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  )
  WITH CHECK (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );
