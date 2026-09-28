-- ====================================================================
-- NashmiOps Enterprise - Concurrency Control & Row-Level Queue Locking
-- Migration: 20261008_queue_row_level_locks_skip_locked.sql
-- 
-- 1. Atomic Batch Claim with SELECT ... FOR UPDATE SKIP LOCKED
-- 2. Prevents race conditions and duplicate processing across concurrent Serverless Lambdas
-- 3. Supports JoFotara Invoice Retries, WhatsApp Retries, and Failed Outbound Messages
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Claim Pending WhatsApp Retries (SKIP LOCKED)
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_pending_whatsapp_retries(
  p_clinic_id TEXT DEFAULT NULL,
  p_batch_size INT DEFAULT 50
)
RETURNS SETOF whatsapp_message_retries
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_effective_clinic_id TEXT;
BEGIN
  v_effective_clinic_id := COALESCE(
    p_clinic_id,
    NULLIF(current_setting('app.current_clinic_id', true), ''),
    'clinic-amman-nashmi-001'
  );

  RETURN QUERY
  WITH locked_items AS (
    SELECT id
    FROM whatsapp_message_retries
    WHERE clinic_id = v_effective_clinic_id
      AND status = 'PENDING'
      AND next_retry_at <= NOW()
    ORDER BY next_retry_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE whatsapp_message_retries target
  SET 
    status = 'PROCESSING',
    updated_at = NOW()
  FROM locked_items li
  WHERE target.id = li.id
  RETURNING target.*;
END;
$$;

-- --------------------------------------------------------------------
-- 2. Claim Pending JoFotara Invoice Retries (SKIP LOCKED)
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_pending_jofotara_retries(
  p_clinic_id TEXT DEFAULT NULL,
  p_batch_size INT DEFAULT 50
)
RETURNS SETOF jofotara_invoice_retries
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_effective_clinic_id TEXT;
BEGIN
  v_effective_clinic_id := COALESCE(
    p_clinic_id,
    NULLIF(current_setting('app.current_clinic_id', true), ''),
    'clinic-amman-nashmi-001'
  );

  RETURN QUERY
  WITH locked_items AS (
    SELECT id
    FROM jofotara_invoice_retries
    WHERE clinic_id = v_effective_clinic_id
      AND status = 'PENDING'
      AND next_retry_at <= NOW()
    ORDER BY next_retry_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE jofotara_invoice_retries target
  SET 
    status = 'PROCESSING',
    updated_at = NOW()
  FROM locked_items li
  WHERE target.id = li.id
  RETURNING target.*;
END;
$$;

-- --------------------------------------------------------------------
-- 3. Claim Pending Failed Outbound Messages (SKIP LOCKED)
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_pending_failed_outbound_messages(
  p_clinic_id TEXT DEFAULT NULL,
  p_batch_size INT DEFAULT 50
)
RETURNS SETOF failed_outbound_messages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_effective_clinic_id TEXT;
BEGIN
  v_effective_clinic_id := COALESCE(
    p_clinic_id,
    NULLIF(current_setting('app.current_clinic_id', true), ''),
    'clinic-amman-nashmi-001'
  );

  RETURN QUERY
  WITH locked_items AS (
    SELECT id
    FROM failed_outbound_messages
    WHERE clinic_id = v_effective_clinic_id
      AND status = 'PENDING_HUMAN_REVIEW'
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE failed_outbound_messages target
  SET 
    status = 'PROCESSING'
  FROM locked_items li
  WHERE target.id = li.id
  RETURNING target.*;
END;
$$;
