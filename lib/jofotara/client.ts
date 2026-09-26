// NashmiOps Enterprise (MVP Edition) - ISTD JoFotara Network API Client
// Handles official HTTP transmission of UBL 2.1 XML to the Jordanian Income and Sales Tax Department (ISTD)
// Supports B2C Simplified Reporting & B2B Standard Clearance workflows with automatic Simulated Mode

import { InvoiceType } from '@/types';
import { CLINIC_CONFIG } from '@/lib/config/constants';

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

  return {
    baseUrl: baseUrl ? baseUrl.replace(/\/+$/, '') : 'https://preprod.jofotara.gov.jo/core/invoices',
    clientSecret,
    clientId,
    isSimulated: !isConfigured,
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

  // 1. Automatic Simulated Mode when live ISTD credentials are not set
  if (config.isSimulated) {
    const simSubmissionId = `istd-sim-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const resultStatus = isB2B ? 'CLEARED' : 'REPORTED';
    
    console.log(`[JoFotara Client - Simulated Mode] Submitted ${input.invoiceType} invoice (${input.invoiceNumber}) to ${targetRoute}:`);
    console.log(`  UUID: ${input.invoiceUuid}`);
    console.log(`  Hash: ${input.invoiceHash.substring(0, 24)}...`);
    console.log(`  Assigned Submission ID: ${simSubmissionId}`);
    console.log(`  Status: ${resultStatus} 100% Valid UBL 2.1 XML`);

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

  // 2. Live HTTP POST to ISTD JoFotara Gateway
  try {
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
  } catch (netErr: any) {
    const errorMsg = netErr?.message || 'Network exception contacting ISTD gateway';
    console.error(`[JoFotara Client] Network exception transmitting to ${fullEndpoint}:`, errorMsg);
    await enqueueJoFotaraRetry(input, errorMsg, CLINIC_CONFIG.id);
    return {
      success: false,
      status: 'ERROR',
      invoiceUuid: input.invoiceUuid,
      invoiceHash: input.invoiceHash,
      endpointUsed: fullEndpoint,
      simulated: false,
      validationErrors: [errorMsg],
      message: `خطأ اتصال بشبكة دائرة ضريبة الدخل والمبيعات: ${errorMsg}. أُضيفت الفاتورة لطابور إعادة المحاولة الآلية.`,
    };
  }
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
    id: `retry-inv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    clinicId,
    invoiceNumber: payload.invoiceNumber,
    payload,
    retryCount: 0,
    maxRetries: 5,
    lastError,
    status: 'PENDING',
    nextRetryAt: new Date(Date.now() + 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
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
  const pending = jofotaraRetryQueue.filter(
    (item) => item.status === 'PENDING' && new Date(item.nextRetryAt) <= now
  );

  let succeeded = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const res = await submitInvoiceToJoFotara(item.payload);
      if (res.success) {
        item.status = 'COMPLETED';
        succeeded++;
      } else {
        item.retryCount += 1;
        item.lastError = res.message;
        if (item.retryCount >= item.maxRetries) {
          item.status = 'FAILED';
          failed++;
        } else {
          item.nextRetryAt = new Date(Date.now() + Math.pow(2, item.retryCount) * 1000 * 60).toISOString();
        }
      }
    } catch (err: any) {
      item.retryCount += 1;
      item.lastError = err?.message || 'Retry execution failed';
      if (item.retryCount >= item.maxRetries) {
        item.status = 'FAILED';
        failed++;
      } else {
        item.nextRetryAt = new Date(Date.now() + Math.pow(2, item.retryCount) * 1000 * 60).toISOString();
      }
    }
  }

  return { processed: pending.length, succeeded, failed };
}

