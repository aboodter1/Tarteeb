// NashmiOps Enterprise (MVP Edition) - Meta WhatsApp Cloud API Client
// Outbound Messaging, Real Voice Note (Audio) Fetching, and Media Transformation

import { logFailedOutboundMessage } from '@/lib/db/supabase';
import { captureException, captureMessage } from '@/lib/monitoring/apm';

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
 */
export async function sendWhatsAppTextMessage(
  to: string,
  messageText: string
): Promise<WhatsAppSendResult> {
  const token =
    process.env.META_WHATSAPP_ACCESS_TOKEN ||
    process.env.META_WHATSAPP_TOKEN;

  const phoneNumberId =
    process.env.META_WHATSAPP_PHONE_NUMBER_ID ||
    process.env.META_PHONE_NUMBER_ID ||
    '962790000000';

  const recipient = formatMetaRecipientPhone(to);

  if (!token || token.startsWith('mock_')) {
    console.log(
      `[WhatsApp Client - Simulated Mode] Dispatching text to ${recipient} via PhoneID ${phoneNumberId}:\n"${messageText.substring(0, 100)}..."`
    );
    return {
      success: true,
      messageId: `wamid.simulated.${Date.now()}`,
      recipient,
      simulated: true,
    };
  }

  const endpoint = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  try {
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

      // APM Alert: Real-time error capture
      captureMessage(`Meta API dispatch error HTTP ${res.status}: ${errorMsg}`, 'ERROR', {
        endpoint,
        patientPhone: recipient,
        route: 'sendWhatsAppTextMessage',
      });

      // Dead-Letter Handling: Log failed dispatch for receptionist review
      await logFailedOutboundMessage({
        recipientPhone: recipient,
        messageText,
        errorReason: `Meta API HTTP ${res.status}: ${errorMsg}`,
      }).catch((logErr) => console.warn('[WhatsApp Client] Dead-letter logging notice:', logErr));

      return {
        success: false,
        recipient,
        error: errorMsg,
      };
    }

    const messageId = data?.messages?.[0]?.id;
    console.log(`[WhatsApp Client] Message sent successfully (ID: ${messageId}) to ${recipient}`);

    return {
      success: true,
      messageId,
      recipient,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Network exception sending WhatsApp message';
    console.error(`[WhatsApp Client] Network error sending message to ${recipient}:`, errorMsg);

    // APM Alert: Capture network exception
    captureException(err, {
      endpoint,
      patientPhone: recipient,
      route: 'sendWhatsAppTextMessage',
    });

    // Dead-Letter Handling: Log failed dispatch for receptionist review
    await logFailedOutboundMessage({
      recipientPhone: recipient,
      messageText,
      errorReason: `Network Exception: ${errorMsg}`,
    }).catch((logErr) => console.warn('[WhatsApp Client] Dead-letter logging notice:', logErr));

    return {
      success: false,
      recipient,
      error: errorMsg,
    };
  }
}

/**
 * Fetch and convert WhatsApp Audio voice note (.ogg/.opus) to Base64 using Meta Graph API
 */
export async function fetchWhatsAppAudioMedia(
  audioId: string
): Promise<{ base64: string; mimeType: string } | null> {
  const token =
    process.env.META_WHATSAPP_ACCESS_TOKEN ||
    process.env.META_WHATSAPP_TOKEN;

  if (!token || token.startsWith('mock_')) {
    console.log(`[WhatsApp Client] Simulated mode: returning standard OGG mock audio for ID ${audioId}`);
    return {
      base64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
      mimeType: 'audio/ogg',
    };
  }

  try {
    // Step 1: Retrieve Media URL from Meta Graph API
    const metaMediaEndpoint = `https://graph.facebook.com/v21.0/${audioId}`;
    const metaRes = await fetch(metaMediaEndpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!metaRes.ok) {
      console.warn(`[WhatsApp Client] Could not resolve audio metadata for ${audioId}: HTTP ${metaRes.status}`);
      return null;
    }

    const mediaJson = await metaRes.json();
    const mediaUrl = mediaJson?.url;
    const mimeType = mediaJson?.mime_type || 'audio/ogg';

    if (!mediaUrl) {
      console.warn(`[WhatsApp Client] Missing URL in media metadata for audio ${audioId}`);
      return null;
    }

    // Step 2: Download binary audio content from Meta CDN
    const binaryRes = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Vercel Serverless OOM Protection: Max 16MB limit
    const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
    const contentLength = binaryRes.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_AUDIO_BYTES) {
      console.warn(`[WhatsApp Client] Audio file exceeds 16MB limit (${contentLength} bytes). Download aborted to prevent serverless OOM.`);
      return null;
    }

    const arrayBuffer = await binaryRes.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
      console.warn(`[WhatsApp Client] Downloaded audio buffer (${arrayBuffer.byteLength} bytes) exceeds 16MB limit. Aborting Base64 conversion.`);
      return null;
    }

    const base64 = Buffer.from(arrayBuffer).toString('base64');

    console.log(`[WhatsApp Client] Successfully downloaded audio ${audioId} (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB, mime: ${mimeType})`);

    return {
      base64,
      mimeType,
    };
  } catch (err: any) {
    console.error(`[WhatsApp Client] Error fetching WhatsApp audio ${audioId}:`, err?.message || err);
    return null;
  }
}
