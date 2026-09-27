// NashmiOps Enterprise (MVP Edition) - Chat History & State Hydration Endpoint
// Fetches and clears conversation checkpoints across browser refreshes & sessions

import { NextRequest, NextResponse } from 'next/server';
import { getConversationHistory, clearConversationHistory } from '@/lib/db/supabase';
import { CLINIC_CONFIG } from '@/lib/config/constants';
import { verifyApiAuthorization } from '@/lib/auth/api-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = verifyApiAuthorization(req);
  if (!auth.authorized) {
    return auth.response!;
  }

  try {
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone') || '+962791234567';
    const clinicId = searchParams.get('clinicId') || CLINIC_CONFIG.id;

    const conv = await getConversationHistory(clinicId, phone);

    return NextResponse.json({
      success: true,
      phone,
      patient_name: conv?.patient_name || null,
      chat_history: conv?.chat_history || [],
      updated_at: conv?.updated_at || null,
    });
  } catch (err: any) {
    console.error('[API History GET] Error:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Failed to fetch history' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = verifyApiAuthorization(req);
  if (!auth.authorized) {
    return auth.response!;
  }

  try {
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone') || '+962791234567';
    const clinicId = searchParams.get('clinicId') || CLINIC_CONFIG.id;

    await clearConversationHistory(clinicId, phone);

    return NextResponse.json({
      success: true,
      message: `Conversation history cleared for ${phone}`,
    });
  } catch (err: any) {
    console.error('[API History DELETE] Error:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Failed to clear history' }, { status: 500 });
  }
}
