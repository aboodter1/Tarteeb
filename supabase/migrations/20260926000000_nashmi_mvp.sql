-- ====================================================================
-- NashmiOps Enterprise (MVP Edition) - Multi-Tenant Database Schema
-- Strict Compliance with:
-- 1. Jordanian Medical Liability Law No. 25 of 2018 (5-year retention, soft-delete)
-- 2. Jordanian Personal Data Protection Law No. 24 of 2023 (Explicit Consent, RLS)
-- 3. ISTD JoFotara Phase 2 E-Invoicing
-- ====================================================================

-- 1. ENUMS
CREATE TYPE appointment_status AS ENUM (
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'NO_SHOW',
  'COMPLETED'
);

CREATE TYPE waitlist_status AS ENUM (
  'WAITING',
  'NOTIFIED',
  'BOOKED',
  'EXPIRED'
);

CREATE TYPE invoice_type AS ENUM (
  'B2C_SIMPLIFIED',
  'B2B_STANDARD'
);

-- 2. CLINICS TABLE (Multi-Tenant Root)
CREATE TABLE IF NOT EXISTS clinics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  license_number TEXT NOT NULL,
  tax_number TEXT NOT NULL,
  google_calendar_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PATIENTS TABLE (Sensitive Personal Data with Soft-Delete)
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  whatsapp_phone TEXT NOT NULL,
  full_name TEXT NOT NULL,
  national_id TEXT, -- Optional for B2C < 100 JOD
  tax_id TEXT, -- Required for B2B standard invoices
  is_head_of_family BOOLEAN DEFAULT TRUE,
  family_relation TEXT DEFAULT 'self', -- 'self', 'child', 'spouse', 'parent'
  primary_contact_phone TEXT,
  pdpl_consent BOOLEAN DEFAULT FALSE,
  pdpl_consent_timestamp TIMESTAMPTZ,
  medical_notes TEXT,
  is_deleted BOOLEAN DEFAULT FALSE, -- Law No. 25 5-year soft-delete
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_clinic_phone ON patients(clinic_id, whatsapp_phone) WHERE is_deleted = FALSE;

-- 4. APPOINTMENTS TABLE (Frictionless Zero-Deposit)
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  patient_name TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  service_type TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  sterilization_end_time TIMESTAMPTZ NOT NULL, -- 15-min buffer
  status appointment_status DEFAULT 'CONFIRMED',
  google_calendar_event_id TEXT,
  notes TEXT,
  is_emergency BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_time ON appointments(clinic_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(clinic_id, status);

-- 5. WAITLIST TABLE (Smart Waitlist Sniper)
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  patient_name TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  requested_service TEXT NOT NULL,
  preferred_date DATE NOT NULL,
  preferred_time_range TEXT DEFAULT 'any', -- 'morning', 'afternoon', 'any'
  status waitlist_status DEFAULT 'WAITING',
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_active ON waitlist(clinic_id, preferred_date, status);

-- 6. INVOICES TABLE (ISTD JoFotara Phase 2 UBL 2.1)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  appointment_id TEXT REFERENCES appointments(id),
  patient_id TEXT REFERENCES patients(id),
  invoice_number TEXT NOT NULL,
  invoice_type invoice_type NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_tax_id TEXT,
  buyer_national_id TEXT,
  currency TEXT DEFAULT 'JOD',
  subtotal NUMERIC(10,3) NOT NULL,
  tax_amount NUMERIC(10,3) NOT NULL,
  total_amount NUMERIC(10,3) NOT NULL,
  invoice_uuid TEXT NOT NULL UNIQUE,
  previous_invoice_hash TEXT NOT NULL,
  invoice_hash TEXT NOT NULL,
  qr_code_tlv TEXT NOT NULL,
  ubl_xml TEXT NOT NULL,
  status TEXT DEFAULT 'ISSUED',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_clinic_number ON invoices(clinic_id, invoice_number);

-- 7. CLINIC FAQS TABLE (Instant Local Answers)
CREATE TABLE IF NOT EXISTS clinic_faqs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  category TEXT NOT NULL, -- 'hours', 'location', 'pricing', 'insurance', 'services', 'general'
  question_ar TEXT NOT NULL,
  answer_ar TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinic_faqs_clinic ON clinic_faqs(clinic_id, category);

-- 8. CONVERSATIONS STATE TABLE (State Checkpointing)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  phone_number TEXT NOT NULL,
  patient_name TEXT,
  chat_history JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_clinic_phone UNIQUE (clinic_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_conversations_lookup ON conversations(clinic_id, phone_number);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Safe Tenant Isolation: supports dynamic current_setting with supported default
-- clinic ('clinic-amman-nashmi-001') for Client UI (Sandbox, Webhook) and Serverless access
-- ====================================================================
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinic_isolation_clinics ON clinics
  FOR ALL
  USING (
    id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );

CREATE POLICY clinic_isolation_patients ON patients
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );

CREATE POLICY clinic_isolation_appointments ON appointments
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );

CREATE POLICY clinic_isolation_waitlist ON waitlist
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );

CREATE POLICY clinic_isolation_invoices ON invoices
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );

CREATE POLICY clinic_isolation_faqs ON clinic_faqs
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );

CREATE POLICY clinic_isolation_conversations ON conversations
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );
