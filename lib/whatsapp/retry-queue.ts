// NashmiOps Enterprise (MVP Edition) - Outbound WhatsApp Retry Queue
// Handles temporary Meta Cloud API or network disruptions with Exponential Backoff
// Uses Supabase `whatsapp_message_retries` table as persistent single source of truth across serverless instances.

import { CLINIC_CONFIG } from '@/lib/config/constants';
import { supabaseAdmin } from '@/lib/db/supabase';
import { sendWhatsAppTextMessage } from './client';

export interface WhatsAppRetryItem {
  id: string;
  clinicId: string;
  recipient: string;
  messageText: string;
  retryCount: number;
  maxRetries: number;
  lastError: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  nextRetryAt: string;
  createdAt: string;
  updatedAt: string;
}

export const whatsappRetryQueue: WhatsAppRetryItem[] = [];

/**
 * Enqueue failed outbound WhatsApp message for automatic exponential retry
 */
export async function enqueueWhatsAppRetry(
  recipient: string,
  messageText: string,
  lastError: string,
  clinicId: string = CLINIC_CONFIG.id
): Promise<WhatsAppRetryItem> {
  const isPlaceholder =
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

  const initialBackoffSeconds = 30; // first retry in 30 seconds
  const nowStr = new Date().toISOString();
  const nextRetryStr = new Date(Date.now() + initialBackoffSeconds * 1000).toISOString();

  let assignedId = `retry-wa-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // 1. Persistent Supabase Storage (Single Source of Truth)
  if (!isPlaceholder) {
    try {
      const { data: existingRow } = await supabaseAdmin
        .from('whatsapp_message_retries')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('recipient_phone', recipient)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingRow) {
        const nextCount = (existingRow.retry_count || 0) + 1;
        const backoffSeconds = Math.min(30 * Math.pow(2, nextCount), 3600);
        const nextRetry = new Date(Date.now() + backoffSeconds * 1000).toISOString();

        await supabaseAdmin
          .from('whatsapp_message_retries')
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
          .from('whatsapp_message_retries')
          .insert({
            clinic_id: clinicId,
            recipient_phone: recipient,
            message_text: messageText,
            retry_count: 0,
            max_retries: 5,
            last_error: lastError,
            status: 'PENDING',
            next_retry_at: nextRetryStr,
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
      console.warn('[WhatsApp Retry Queue] DB persistence warning:', dbErr);
    }
  }

  // 2. Synchronize In-Memory Cache (for local simulation/tests)
  const existingMem = whatsappRetryQueue.find(
    (q) => q.recipient === recipient && q.messageText === messageText && q.status === 'PENDING'
  );

  if (existingMem) {
    existingMem.retryCount += 1;
    existingMem.lastError = lastError;
    const backoffSeconds = Math.min(30 * Math.pow(2, existingMem.retryCount), 3600);
    existingMem.nextRetryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
    existingMem.updatedAt = nowStr;
    return existingMem;
  }

  const retryItem: WhatsAppRetryItem = {
    id: assignedId,
    clinicId,
    recipient,
    messageText,
    retryCount: 0,
    maxRetries: 5,
    lastError,
    status: 'PENDING',
    nextRetryAt: nextRetryStr,
    createdAt: nowStr,
    updatedAt: nowStr,
  };

  whatsappRetryQueue.push(retryItem);
  console.log(`[WhatsApp Retry Queue] Enqueued message to ${recipient} for background retry with exponential backoff.`);

  return retryItem;
}

/**
 * Process all eligible pending messages in the WhatsApp Retry Queue
 */
export async function processWhatsAppRetryQueue(): Promise<{
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
    recipient: string;
    messageText: string;
    retryCount: number;
    maxRetries: number;
    fromDb: boolean;
  }> = [];

  // 1. Fetch from Supabase Table with Row-Level Locking (SELECT ... FOR UPDATE SKIP LOCKED)
  if (!isPlaceholder) {
    try {
      // First attempt Atomic RPC stored procedure to lock and claim batch concurrently
      const { data: rpcRows, error: rpcErr } = await supabaseAdmin.rpc('claim_pending_whatsapp_retries', {
        p_clinic_id: CLINIC_CONFIG.id,
        p_batch_size: 50,
      });

      let rows = rpcRows;

      // Fallback to standard query if RPC is not yet installed in local dev
      if (rpcErr || !rows) {
        if (rpcErr && rpcErr.code !== '42883') {
          console.warn('[WhatsApp Retry Queue] RPC notice, falling back to direct query:', rpcErr.message);
        }
        const { data: directRows, error: dirErr } = await supabaseAdmin
          .from('whatsapp_message_retries')
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
            recipient: row.recipient_phone,
            messageText: row.message_text,
            retryCount: row.retry_count || 0,
            maxRetries: row.max_retries || 5,
            fromDb: true,
          });
        }
      }
    } catch (err) {
      console.warn('[WhatsApp Retry Queue] DB fetch warning:', err);
    }
  }

  // 2. Merge any local in-memory pending items not yet synced
  const pendingMem = whatsappRetryQueue.filter(
    (item) => item.status === 'PENDING' && new Date(item.nextRetryAt) <= now
  );

  for (const mem of pendingMem) {
    if (!itemsToProcess.some((i) => i.recipient === mem.recipient && i.messageText === mem.messageText)) {
      itemsToProcess.push({
        id: mem.id,
        recipient: mem.recipient,
        messageText: mem.messageText,
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
    try {
      const res = await sendWhatsAppTextMessage(item.recipient, item.messageText, { skipEnqueue: true });
      const nowStr = new Date().toISOString();

      if (res.success) {
        succeeded++;
        console.log(`[WhatsApp Retry Queue] Successfully delivered message to ${item.recipient} on retry #${nextAttempt}`);

        // Update in-memory item
        const memMatch = whatsappRetryQueue.find((m) => m.id === item.id || (m.recipient === item.recipient && m.messageText === item.messageText));
        if (memMatch) {
          memMatch.status = 'COMPLETED';
          memMatch.updatedAt = nowStr;
        }

        // Update Supabase
        if (!isPlaceholder) {
          try {
            await supabaseAdmin
              .from('whatsapp_message_retries')
              .update({ status: 'COMPLETED', updated_at: nowStr })
              .eq('id', item.id);
          } catch (_) {}
        }
      } else {
        const errorMsg = res.error || 'Retry attempt failed';
        const isMaxedOut = nextAttempt >= item.maxRetries;
        const newStatus = isMaxedOut ? 'FAILED' : 'PENDING';
        if (isMaxedOut) failed++;

        const backoffSeconds = Math.min(30 * Math.pow(2, nextAttempt), 3600);
        const nextRetryStr = new Date(Date.now() + backoffSeconds * 1000).toISOString();

        // Update in-memory item
        const memMatch = whatsappRetryQueue.find((m) => m.id === item.id || (m.recipient === item.recipient && m.messageText === item.messageText));
        if (memMatch) {
          memMatch.retryCount = nextAttempt;
          memMatch.lastError = errorMsg;
          memMatch.status = newStatus;
          memMatch.nextRetryAt = nextRetryStr;
          memMatch.updatedAt = nowStr;
        }

        // Update Supabase
        if (!isPlaceholder) {
          try {
            await supabaseAdmin
              .from('whatsapp_message_retries')
              .update({
                retry_count: nextAttempt,
                last_error: errorMsg,
                status: newStatus,
                next_retry_at: nextRetryStr,
                updated_at: nowStr,
              })
              .eq('id', item.id);
          } catch (_) {}
        }
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Unexpected exception during retry';
      const isMaxedOut = nextAttempt >= item.maxRetries;
      const newStatus = isMaxedOut ? 'FAILED' : 'PENDING';
      if (isMaxedOut) failed++;

      const backoffSeconds = Math.min(30 * Math.pow(2, nextAttempt), 3600);
      const nextRetryStr = new Date(Date.now() + backoffSeconds * 1000).toISOString();
      const nowStr = new Date().toISOString();

      const memMatch = whatsappRetryQueue.find((m) => m.id === item.id || (m.recipient === item.recipient && m.messageText === item.messageText));
      if (memMatch) {
        memMatch.retryCount = nextAttempt;
        memMatch.lastError = errorMsg;
        memMatch.status = newStatus;
        memMatch.nextRetryAt = nextRetryStr;
        memMatch.updatedAt = nowStr;
      }

      if (!isPlaceholder) {
        try {
          await supabaseAdmin
            .from('whatsapp_message_retries')
            .update({
              retry_count: nextAttempt,
              last_error: errorMsg,
              status: newStatus,
              next_retry_at: nextRetryStr,
              updated_at: nowStr,
            })
            .eq('id', item.id);
        } catch (_) {}
      }
    }
  }

  return { processed: itemsToProcess.length, succeeded, failed };
}
