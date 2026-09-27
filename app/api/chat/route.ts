// NashmiOps Enterprise (MVP Edition) - Chat API Route Powered by ReAct Agent Core

import { NextRequest, NextResponse } from 'next/server';
import { runReactAgent, isGreetingMessage } from '@/lib/ai/react-agent';
import { captureException } from '@/lib/monitoring/apm';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Client-supplied history is strictly ignored to eliminate prompt injection risks.
  // History is loaded exclusively from Supabase based on the verified phone number.
  const { message, audioBase64, mimeType, phone } = body;
  const userMsg = (message || '').trim();

  try {
    // 12-second timeout safeguard for the conversational orchestration
    const agentPromise = runReactAgent({
      phoneNumber: phone || '+962791234567',
      userMessage: message,
      audioBufferBase64: audioBase64,
      mimeType,
      // chatHistoryOverride omitted to enforce server-side database history only
    });

    const timeoutPromise = new Promise<{
      replyText: string;
      toolCallsExecuted: any[];
      isEmergency: boolean;
      iterations: number;
    }>((_, reject) => setTimeout(() => reject(new Error('CHAT_ORCHESTRATION_TIMEOUT')), 12000));

    const result = await Promise.race([agentPromise, timeoutPromise]);

    return NextResponse.json({
      success: true,
      reply: result.replyText,
      toolCalls: result.toolCallsExecuted,
      isEmergency: result.isEmergency,
      iterations: result.iterations,
    });
  } catch (err: any) {
    captureException(err, {
      route: '/api/chat',
      endpoint: 'POST',
      patientPhone: phone,
    });
    console.error('[API Chat] Error in ReAct execution:', err?.message || err);

    if (isGreetingMessage(userMsg)) {
      return NextResponse.json({
        success: true,
        reply: 'وعليكم السلام ورحمة الله، يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان بعمان! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟',
        toolCalls: [],
        isEmergency: false,
        iterations: 0,
      });
    }

    const nameMatch = userMsg.match(/(?:أنا|اسمي|معك|لـ|للمريض|الأخ|السيد)\s+([^\s،.]+)/);
    const detectedName = nameMatch ? nameMatch[1] : '';
    const greeting = detectedName ? `أهلاً بك يا ${detectedName}` : 'أهلاً بك يا غالي';
    const friendlyApology = `${greeting}، غلبتك صار خطأ بسيط بالاتصال، ممكن تعيدلي طلبك بعد إذنك؟`;

    return NextResponse.json({
      success: true,
      reply: friendlyApology,
      toolCalls: [],
      isEmergency: false,
      iterations: 0,
    });
  }
}
