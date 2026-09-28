// NashmiOps Enterprise (MVP Edition) - Meta WhatsApp Cloud API Client
// Outbound Messaging, Real Voice Note (Audio) Fetching, and Media Transformation

import { logFailedOutboundMessage } from '@/lib/db/supabase';
import { captureException, captureMessage } from '@/lib/monitoring/apm';
import { circuitBreaker } from '@/lib/resilience/circuit-breaker';
import {
  enqueueWhatsAppRetry,
  processWhatsAppRetryQueue,
  whatsappRetryQueue,
  WhatsAppRetryItem,
} from './retry-queue';

export { enqueueWhatsAppRetry, processWhatsAppRetryQueue, whatsappRetryQueue, circuitBreaker };
export type { WhatsAppRetryItem };

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  recipient: string;
  error?: string;
  simulated?: boolean;
}

/**
 * Format recipient phone number for Meta WhatsApp Cloud API (e.g. 962791234567 without '+')
 */
export function formatMetaRecipientPhone(phone: string): string {
  let clean = phone.replace(/[^\d]/g, '');
  if (clean.startsWith('00')) {
    clean = clean.substring(2);
  }
  // Convert local Jordan 07XXXXXXXX to 9627XXXXXXXX
  if (clean.startsWith('07') && clean.length === 10) {
    clean = `962${clean.substring(1)}`;
  }
  return clean;
}

/**
 * Send WhatsApp Text Message via Meta Cloud API v21.0
 * Automatically enqueues into WhatsApp Retry Queue with Exponential Backoff upon network or API failure.
 */
export async function sendWhatsAppTextMessage(
  to: string,
  messageText: string,
  options?: { skipEnqueue?: boolean; clinicId?: string }
): Promise<WhatsAppSendResult> {
  const token =
    process.env.META_WHATSAPP_ACCESS_TOKEN ||
    process.env.META_WHATSAPP_TOKEN;

  const phoneNumberId =
    process.env.META_WHATSAPP_PHONE_NUMBER_ID ||
    process.env.META_PHONE_NUMBER_ID ||
    '962790000000';

  const recipient = formatMetaRecipientPhone(to);

  if (!token || token.startsWith('mock_') || circuitBreaker.isSimulatedFallbackActive('whatsapp')) {
    console.log(
      `[WhatsApp Client - Simulated Mode] Dispatching text to ${recipient} via PhoneID ${phoneNumberId}:\n"${messageText.substring(0, 100)}..."`
    );

    // If active due to tripped circuit breaker, queue for eventual live delivery
    if (circuitBreaker.isSimulatedFallbackActive('whatsapp') && !options?.skipEnqueue) {
      await enqueueWhatsAppRetry(
        recipient,
        messageText,
        'Circuit Breaker OPEN: In local simulated mode, queued for live delivery upon Meta API recovery',
        options?.clinicId
      ).catch((qErr) => console.warn('[WhatsApp Client] Retry enqueue warning:', qErr));
    }

    return {
      success: true,
      messageId: `wamid.simulated.${Date.now()}`,
      recipient,
      simulated: true,
    };
  }

  const endpoint = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  return await circuitBreaker.execute<WhatsAppSendResult>(
    'whatsapp',
    async () => {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: {
          preview_url: false,
          body: messageText,
        },
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const errorMsg = data?.error?.message || `HTTP error ${res.status}`;
        console.warn(`[WhatsApp Client] Meta API error HTTP ${res.status}:`, data);

        captureMessage(`Meta API dispatch error HTTP ${res.status}: ${errorMsg}`, 'ERROR', {
          endpoint,
          patientPhone: recipient,
          route: 'sendWhatsAppTextMessage',
        });

        await logFailedOutboundMessage({
          recipientPhone: recipient,
          messageText,
          errorReason: `Meta API HTTP ${res.status}: ${errorMsg}`,
        }).catch((logErr) => console.warn('[WhatsApp Client] Dead-letter logging notice:', logErr));

        if (!options?.skipEnqueue) {
          await enqueueWhatsAppRetry(
            recipient,
            messageText,
            `Meta API HTTP ${res.status}: ${errorMsg}`,
            options?.clinicId
          ).catch((qErr) => console.warn('[WhatsApp Client] Retry enqueue warning:', qErr));
        }

        throw new Error(`Meta API HTTP ${res.status}: ${errorMsg}`);
      }

      const messageId = data?.messages?.[0]?.id;
      console.log(`[WhatsApp Client] Message sent successfully (ID: ${messageId}) to ${recipient}`);

      return {
        success: true,
        messageId,
        recipient,
        simulated: false,
      };
    },
    async (circuitState, err) => {
      const errorMsg = err?.message || 'Network exception sending WhatsApp message';
      console.warn(`[WhatsApp Client - Circuit Fallback] Meta API unreachable (${circuitState}), transitioning to local simulated mode:`, errorMsg);

      captureException(err, {
        endpoint,
        patientPhone: recipient,
        route: 'sendWhatsAppTextMessage',
        circuitState,
      });

      await logFailedOutboundMessage({
        recipientPhone: recipient,
        messageText,
        errorReason: `Circuit Breaker Fallback (${circuitState}): ${errorMsg}`,
      }).catch((logErr) => console.warn('[WhatsApp Client] Dead-letter logging notice:', logErr));

      if (!options?.skipEnqueue) {
        await enqueueWhatsAppRetry(
          recipient,
          messageText,
          `Circuit Breaker Fallback: ${errorMsg}`,
          options?.clinicId
        ).catch((qErr) => console.warn('[WhatsApp Client] Retry enqueue warning:', qErr));
      }

      return {
        success: true,
        messageId: `wamid.simulated.offline.${Date.now()}`,
        recipient,
        simulated: true,
        error: errorMsg,
      };
    }
  );
}

/**
 * Fetch and convert WhatsApp Media (Image, Audio, Document) to Base64 using Meta Graph API
 */
export async function fetchWhatsAppMedia(
  mediaId: string,
  fallbackMime: string = 'image/jpeg'
): Promise<{ base64: string; mimeType: string } | null> {
  const token =
    process.env.META_WHATSAPP_ACCESS_TOKEN ||
    process.env.META_WHATSAPP_TOKEN;

  if (!token || token.startsWith('mock_')) {
    if (fallbackMime.startsWith('image/')) {
      console.log(`[WhatsApp Client] Simulated mode: returning standard mock image for ID ${mediaId}`);
      return {
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mimeType: fallbackMime || 'image/png',
      };
    }
    console.log(`[WhatsApp Client] Simulated mode: returning standard OGG mock audio for ID ${mediaId}`);
    return {
      base64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
      mimeType: fallbackMime || 'audio/ogg',
    };
  }

  try {
    // Step 1: Retrieve Media URL from Meta Graph API
    const metaMediaEndpoint = `https://graph.facebook.com/v21.0/${mediaId}`;
    const metaRes = await fetch(metaMediaEndpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!metaRes.ok) {
      console.warn(`[WhatsApp Client] Could not resolve media metadata for ${mediaId}: HTTP ${metaRes.status}`);
      return null;
    }

    const mediaJson = await metaRes.json();
    const mediaUrl = mediaJson?.url;
    const mimeType = mediaJson?.mime_type || fallbackMime;

    if (!mediaUrl) {
      console.warn(`[WhatsApp Client] Missing URL in media metadata for ${mediaId}`);
      return null;
    }

    // Step 2: Download binary content from Meta CDN
    const binaryRes = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Vercel Serverless OOM Protection: Max 16MB limit
    const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
    const contentLength = binaryRes.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_MEDIA_BYTES) {
      console.warn(`[WhatsApp Client] Media file exceeds 16MB limit (${contentLength} bytes). Download aborted to prevent serverless OOM.`);
      return null;
    }

    const arrayBuffer = await binaryRes.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
      console.warn(`[WhatsApp Client] Downloaded media buffer (${arrayBuffer.byteLength} bytes) exceeds 16MB limit. Aborting Base64 conversion.`);
      return null;
    }

    const base64 = Buffer.from(arrayBuffer).toString('base64');
    console.log(`[WhatsApp Client] Successfully downloaded media ${mediaId} (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB, mime: ${mimeType})`);

    return {
      base64,
      mimeType,
    };
  } catch (err: any) {
    console.error(`[WhatsApp Client] Error fetching WhatsApp media ${mediaId}:`, err?.message || err);
    return null;
  }
}

/**
 * Fetch and convert WhatsApp Audio voice note (.ogg/.opus) to Base64 using Meta Graph API
 */
export async function fetchWhatsAppAudioMedia(
  audioId: string
): Promise<{ base64: string; mimeType: string } | null> {
  return fetchWhatsAppMedia(audioId, 'audio/ogg');
}
