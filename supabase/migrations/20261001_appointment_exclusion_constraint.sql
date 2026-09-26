-- ====================================================================
-- NashmiOps Enterprise (MVP Edition) - Database Concurrency & Deduplication Migration
-- 1. PostgreSQL Exclusion Constraint (Zero Double-Booking Guard with 15-min Sterilization Buffer)
-- 2. Webhook Event Deduplication Table (Processed Message ID Registry)
-- ====================================================================

-- 1. Enable btree_gist extension for combined equality and range exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Processed Webhook Messages Table (Serverless Deduplication)
CREATE TABLE IF NOT EXISTS processed_webhook_messages (
  id TEXT PRIMARY KEY, -- WhatsApp Message ID (wamid.HBgM...)
  sender_phone TEXT,
  message_type TEXT DEFAULT 'text',
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'PROCESSED'
);

-- Index for deduplication lookup & TTL cleanup
CREATE INDEX IF NOT EXISTS idx_processed_webhook_messages_processed_at 
  ON processed_webhook_messages(processed_at);

-- 3. Strict Concurrency & Double-Booking Exclusion Constraint
-- Ensures at the PostgreSQL database engine level that no two active appointments
-- (covering start_time through the 15-minute sterilization_end_time buffer)
-- can ever be concurrently inserted or booked for the same clinic.
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_overlapping_appointments_per_clinic'
  ) THEN
    ALTER TABLE appointments 
    ADD CONSTRAINT no_overlapping_appointments_per_clinic 
    EXCLUDE USING gist (
      clinic_id WITH =,
      practitioner_id WITH =,
      tstzrange(start_time, sterilization_end_time) WITH &&
    )
    WHERE (status != 'CANCELLED');
  END IF;
END $$;

-- 4. Fast Query Index for Real-Time Slot Overlap Lookups
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_active_times 
  ON appointments (clinic_id, start_time, sterilization_end_time) 
  WHERE (status != 'CANCELLED');

-- 5. Row Level Security for Processed Webhook Messages
ALTER TABLE processed_webhook_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY processed_webhook_messages_policy ON processed_webhook_messages
  FOR ALL
  USING (true);
