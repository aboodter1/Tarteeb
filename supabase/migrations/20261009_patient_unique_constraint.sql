-- ====================================================================
-- NashmiOps Enterprise - Idempotent Patient Creation & Concurrency Guard
-- Migration: 20261009_patient_unique_constraint.sql
-- 
-- 1. Creates a compound unique index on (clinic_id, whatsapp_phone, full_name)
-- 2. Prevents race conditions and duplicate patient profile creation across concurrent webhooks
-- 3. Supports soft-delete compliance (WHERE is_deleted = false) under Law No. 25
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Unique Partial Index on Active Patients
-- --------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_clinic_phone_name_unique
ON patients (clinic_id, whatsapp_phone, full_name)
WHERE is_deleted = false;

-- --------------------------------------------------------------------
-- 2. Fast Lookup Index for WhatsApp Inbound Webhooks
-- --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_patients_lookup_phone
ON patients (clinic_id, whatsapp_phone)
WHERE is_deleted = false;

COMMENT ON INDEX idx_patients_clinic_phone_name_unique IS 'Guarantees idempotency during concurrent patient booking webhooks.';
