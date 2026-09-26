-- NashmiOps Enterprise (Phase 2) - Clinical EHR, Dental Charting & Multi-Practitioner Roster
-- Compliant with Jordanian Medical and Health Liability Law No. 25 of 2018

-- 1. PRACTITIONERS ROSTER TABLE
CREATE TABLE IF NOT EXISTS practitioners (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  specialty TEXT NOT NULL,
  specialty_ar TEXT NOT NULL,
  phone TEXT,
  license_number TEXT,
  color_code TEXT DEFAULT '#0d9488',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practitioners_clinic ON practitioners(clinic_id, is_active);

-- 2. DENTAL CHAIRS TABLE
CREATE TABLE IF NOT EXISTS dental_chairs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  chair_number INT NOT NULL,
  name_ar TEXT NOT NULL,
  description_ar TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chairs_clinic ON dental_chairs(clinic_id, is_active);

-- 3. ENHANCE APPOINTMENTS TABLE FOR ROSTER
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS practitioner_id TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS practitioner_name TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS chair_id TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS chair_number INT;

CREATE INDEX IF NOT EXISTS idx_appointments_practitioner ON appointments(clinic_id, practitioner_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_chair ON appointments(clinic_id, chair_id, start_time);

-- 4. CLINICAL EHR & DENTAL CHARTING TABLE (Law No. 25 of 2018)
CREATE TABLE IF NOT EXISTS clinical_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id),
  practitioner_id TEXT REFERENCES practitioners(id),
  practitioner_name TEXT,
  chief_complaint TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  clinical_notes TEXT NOT NULL,
  treatment_rendered TEXT NOT NULL,
  prescriptions JSONB DEFAULT '[]'::jsonb,
  odontogram JSONB DEFAULT '[]'::jsonb,
  allergies TEXT[] DEFAULT ARRAY[]::TEXT[],
  chronic_conditions TEXT[] DEFAULT ARRAY[]::TEXT[],
  informed_consent_signed BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinical_records_patient ON clinical_records(clinic_id, patient_id, created_at DESC);

-- 5. ENABLE ROW LEVEL SECURITY
ALTER TABLE practitioners ENABLE ROW LEVEL SECURITY;
ALTER TABLE dental_chairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_records ENABLE ROW LEVEL SECURITY;

-- 6. MULTI-TENANT ISOLATION POLICIES
CREATE POLICY clinic_isolation_practitioners ON practitioners
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  )
  WITH CHECK (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );

CREATE POLICY clinic_isolation_dental_chairs ON dental_chairs
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  )
  WITH CHECK (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );

CREATE POLICY clinic_isolation_clinical_records ON clinical_records
  FOR ALL
  USING (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  )
  WITH CHECK (
    clinic_id = COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')
  );

