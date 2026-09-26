-- NashmiOps Enterprise (MVP Edition) - Dead-Letter Outbound Messages Table
-- Logs outbound WhatsApp message dispatch failures (e.g. 24h window expiration, token issues)
-- for immediate escalation and human reception staff follow-up.

CREATE TABLE IF NOT EXISTS failed_outbound_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  message_text TEXT NOT NULL,
  error_reason TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING_HUMAN_REVIEW', -- PENDING_HUMAN_REVIEW, RESOLVED, DISCARDED
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for reception dashboard queries
CREATE INDEX IF NOT EXISTS idx_failed_outbound_clinic_created 
  ON failed_outbound_messages (clinic_id, created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE failed_outbound_messages ENABLE ROW LEVEL SECURITY;

-- Multi-tenant isolation policy
CREATE POLICY clinic_isolation_failed_outbound ON failed_outbound_messages
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  )
  WITH CHECK (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );
