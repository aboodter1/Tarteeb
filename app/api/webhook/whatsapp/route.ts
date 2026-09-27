// NashmiOps Enterprise (MVP Edition) - Meta WhatsApp Cloud API Production Webhook
// Fully Powered by ReAct Agent Core with Loop Capping, Observational Error Recovery & Supabase State Persistence

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { runReactAgent } from '@/lib/ai/react-agent';
import {
  sendWhatsAppTextMessage,
  fetchWhatsAppAudioMedia,
} from '@/lib/whatsapp/client';
import {
  isAndMarkWebhookMessageProcessed,
  broadcastReceptionistAlert,
} from '@/lib/db/supabase';
import { captureException } from '@/lib/monitoring/apm';

/**
 * Meta Webhook Verification Handshake (GET)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const expectedToken = process.env.META_WHATSAPP_VERIFY_TOKEN || 'tarteeb_verify_token_2026';

  if (mode === 'subscribe' && token === expectedToken) {
    console.log('[WhatsApp Webhook] Meta challenge verification passed successfully.');
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * Universal ReAct Webhook Receiver (POST)
 * 1. Immediate 200 OK (<10ms) to satisfy Meta strict SLA.
 * 2. Database-level deduplication via Supabase to prevent duplicate processing on retries.
 * 3. Serverless execution safeguards via waitUntil to ensure processing completes.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // If payload contains no messages (e.g., status updates/read receipts), acknowledge immediately
    if (!message) {
      return NextResponse.json({ status: 'ignored_no_message' }, { status: 200 });
    }

    const messageId = message.id;
    const senderPhone = message.from || '+962791234567';
    const messageType = message.type || (message.audio ? 'audio' : 'text');

    // 1. Strict Database Deduplication via Supabase (Serverless Safe)
    if (messageId) {
      const isDuplicate = await isAndMarkWebhookMessageProcessed({
        messageId,
        senderPhone,
        messageType,
      });

      if (isDuplicate) {
        console.log(`[WhatsApp Webhook] Duplicate message skipped at DB layer: ${messageId}`);
        return NextResponse.json({ status: 'duplicate_skipped', messageId }, { status: 200 });
      }
    }

    // 2. Asynchronous ReAct Execution wrapped in Serverless / Edge Safeguard
    const backgroundTask = (async () => {
      try {
        let userText = message.text?.body || '';
        let audioBase64: string | undefined;
        let mimeType: string | undefined;

        // Audio voice note handling (.ogg / voice note)
        if (message.type === 'audio' || message.audio) {
          const audioId = message.audio?.id;
          console.log(`[WhatsApp Webhook] Received audio voice note ID: ${audioId}`);

          if (audioId) {
            const mediaResult = await fetchWhatsAppAudioMedia(audioId);
            if (mediaResult) {
              audioBase64 = mediaResult.base64;
              mimeType = mediaResult.mimeType;
            }
          }
          if (!audioBase64) {
            userText = '[تسجيل صوتي باللهجة الأردنية - استفسار أو حجز كشف أسنان]';
          }
        }

        console.log(`[WhatsApp Webhook] Launching ReAct Agent for ${senderPhone}: "${userText || '[Audio Note]'}"`);

        // Execute ReAct Agent with loop capping, tool execution, and Supabase checkpointing
        const agentResult = await runReactAgent({
          phoneNumber: senderPhone,
          userMessage: userText,
          audioBufferBase64: audioBase64,
          mimeType,
        });

        console.log(
          `[WhatsApp Webhook] ReAct Agent completed in ${agentResult.iterations} iteration(s). Dispatching response to Meta WhatsApp API...`
        );

        // Realtime Receptionist Alert on Clinical Emergency Trigger
        if (agentResult.isEmergency || agentResult.replyText.includes('[EMERGENCY_TRIGGER]')) {
          void broadcastReceptionistAlert({
            type: 'EMERGENCY',
            title: '🚨 تنبيه طوارئ سريرية عبر واتساب [EMERGENCY_TRIGGER]',
            description: `المريض (${senderPhone}) أبلغ عن حالة طوارئ سريرية: ${userText || '[تسجيل صوتي]'}`,
            patient_phone: senderPhone,
            severity: 'CRITICAL',
            metadata: {
              rawMessage: userText,
              reply: agentResult.replyText,
            },
          });
        }

        // Outbound Meta WhatsApp Cloud API Dispatch
        const dispatchResult = await sendWhatsAppTextMessage(senderPhone, agentResult.replyText);
        console.log(`[WhatsApp Webhook] Reply dispatched to ${senderPhone} (Status: ${dispatchResult.success ? 'Delivered' : 'Failed'})`);
      } catch (bgErr: any) {
        captureException(bgErr, {
          route: '/api/webhook/whatsapp',
          endpoint: 'backgroundTask',
          patientPhone: senderPhone,
        });
        console.error('[WhatsApp Webhook] ReAct Background processing error:', bgErr);
      }
    })();

    // Ensure Serverless runtime does NOT freeze or kill the function before completion
    if (typeof waitUntil === 'function') {
      waitUntil(backgroundTask);
    } else {
      void backgroundTask;
    }

    // Fast-path: return immediate 200 OK to Meta
    return NextResponse.json({ status: 'received', messageId }, { status: 200 });
  } catch (err: any) {
    captureException(err, { route: '/api/webhook/whatsapp', endpoint: 'POST' });
    console.error('[WhatsApp Webhook] Failed to parse request:', err);
    return NextResponse.json({ status: 'received' }, { status: 200 });
  }
}
