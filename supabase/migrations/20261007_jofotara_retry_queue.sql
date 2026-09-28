-- ====================================================================
-- NashmiOps Enterprise - ISTD JoFotara Persistent Invoice Retry Queue
-- Migration: 20261007_jofotara_retry_queue.sql
-- 
-- 1. Persistent Storage for Invoices Pending National Tax Gateway Clearance
-- 2. Exponential Backoff & Cold-Start Resilience for Serverless Lambdas
-- 3. Multi-Tenant RLS by Clinic ID
-- ====================================================================

CREATE TABLE IF NOT EXISTS jofotara_invoice_retries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  invoice_type TEXT NOT NULL,
  payload JSONB NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_jofotara_retries_clinic_inv 
  ON jofotara_invoice_retries(clinic_id, invoice_number);

ALTER TABLE jofotara_invoice_retries ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinic_isolation_jofotara_retries ON jofotara_invoice_retries
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  )
  WITH CHECK (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );
