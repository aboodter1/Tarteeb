-- ====================================================================
-- NashmiOps Enterprise - Atomic Appointment Booking & Serverless Integrity
-- Migration: 20261005_atomic_appointment_booking.sql
-- 
-- 1. PostgreSQL Atomic RPC Booking Function (book_appointment_atomic)
-- 2. Strict Row-Level Lock & Exclusion Violation (23P01) Handling
-- 3. Elimination of Serverless Distributed Split-Brain Conditions
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Ensure composite exclusion constraint is active on appointments table
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

-- 2. Atomic Appointment Booking RPC Function
-- Executes the overlap check and insertion within a single atomic database transaction.
CREATE OR REPLACE FUNCTION book_appointment_atomic(p_appointment JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_clinic_id TEXT;
  v_practitioner_id TEXT;
  v_chair_id TEXT;
  v_start_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
  v_sterilization_end_time TIMESTAMPTZ;
  v_conflict RECORD;
  v_inserted_record RECORD;
BEGIN
  v_clinic_id := p_appointment->>'clinic_id';
  v_practitioner_id := p_appointment->>'practitioner_id';
  v_chair_id := p_appointment->>'chair_id';
  v_start_time := (p_appointment->>'start_time')::TIMESTAMPTZ;
  v_end_time := (p_appointment->>'end_time')::TIMESTAMPTZ;
  v_sterilization_end_time := COALESCE(
    (p_appointment->>'sterilization_end_time')::TIMESTAMPTZ,
    v_end_time + INTERVAL '15 minutes'
  );

  -- Pre-insert concurrency lock and check against active overlapping appointments
  SELECT id, start_time, end_time, sterilization_end_time, practitioner_name, patient_name
  INTO v_conflict
  FROM appointments
  WHERE clinic_id = v_clinic_id
    AND status != 'CANCELLED'
    AND (
      (v_practitioner_id IS NOT NULL AND practitioner_id = v_practitioner_id)
      OR (v_chair_id IS NOT NULL AND chair_id = v_chair_id)
      OR (v_practitioner_id IS NULL AND v_chair_id IS NULL)
    )
    AND tstzrange(start_time, sterilization_end_time) && tstzrange(v_start_time, v_sterilization_end_time)
  LIMIT 1
  FOR SHARE;

  IF FOUND THEN
    RAISE EXCEPTION 'DOUBLE_BOOKING_CONFLICT: يتعارض الموعد مع حجز مسجل مسبقاً حتى الساعة % شاملاً فترة التعقيم الإلزامية.',
      to_char(v_conflict.sterilization_end_time AT TIME ZONE 'Asia/Amman', 'HH12:MI AM')
      USING ERRCODE = '23P01',
            DETAIL = json_build_object(
              'code', 'DOUBLE_BOOKING_CONFLICT',
              'conflicting_appointment_id', v_conflict.id,
              'sterilization_end_time', v_conflict.sterilization_end_time
            )::text;
  END IF;

  -- Atomic Insert with RETURNING
  INSERT INTO appointments (
    id,
    clinic_id,
    patient_id,
    patient_name,
    patient_phone,
    service_type,
    practitioner_id,
    practitioner_name,
    chair_id,
    chair_number,
    appointment_date,
    start_time,
    end_time,
    sterilization_end_time,
    status,
    notes,
    google_calendar_event_id,
    is_emergency,
    created_at,
    updated_at
  ) VALUES (
    COALESCE(p_appointment->>'id', 'appt-' || floor(extract(epoch from now()) * 1000)::text),
    v_clinic_id,
    p_appointment->>'patient_id',
    p_appointment->>'patient_name',
    p_appointment->>'patient_phone',
    p_appointment->>'service_type',
    v_practitioner_id,
    p_appointment->>'practitioner_name',
    v_chair_id,
    (p_appointment->>'chair_number')::INT,
    COALESCE((p_appointment->>'appointment_date')::DATE, (v_start_time AT TIME ZONE 'Asia/Amman')::DATE),
    v_start_time,
    v_end_time,
    v_sterilization_end_time,
    COALESCE((p_appointment->>'status')::appointment_status, 'CONFIRMED'::appointment_status),
    p_appointment->>'notes',
    p_appointment->>'google_calendar_event_id',
    COALESCE((p_appointment->>'is_emergency')::BOOLEAN, FALSE),
    NOW(),
    NOW()
  )
  RETURNING * INTO v_inserted_record;

  RETURN to_jsonb(v_inserted_record);

EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'DOUBLE_BOOKING_CONFLICT: رفضت قاعدة البيانات الحجز لوجود تعارض زمني نشط (PostgreSQL Exclusion Constraint 23P01).'
      USING ERRCODE = '23P01',
            DETAIL = json_build_object('code', 'DOUBLE_BOOKING_CONFLICT')::text;
END;
$$;
