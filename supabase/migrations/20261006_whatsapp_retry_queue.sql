-- ====================================================================
-- NashmiOps Enterprise - WhatsApp Outbound Retry Queue & Exponential Backoff
-- Migration: 20261006_whatsapp_retry_queue.sql
-- 
-- 1. WhatsApp Outbound Message Retries Table
-- 2. Exponential Backoff Indexing for Background Cron Workers
-- 3. Row-Level Security for Clinic Multi-Tenancy
-- ====================================================================

CREATE TABLE IF NOT EXISTS whatsapp_message_retries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  message_text TEXT NOT NULL,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 5,
  last_error TEXT,
  status TEXT DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED
  next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_retries_status_next 
  ON whatsapp_message_retries(status, next_retry_at);

ALTER TABLE whatsapp_message_retries ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinic_isolation_whatsapp_retries ON whatsapp_message_retries
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  )
  WITH CHECK (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );
