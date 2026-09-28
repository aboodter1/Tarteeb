import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { runReactAgent, generateLocalFallbackResponse } from '@/lib/ai/react-agent';
import { CLINIC_CONFIG } from '@/lib/config/constants';
import {
  sendWhatsAppTextMessage as dispatchWhatsAppText,
  fetchWhatsAppAudioMedia,
  fetchWhatsAppMedia,
} from '@/lib/whatsapp/client';
import {
  isAndMarkWebhookMessageProcessed,
  broadcastReceptionistAlert,
} from '@/lib/db/supabase';
import { captureException } from '@/lib/monitoring/apm';

// Next.js 15 Route Segment Configuration
// NOTE: Only standard HTTP route handlers (GET, POST) are exported from this file to comply with Next.js 15 rules.
export const dynamic = 'force-dynamic';

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
 * 1. Cryptographic HMAC SHA-256 signature verification (x-hub-signature-256).
 * 2. Immediate 200 OK (<10ms) to satisfy Meta strict SLA.
 * 3. Database-level deduplication via Supabase to prevent duplicate processing on retries.
 * 4. Preemptive timeout guard (8.5s) to guarantee response before Vercel 10s kill limit.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const appSecret = process.env.META_APP_SECRET;
    const signature = req.headers.get('x-hub-signature-256');

    // 1. Cryptographic HMAC SHA-256 signature verification per Meta specifications
    if (appSecret) {
      if (!signature) {
        console.warn('[WhatsApp Webhook Security] Unauthorized: Missing x-hub-signature-256 header.');
        return NextResponse.json({ error: 'Unauthorized: Missing x-hub-signature-256 header' }, { status: 401 });
      }

      const expectedSignature = `sha256=${crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex')}`;

      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);

      if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        console.warn('[WhatsApp Webhook Security] Unauthorized: Invalid HMAC SHA-256 signature.');
        return NextResponse.json({ error: 'Unauthorized: Invalid x-hub-signature-256 signature' }, { status: 401 });
      }
    }

    const body = rawBody ? JSON.parse(rawBody) : {};

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
        let userText = message.text?.body || message.caption || message.image?.caption || '';
        let audioBase64: string | undefined;
        let imageBase64: string | undefined;
        let mimeType: string | undefined;

        // Image / Vision Multimodal handling (e.g. Insurance cards, medical reports)
        if (message.type === 'image' || message.image) {
          const imageId = message.image?.id;
          console.log(`[WhatsApp Webhook] Received image attachment ID: ${imageId}`);

          if (imageId) {
            const mediaResult = await fetchWhatsAppMedia(imageId, message.image?.mime_type || 'image/jpeg');
            if (mediaResult) {
              imageBase64 = mediaResult.base64;
              mimeType = mediaResult.mimeType;
            }
          }
          if (!userText) {
            userText = '[صورة بطاقة تأمين صحي أو وثيقة طبية أرسلها المريض للتحقق والاعتماد]';
          }
        }

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

        console.log(`[WhatsApp Webhook] Launching ReAct Agent for ${senderPhone}: "${userText || '[Media Note]'}"`);

        // -------------------------------------------------------------
        // Preemptive Timeout Guard: 8.5 seconds (Hard Timeout)
        // Prevents Vercel Serverless 10s execution kill on heavy audio or slow AI models
        // -------------------------------------------------------------
        const PREEMPTIVE_TIMEOUT_MS = 8500;
        const abortController = new AbortController();
        let agentResult: {
          replyText: string;
          toolCallsExecuted: any[];
          isEmergency: boolean;
          iterations: number;
          conversationId: string;
        };

        try {
          let timeoutHandle: NodeJS.Timeout | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              abortController.abort();
              reject(new Error('PREEMPTIVE_TIMEOUT_EXCEEDED_8500MS'));
            }, PREEMPTIVE_TIMEOUT_MS);
          });

          const executionPromise = runReactAgent({
            phoneNumber: senderPhone,
            userMessage: userText,
            audioBufferBase64: audioBase64,
            imageBase64,
            mimeType,
            abortSignal: abortController.signal,
          });

          agentResult = await Promise.race([executionPromise, timeoutPromise]);
          if (timeoutHandle) clearTimeout(timeoutHandle);
        } catch (timeoutOrAgentErr: any) {
          abortController.abort();
          console.warn(
            `[WhatsApp Webhook] Preemptive timeout or agent exception (${timeoutOrAgentErr?.message || timeoutOrAgentErr}). Invoking local intelligence fallback before Vercel 10s kill...`
          );

          const fallback = await generateLocalFallbackResponse({
            rawUserMsg: userText,
            phoneNumber: senderPhone,
            clinicId: CLINIC_CONFIG.id,
          });

          agentResult = {
            replyText: fallback.reply,
            toolCallsExecuted: [],
            isEmergency: fallback.isEmergency,
            iterations: 0,
            conversationId: `preemptive-fallback-${Date.now()}`,
          };
        }

        console.log(
          `[WhatsApp Webhook] Processing completed (Iterations: ${agentResult.iterations}). Dispatching response to Meta WhatsApp API...`
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
        const dispatchResult = await dispatchWhatsAppText(senderPhone, agentResult.replyText);
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
