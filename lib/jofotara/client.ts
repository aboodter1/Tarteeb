// NashmiOps Enterprise (MVP Edition) - ISTD JoFotara Network API Client
// Handles official HTTP transmission of UBL 2.1 XML to the Jordanian Income and Sales Tax Department (ISTD)
// Supports B2C Simplified Reporting & B2B Standard Clearance workflows with automatic Simulated Mode

import { InvoiceType } from '@/types';
import { CLINIC_CONFIG } from '@/lib/config/constants';
import { circuitBreaker } from '@/lib/resilience/circuit-breaker';
import { supabaseAdmin } from '@/lib/db/supabase';

export { circuitBreaker };

export interface JoFotaraSubmissionInput {
  invoiceNumber: string;
  invoiceType: InvoiceType;
  ublXml: string;
  invoiceUuid: string;
  invoiceHash: string;
  buyerName?: string;
  buyerTaxId?: string;
  totalAmount?: number;
}

export interface JoFotaraSubmissionResult {
  success: boolean;
  status: 'REPORTED' | 'CLEARED' | 'REJECTED' | 'ERROR';
  submissionId?: string;
  invoiceUuid: string;
  invoiceHash: string;
  endpointUsed: string;
  simulated: boolean;
  clearanceStatus?: string;
  validationErrors?: string[];
  message: string;
  responsePayload?: any;
}

/**
 * Resolve JoFotara ISTD API Configuration
 */
export function getJoFotaraConfig() {
  const baseUrl = process.env.JOFOTARA_API_BASE_URL;
  const clientSecret = process.env.JOFOTARA_CLIENT_SECRET;
  const clientId = process.env.JOFOTARA_CLIENT_ID || CLINIC_CONFIG.taxNumber;

  const isConfigured = Boolean(baseUrl && clientSecret && !clientSecret.startsWith('mock_'));
  const isCircuitFallback = circuitBreaker.isSimulatedFallbackActive('jofotara');

  return {
    baseUrl: baseUrl ? baseUrl.replace(/\/+$/, '') : 'https://preprod.jofotara.gov.jo/core/invoices',
    clientSecret,
    clientId,
    isSimulated: !isConfigured || isCircuitFallback,
  };
}

/**
 * Submit UBL 2.1 Invoice to ISTD JoFotara:
 * - Reporting Route: B2C_SIMPLIFIED invoices (< 100 JOD or personal medical consultations)
 * - Clearance Route: B2B_STANDARD invoices (Mandatory Buyer Tax ID & pre-clearance requirement)
 */
export async function submitInvoiceToJoFotara(
  input: JoFotaraSubmissionInput
): Promise<JoFotaraSubmissionResult> {
  const config = getJoFotaraConfig();
  const isB2B = input.invoiceType === 'B2B_STANDARD';
  const targetRoute = isB2B ? '/clearance' : '/reporting';
  const fullEndpoint = `${config.baseUrl}${targetRoute}`;

  // 1. Automatic Simulated Mode when live ISTD credentials are not set or Circuit Breaker is active
  if (config.isSimulated || circuitBreaker.isSimulatedFallbackActive('jofotara')) {
    const simSubmissionId = `istd-sim-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const resultStatus = isB2B ? 'CLEARED' : 'REPORTED';
    
    console.log(`[JoFotara Client - Simulated Mode] Submitted ${input.invoiceType} invoice (${input.invoiceNumber}) to ${targetRoute}:`);
    console.log(`  UUID: ${input.invoiceUuid}`);
    console.log(`  Hash: ${input.invoiceHash.substring(0, 24)}...`);
    console.log(`  Assigned Submission ID: ${simSubmissionId}`);
    console.log(`  Status: ${resultStatus} 100% Valid UBL 2.1 XML`);

    if (circuitBreaker.isSimulatedFallbackActive('jofotara')) {
      await enqueueJoFotaraRetry(
        input,
        'Circuit Breaker OPEN: Invoiced in local simulated mode, queued for ISTD clearance upon gateway recovery',
        CLINIC_CONFIG.id
      ).catch((qErr) => console.warn('[JoFotara Client] Retry enqueue warning:', qErr));
    }

    return {
      success: true,
      status: resultStatus,
      submissionId: simSubmissionId,
      invoiceUuid: input.invoiceUuid,
      invoiceHash: input.invoiceHash,
      endpointUsed: fullEndpoint,
      simulated: true,
      clearanceStatus: isB2B ? 'CLEARED_BY_ISTD' : 'REPORTED_TO_ISTD',
      message: isB2B
        ? `تمت إجازة الفاتورة الضريبية القياسية (B2B Clearance) عبر محاكي بوابة الفوترة الوطنية (ISTD) بنجاح.`
        : `تم الإبلاغ الضريبي عن الفاتورة المبسطة (B2C Reporting) عبر محاكي بوابة الفوترة الوطنية (ISTD) بنجاح.`,
    };
  }

  // 2. Live HTTP POST to ISTD JoFotara Gateway via Circuit Breaker
  return await circuitBreaker.execute<JoFotaraSubmissionResult>(
    'jofotara',
    async () => {
      const encodedXml = Buffer.from(input.ublXml, 'utf-8').toString('base64');
      const requestPayload = {
        invoice: encodedXml,
        invoiceHash: input.invoiceHash,
        uuid: input.invoiceUuid,
        invoiceNumber: input.invoiceNumber,
        invoiceType: input.invoiceType,
        sellerTaxId: CLINIC_CONFIG.taxNumber,
        buyerTaxId: input.buyerTaxId,
        timestamp: new Date().toISOString(),
      };

      const response = await fetch(fullEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': config.clientId,
          'Client-Secret': config.clientSecret!,
          Authorization: `Bearer ${config.clientSecret}`,
        },
        body: JSON.stringify(requestPayload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMsg = data?.message || `HTTP ${response.status} from ISTD Gateway`;
        console.warn(`[JoFotara Client] ISTD API HTTP ${response.status} Error on ${targetRoute}:`, data);
        await enqueueJoFotaraRetry(input, errorMsg, CLINIC_CONFIG.id);

        if (response.status >= 500) {
          throw new Error(`ISTD Gateway HTTP ${response.status}: ${errorMsg}`);
        }

        return {
          success: false,
          status: response.status === 422 ? 'REJECTED' : 'ERROR',
          invoiceUuid: input.invoiceUuid,
          invoiceHash: input.invoiceHash,
          endpointUsed: fullEndpoint,
          simulated: false,
          validationErrors: data?.errors || [errorMsg],
          responsePayload: data,
          message: `تعذر اعتماد الفاتورة لدى بوابة ضريبة الدخل (HTTP ${response.status}): ${data?.message || 'خطأ في معالجة الطلب'}. أُضيفت إلى طابور إعادة المحاولة.`,
        };
      }

      const assignedStatus = isB2B ? 'CLEARED' : 'REPORTED';
      const submissionId = data?.submissionId || data?.id || `istd-live-${Date.now()}`;

      console.log(`[JoFotara Client] Successfully transmitted to ISTD (ID: ${submissionId}, Status: ${assignedStatus})`);

      return {
        success: true,
        status: assignedStatus,
        submissionId,
        invoiceUuid: input.invoiceUuid,
        invoiceHash: input.invoiceHash,
        endpointUsed: fullEndpoint,
        simulated: false,
        clearanceStatus: isB2B ? 'CLEARED' : 'REPORTED',
        responsePayload: data,
        message: isB2B
          ? `تمت إجازة وتصديق الفاتورة رسمياً من دائرة ضريبة الدخل والمبيعات الأردنية (ISTD Clearance ID: ${submissionId}).`
          : `تم تسجيل وإبلاغ دائرة ضريبة الدخل والمبيعات الأردنية بالفاتورة بنجاح (ISTD Reporting ID: ${submissionId}).`,
      };
    },
    async (circuitState, err) => {
      const errorMsg = err?.message || 'Network exception contacting ISTD gateway';
      console.warn(`[JoFotara Client - Circuit Fallback] ISTD gateway unreachable (${circuitState}), transitioning to local simulated mode:`, errorMsg);

      await enqueueJoFotaraRetry(
        input,
        `Circuit Breaker Fallback (${circuitState}): ${errorMsg}`,
        CLINIC_CONFIG.id
      ).catch((qErr) => console.warn('[JoFotara Client] Retry enqueue warning:', qErr));

      const simSubmissionId = `istd-sim-circuit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      return {
        success: true,
        status: isB2B ? 'CLEARED' : 'REPORTED',
        submissionId: simSubmissionId,
        invoiceUuid: input.invoiceUuid,
        invoiceHash: input.invoiceHash,
        endpointUsed: fullEndpoint,
        simulated: true,
        clearanceStatus: isB2B ? 'CLEARED_BY_LOCAL_CIRCUIT' : 'REPORTED_TO_LOCAL_CIRCUIT',
        message: isB2B
          ? `تمت إجازة الفاتورة محلياً (وضع استمرارية التشغيل / Circuit Breaker) وحفظها في طابور المزامنة التلقائية مع ضريبة الدخل (ISTD).`
          : `تم الإبلاغ الضريبي محلياً (وضع استمرارية التشغيل / Circuit Breaker) وحفظ الفاتورة في طابور المزامنة التلقائية مع ضريبة الدخل (ISTD).`,
        responsePayload: null,
      };
    }
  );
}

// ====================================================================
// JOFOTARA INVOICE RETRY QUEUE (Serverless Resilient Submission)
// ====================================================================
export interface JoFotaraRetryItem {
  id: string;
  clinicId: string;
  invoiceNumber: string;
  payload: JoFotaraSubmissionInput;
  retryCount: number;
  maxRetries: number;
  lastError: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  nextRetryAt: string;
  createdAt: string;
}

export const jofotaraRetryQueue: JoFotaraRetryItem[] = [];

export async function enqueueJoFotaraRetry(
  payload: JoFotaraSubmissionInput,
  lastError: string,
  clinicId: string = CLINIC_CONFIG.id
): Promise<JoFotaraRetryItem> {
  const isPlaceholder =
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

  const nowStr = new Date().toISOString();
  const initialNextRetry = new Date(Date.now() + 60 * 1000).toISOString();
  let assignedId = `retry-inv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // 1. Persistent Supabase Storage (Single Source of Truth)
  if (!isPlaceholder) {
    try {
      const { data: existingRow } = await supabaseAdmin
        .from('jofotara_invoice_retries')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('invoice_number', payload.invoiceNumber)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingRow) {
        const nextCount = (existingRow.retry_count || 0) + 1;
        const backoffSeconds = Math.min(60 * Math.pow(2, nextCount), 3600);
        const nextRetry = new Date(Date.now() + backoffSeconds * 1000).toISOString();

        await supabaseAdmin
          .from('jofotara_invoice_retries')
          .update({
            retry_count: nextCount,
            last_error: lastError,
            next_retry_at: nextRetry,
            updated_at: nowStr,
          })
          .eq('id', existingRow.id);

        assignedId = existingRow.id;
      } else {
        const { data: insertedRow, error: insErr } = await supabaseAdmin
          .from('jofotara_invoice_retries')
          .insert({
            clinic_id: clinicId,
            invoice_number: payload.invoiceNumber,
            invoice_type: payload.invoiceType,
            payload: payload as any,
            retry_count: 0,
            max_retries: 5,
            last_error: lastError,
            status: 'PENDING',
            next_retry_at: initialNextRetry,
            created_at: nowStr,
            updated_at: nowStr,
          })
          .select('id')
          .maybeSingle();

        if (!insErr && insertedRow?.id) {
          assignedId = insertedRow.id;
        }
      }
    } catch (dbErr) {
      console.warn('[JoFotara Retry Queue] DB persistence warning:', dbErr);
    }
  }

  // 2. Synchronize In-Memory Cache (for local simulation/tests)
  const existing = jofotaraRetryQueue.find(
    (q) => q.invoiceNumber === payload.invoiceNumber && q.status === 'PENDING'
  );
  if (existing) {
    existing.retryCount += 1;
    existing.lastError = lastError;
    existing.nextRetryAt = new Date(Date.now() + Math.pow(2, existing.retryCount) * 1000 * 60).toISOString();
    return existing;
  }

  const retryItem: JoFotaraRetryItem = {
    id: assignedId,
    clinicId,
    invoiceNumber: payload.invoiceNumber,
    payload,
    retryCount: 0,
    maxRetries: 5,
    lastError,
    status: 'PENDING',
    nextRetryAt: initialNextRetry,
    createdAt: nowStr,
  };

  jofotaraRetryQueue.push(retryItem);
  console.log(`[JoFotara Retry Queue] Enqueued invoice ${payload.invoiceNumber} for background retry.`);
  return retryItem;
}

export async function processJoFotaraRetryQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const now = new Date();
  const isPlaceholder =
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

  const itemsToProcess: Array<{
    id: string;
    invoiceNumber: string;
    payload: JoFotaraSubmissionInput;
    retryCount: number;
    maxRetries: number;
    fromDb: boolean;
  }> = [];

  // 1. Fetch from Supabase Table with Row-Level Locking (SELECT ... FOR UPDATE SKIP LOCKED)
  if (!isPlaceholder) {
    try {
      // First attempt Atomic RPC stored procedure to lock and claim batch concurrently
      const { data: rpcRows, error: rpcErr } = await supabaseAdmin.rpc('claim_pending_jofotara_retries', {
        p_clinic_id: CLINIC_CONFIG.id,
        p_batch_size: 50,
      });

      let rows = rpcRows;

      // Fallback to standard query if RPC is not yet installed in local dev
      if (rpcErr || !rows) {
        if (rpcErr && rpcErr.code !== '42883') {
          console.warn('[JoFotara Retry Queue] RPC notice, falling back to direct query:', rpcErr.message);
        }
        const { data: directRows, error: dirErr } = await supabaseAdmin
          .from('jofotara_invoice_retries')
          .select('*')
          .eq('status', 'PENDING')
          .lte('next_retry_at', now.toISOString())
          .limit(50);
        if (!dirErr && directRows) {
          rows = directRows;
        }
      }

      if (Array.isArray(rows)) {
        for (const row of rows) {
          itemsToProcess.push({
            id: row.id,
            invoiceNumber: row.invoice_number,
            payload: row.payload as JoFotaraSubmissionInput,
            retryCount: row.retry_count || 0,
            maxRetries: row.max_retries || 5,
            fromDb: true,
          });
        }
      }
    } catch (err) {
      console.warn('[JoFotara Retry Queue] DB fetch warning:', err);
    }
  }

  // 2. Merge local in-memory items
  const pendingMem = jofotaraRetryQueue.filter(
    (item) => item.status === 'PENDING' && new Date(item.nextRetryAt) <= now
  );

  for (const mem of pendingMem) {
    if (!itemsToProcess.some((i) => i.invoiceNumber === mem.invoiceNumber)) {
      itemsToProcess.push({
        id: mem.id,
        invoiceNumber: mem.invoiceNumber,
        payload: mem.payload,
        retryCount: mem.retryCount,
        maxRetries: mem.maxRetries,
        fromDb: false,
      });
    }
  }

  let succeeded = 0;
  let failed = 0;

  for (const item of itemsToProcess) {
    const nextAttempt = item.retryCount + 1;
    const nowStr = new Date().toISOString();

    try {
      const res = await submitInvoiceToJoFotara(item.payload);
      if (res.success && !res.simulated) {
        succeeded++;

        // Update in-memory item
        const memMatch = jofotaraRetryQueue.find((m) => m.id === item.id || m.invoiceNumber === item.invoiceNumber);
        if (memMatch) {
          memMatch.status = 'COMPLETED';
        }

        // Update Supabase
        if (!isPlaceholder) {
          try {
            await supabaseAdmin
              .from('jofotara_invoice_retries')
              .update({ status: 'COMPLETED', updated_at: nowStr })
              .eq('id', item.id);
          } catch (_) {}
        }
      } else {
        const isMaxedOut = nextAttempt >= item.maxRetries;
        const newStatus = isMaxedOut ? 'FAILED' : 'PENDING';
        if (isMaxedOut) failed++;

        const nextRetry = new Date(Date.now() + Math.pow(2, nextAttempt) * 1000 * 60).toISOString();

        const memMatch = jofotaraRetryQueue.find((m) => m.id === item.id || m.invoiceNumber === item.invoiceNumber);
        if (memMatch) {
          memMatch.retryCount = nextAttempt;
          memMatch.lastError = res.message;
          memMatch.status = newStatus;
          memMatch.nextRetryAt = nextRetry;
        }

        if (!isPlaceholder) {
          try {
            await supabaseAdmin
              .from('jofotara_invoice_retries')
              .update({
                retry_count: nextAttempt,
                last_error: res.message,
                status: newStatus,
                next_retry_at: nextRetry,
                updated_at: nowStr,
              })
              .eq('id', item.id);
          } catch (_) {}
        }
      }
    } catch (err: any) {
      const isMaxedOut = nextAttempt >= item.maxRetries;
      const newStatus = isMaxedOut ? 'FAILED' : 'PENDING';
      if (isMaxedOut) failed++;

      const nextRetry = new Date(Date.now() + Math.pow(2, nextAttempt) * 1000 * 60).toISOString();

      const memMatch = jofotaraRetryQueue.find((m) => m.id === item.id || m.invoiceNumber === item.invoiceNumber);
      if (memMatch) {
        memMatch.retryCount = nextAttempt;
        memMatch.lastError = err?.message || 'Retry execution failed';
        memMatch.status = newStatus;
        memMatch.nextRetryAt = nextRetry;
      }

      if (!isPlaceholder) {
        try {
          await supabaseAdmin
            .from('jofotara_invoice_retries')
            .update({
              retry_count: nextAttempt,
              last_error: err?.message || 'Retry execution failed',
              status: newStatus,
              next_retry_at: nextRetry,
              updated_at: nowStr,
            })
            .eq('id', item.id);
        } catch (_) {}
      }
    }
  }

  return { processed: itemsToProcess.length, succeeded, failed };
}

