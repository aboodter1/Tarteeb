// NashmiOps Enterprise (MVP Edition) - Unified Production ReAct Agent Core Engine
// Security & Secrets Isolation, Multi-Model Failover, State Checkpointing & Jordanian Receptionist Persona

import { GoogleGenAI } from '@google/genai';
import { CLINIC_CONFIG, MEDICAL_LIABILITY_GUARDRAILS } from '@/lib/config/constants';
import { clinicTools, executeClinicTool, phonesMatch } from './clinic-tools';
import {
  getOrCreateConversation,
  appendChatHistory,
  tenantStore,
  queryClinicFaq,
} from '@/lib/db/supabase';
import {
  classifyLocalIntent,
  generateIntelligentLocalResponse,
  extractTimeSlots,
  extractDateSlots,
  ClassifiedIntent,
  LocalIntentType,
  ExtractedSlots,
} from './local-intent';

export {
  classifyLocalIntent,
  generateIntelligentLocalResponse,
  extractTimeSlots,
  extractDateSlots,
};
export type { ClassifiedIntent, LocalIntentType, ExtractedSlots };

// ====================================================================
// 1. SECURITY & SECRETS ISOLATION (No hardcoded credentials)
// ====================================================================
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('[Security] CRITICAL: GEMINI_API_KEY is missing from environment variables!');
}
const ai = new GoogleGenAI({ apiKey: apiKey || '' });

const MAX_REACT_ITERATIONS = 3;
const CANDIDATE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
];

// ====================================================================
// 2. CANONICAL SYSTEM INSTRUCTIONS & GREETING DETECTION
// ====================================================================

export function isGreetingMessage(text?: string): boolean {
  if (!text) return false;
  const clean = text.trim().toLowerCase().replace(/[.!؟،]/g, '');
  const greetingPhrases = [
    'السلام عليكم',
    'السلام عليكم ورحمة الله',
    'السلام عليكم ورحمة الله وبركاته',
    'سلام عليكم',
    'سلام عليكم ورحمة الله',
    'وعليكم السلام',
    'وعليكم السلام ورحمة الله',
    'وعليكم السلام ورحمة الله وبركاته',
    'مرحبا',
    'مرحباً',
    'يا هلا',
    'هلا',
    'أهلاً',
    'اهلا',
    'أهلاً وسهلاً',
    'اهلا وسهلا',
    'صباح الخير',
    'صباح الورد',
    'مساء الخير',
    'مساء الورد',
    'يعطيك العافية',
    'يعطيكم العافية',
    'الو',
    'ألو',
    'هاي',
    'هلو',
    'تحياتي',
  ];

  const isExactGreeting = greetingPhrases.some(
    (g) => clean === g || clean === `${g} يا غالي` || clean === `${g} دكتور`
  );
  if (isExactGreeting) return true;

  const startsWithGreeting = greetingPhrases.some((g) => clean.startsWith(g + ' '));
  if (!startsWithGreeting) return false;

  const hasInquiryOrBooking = /(?:شو|كم|بدي|احجز|أحجز|موعد|سعر|تكلفة|دوام|أوقات|ساعات|كشفية|طوارئ|وجع|ألم|دكتور|وين|مكان|تأمين|\?|؟)/.test(
    text
  );
  return !hasInquiryOrBooking;
}

export function getMasterSystemInstruction(): string {
  return `أنت المساعد الذكي "نشمي" - موظف استقبال وسكرتير محترف، ذكي، وودود للغاية يعمل ضمن "نظام ترتيب لإدارة العيادات (Tarteeb Clinic OS)" في مركز الأسنان بعمان، الأردن. تتحدث حصراً عبر رسائل واتساب مع المرضى.

## 1. السياق الزمني والمرجعي الحالي (محسوب آلياً):
- التاريخ والوقت الحالي للسيرفر: ${new Date().toLocaleString('ar-JO', { timeZone: 'Asia/Amman' })}. استخدم هذا التوقيت حصراً كمرجع لأي إشارة إلى "اليوم"، "بكرا"، أو حساب المواعيد.
- موقع المركز: الشميساني، عمان (متوفر مواقف مجانية وخدمة فاليه لراحة المرضى).

## 2. قواعد الأسلوب البشري العفوي (Human-Like Tone & Guardrails):
- تحدث بلهجة أردنية عفوية، لطيفة، ومحترمة (مثل: "يا هلا والله"، "تكرم عيونك"، "ولا يهمك"، "طول بالك").
- الإيجاز التام: الرد لا يتجاوز سطرين إلى ثلاثة أسطر كحد أقصى مثل أي محادثة واتساب سريعة بين البشر.
- ممنوع منعاً باتاً: استخدام التنسيقات الروبوتية، النجوم المزخرفة (**)، القوائم الطويلة، التفلسف، أو تكرار نفس الجمل في كل رسالة.
- ممنوع كتابة الأوصاف أو الحركات التمثيلية بين أقواس نهائياً (مثل: *يبتسم*).

## 3. سيناريو حجز وتثبيت المواعيد (Zero-Friction Booking & Mandatory Patient Name & Multi-Person Rule):
- قاعدة إلزامية صارمة لمنع الحجز بدون اسم (Mandatory Patient Name & Multi-Person Rule):
  1. ممنوع منعاً باتاً استدعاء أداة الحجز (create_appointment) أو تثبيت أي موعد نهائياً إذا لم يقم المريض بكتابة وإرسال اسمه الصريح (ممنوع استخدام أي أسماء وهمية أو افتراضية كـ "مريض نشمي" أو "مريض").
  2. إذا اختار المريض الوقت (مثل "الأحد الساعة 11:30" أو "بكرا 11:30") ولم يذكر اسمه بعد، يجب عليك حصراً أن تسأله عن اسمه أولاً وتقول له: "تمام! بس اعطيني اسمك الكريم عشان أثبتلك الموعد فوراً"، وممنوع إتمام الحجز أو إرسال أي رسالة تأكيد قبل استلام الاسم الحقيقي وتسجيله في السيستم.
  3. حجز المرافقين والعائلة والأسماء المتعددة (Multi-Person Booking):
     - إذا طلب المريض حجز موعد له ولقريبه أو شخص آخر (مثل "إلي ولقريبي" أو "حجز لشخصين")، ممنوع نهائياً استدعاء أداة الحجز أو تثبيت الموعد دون أخذ الأسماء الصريحة لكل شخص.
     - يجب عليك حصراً طلب الأسماء الصريحة أولاً لكل شخص: "تمام! بس اعطيني اسمك الكريم واسم قريبك/المرافق عشان أثبتلكم المواعيد فوراً".
     - بمجرد إعطائه للأسماء، استدعِ فوراً أداة create_appointment مع مصفوفة الأسماء (patients) ليتم تثبيت كل موعد باسمه الحقيقي في جدول Supabase كحجزين متتابعين بدلاً من دمج الأسماء أو تجاهلها.
- منع الردود النصية الوهمية دون تنفيذ الأدوات (Strict Tool-Calling Enforcement):
  * بمجرد اتفاق المريض على الوقت المناسب وإعطائه لاسمه الكريم، يجب عليك فوراً تنفيذ استدعاء أداة الحجز (create_appointment) برمجياً في نفس دورة الرد، وممنوع الاكتفاء بالرد الإنشائي أو كتابة عبارات التأكيد نصياً دون حفظ الموعد فعلياً في قاعدة البيانات.
- ممنوع منعاً باتاً ذكر كلمات مثل "عربون"، "كليك" (CliQ)، أو إجراءات الدفع أثناء تثبيت المواعيد. أكد الموعد بعفوية وطبيعية كأي إنسان.
- عند رغبة المريض بالحجز، اقترح وقتين محددين مباشرة (مثال: "بناسبك بكرا 11:30 الصبح ولا 4:30 بعد الظهر؟").
- قاعدة تعديل رسالة تأكيد الحجز (Booking Confirmation Rule): عند نجاح حجز الموعد، ممنوع استخدام عبارات مبالغ فيها مثل "ألف مبروك". استبدلها بعبارة ترحيبية بسيطة وعملية تناسب جو العيادة (مثل: "يا هلا بك، تم تثبيت موعدك تمام، بانتظارك وتنورنا! الموقع: الشميساني، عمان (متوفر مواقف مجانية وفاليه).").

## 4. سيناريو تعديل أو إلغاء المواعيد (Rescheduling & Cancellation):
- إذا طلب المريض تغيير أو إلغاء موعده بسبب ظرف طارئ، تفاعل معه برحابة صدر وبدون أي لوم ("ولا يهمك، بسيطة").
- استدعِ فوراً أداة التعديل أو الإلغاء (cancel_appointment) لتحديث قاعدة البيانات رسمياً، ثم أكد له التعديل بعبارة قصيرة.

## 5. سيناريو التأمين وفحص البطاقة (Insurance OCR & Verification):
- المركز معتمد لمعظم الشبكات الرئيسية في الأردن (نات هيلث، ميدنت، الشرق العربي، GIG).
- إذا سأل المريض عن التأمين، اطلب منه صورة البطاقة فوراً.
- إذا أرسل المريض صورة لبطاقة التأمين، قم بتحليلها بالرؤية الحاسوبية واستخراج اسم شركة التأمين ورقم البطاقة، واستدعِ فوراً أداة verify_insurance_card للتحقق من التغطية وتأكيد قبولها.

## 6. سيناريو خصوصية الأطباء والمسؤولية الطبية (Medical Liability Law No. 25 of 2018):
- ممنوع إعطاء رقم الدكتور الشخصي نهائياً حفاظاً على خصوصيته وتركيزه بالعمليات.
- ممنوع التشخيص الطبي أو وصف الأدوية والمسكنات عن بعد نهائياً تحت أي ظرف.

## 7. سيناريو الطوارئ السريرية الفورية (Clinical Triage):
- إذا ذكر المريض أعراضاً خطرة (نزيف مستمر، ورم مفاجئ وكبير بالوجه، ألم حاد جداً لا يستجيب للمسكنات):
  توقف فوراً عن الحجز الروتيني، طمئنه بهدوء، وجهه للحضور الفوري للمركز في الشميساني، وأخبره بأن طبيب الطوارئ سيستقبله فوراً.
`;
}

// ====================================================================
// 3. UTILITIES & CANDIDATE EXTRACTION
// ====================================================================

const placeholderList = [
  'مريض نشمي', 'مريض', 'المريض', 'غير محدد', 'unknown', 'patient', 'user',
  'صاحب الرقم', 'مرافق', 'المرافق', 'قريبي', 'قريبك', 'القريب', 'صاحبي', 'صديقي',
  'أخوي', 'اخوي', 'الأخ', 'زوجتي', 'زوجي', 'ابني', 'بنتي', 'والدي', 'والدتي',
  'أنا', 'انا', 'نحن', 'احنا', 'إلي', 'الي', 'لي'
];

function isPlaceholderName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return !lower || placeholderList.includes(lower) || lower.length < 2;
}

function extractCandidateNames(
  userStr: string,
  history: Array<{ role: 'user' | 'model'; text: string }>
): string[] {
  const names: string[] = [];
  const textSources = [
    userStr,
    ...history.filter((h) => h.role === 'user').map((h) => h.text).reverse(),
  ];

  for (const txt of textSources) {
    const multiMatch = txt.match(
      /(?:أنا|اسمي|حجز لـ|للمريض)\s+([^\s،.]+)(?:\s+(?:و|وقريبي|ومعي|والأخ|وأخوي|وزوجتي)\s+(?:قريبي\s+|المرافق\s+|أخوي\s+|السيد\s+)?([^\s،.]+))/
    );
    if (multiMatch) {
      const n1 = multiMatch[1].trim();
      const n2 = multiMatch[2].trim();
      if (!isPlaceholderName(n1) && !names.includes(n1)) names.push(n1);
      if (!isPlaceholderName(n2) && !names.includes(n2)) names.push(n2);
    }

    const singleMatches = txt.matchAll(/(?:اسمي|أنا|انا|معك|للمريض|الأخ|السيد)\s+([^\s،.]+)/g);
    for (const sm of singleMatches) {
      const n = sm[1].trim();
      if (!isPlaceholderName(n) && !names.includes(n)) names.push(n);
    }
  }
  return names;
}

function buildGeminiContents(
  chatHistory: Array<{ role: 'user' | 'model'; text: string; toolCalls?: any[] }>,
  currentParts: any[],
  summary?: string
): any[] {
  const sanitizedHistory: Array<{ role: 'user' | 'model'; text: string }> = [];

  // Conversation Summarization & Token Optimization:
  // If older messages were compacted into a summary, inject it as context to preserve clinical/booking state
  // while saving tokens and decreasing response latency.
  if (summary && summary.trim()) {
    sanitizedHistory.push({
      role: 'user',
      text: `[سياق ملخص المحادثة السابقة لتوفير الـ Tokens وتسريع المعالجة]: ${summary.trim()}`,
    });
    sanitizedHistory.push({
      role: 'model',
      text: 'مفهوم، أنا على دراية تامة بكافة تفاصيل وسياق المحادثة السابقة مع المريض وسأواصل المتابعة بدقة واحترافية.',
    });
  }

  for (const item of chatHistory) {
    if (!item.text || !item.text.trim()) continue;
    const role: 'user' | 'model' = item.role === 'model' ? 'model' : 'user';

    if (sanitizedHistory.length === 0 && role === 'model') {
      continue;
    }

    const last = sanitizedHistory[sanitizedHistory.length - 1];
    if (last && last.role === role) {
      last.text += '\n' + item.text;
    } else {
      sanitizedHistory.push({ role, text: item.text });
    }
  }

  const contents: any[] = sanitizedHistory.map((h) => ({
    role: h.role,
    parts: [{ text: h.text }],
  }));

  const last = contents[contents.length - 1];
  if (last && last.role === 'user') {
    last.parts.push(...currentParts);
  } else {
    contents.push({
      role: 'user',
      parts: currentParts,
    });
  }

  return contents;
}

export function cleanHumanPlainText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[\s]*[-•*]\s+/gm, '')
    .replace(/^[\s]*#+\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function enforceOneQuestion(text: string): string {
  const questionMarks = (text.match(/؟|\?/g) || []).length;
  if (questionMarks <= 1) return text;

  const sentences = text.split(/(?<=[.!?؟\n])/);
  let questionsFound = 0;
  const filtered = sentences.filter((s) => {
    if (s.includes('؟') || s.includes('?')) {
      questionsFound++;
      return questionsFound === 1 || questionsFound === questionMarks;
    }
    return true;
  });

  return filtered.join(' ').replace(/\s{2,}/g, ' ').trim();
}

export interface ReactAgentResult {
  replyText: string;
  toolCallsExecuted: any[];
  isEmergency: boolean;
  iterations: number;
  conversationId: string;
}

/**
 * High-Resilience Local Fallback Response Engine
 * Generates immediate, spontaneous Jordanian receptionist responses when Gemini models
 * or remote 3rd-party network services experience complete outages or rate-limits.
 */
export async function generateLocalFallbackResponse(params: {
  rawUserMsg: string;
  phoneNumber: string;
  clinicId: string;
  isEmergency?: boolean;
  detectedNames?: string[];
  timeMatch?: any;
  isMultiPersonIntent?: boolean;
}): Promise<{ reply: string; isEmergency: boolean }> {
  const { rawUserMsg, clinicId, detectedNames = [], isMultiPersonIntent = false, timeMatch } = params;

  // 1. Intelligent Local Intent Classification & Slot Extraction
  const classified = classifyLocalIntent(rawUserMsg, detectedNames, isMultiPersonIntent);

  // If caller explicitly passed emergency flag, elevate immediately
  if (params.isEmergency) {
    classified.isEmergency = true;
    classified.primaryIntent = 'EMERGENCY';
  }

  // If explicit time was passed via timeMatch but slot is not set
  if (timeMatch && !classified.slots.specificTime) {
    const rawTime = timeMatch[1] || timeMatch[0];
    classified.slots.specificTime = rawTime.includes(':') ? rawTime : `${rawTime.padStart(2, '0')}:00`;
  }

  // 2. Synthesize Contextual Jordanian Response
  const result = await generateIntelligentLocalResponse(classified, clinicId);
  return result;
}

// ====================================================================
// 4. UNIFIED REACT AGENT ORCHESTRATION ENGINE
// ====================================================================

export async function runReactAgent(params: {
  clinicId?: string;
  phoneNumber: string;
  patientName?: string;
  userMessage?: string;
  audioBufferBase64?: string;
  imageBase64?: string;
  mimeType?: string;
  chatHistoryOverride?: Array<{ role: 'user' | 'model'; text: string }>;
  abortSignal?: AbortSignal;
}): Promise<ReactAgentResult> {
  if (params.abortSignal?.aborted) {
    throw new Error('OPERATION_ABORTED');
  }
  const clinicId = params.clinicId || CLINIC_CONFIG.id;
  const phoneNumber = (params.phoneNumber || '+962791234567').trim();
  const rawUserMsg = (params.userMessage || '').trim();

  // 1. Retrieve or initialize conversation checkpoint in Supabase
  const conversation = await getOrCreateConversation(clinicId, phoneNumber, params.patientName);

  // 2. Natural Greetings Fast Path (Pillar 3: Prevent False Apology)
  if (isGreetingMessage(rawUserMsg)) {
    const warmGreeting =
      'وعليكم السلام ورحمة الله، يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان بعمان! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟ 🦷';
    await appendChatHistory(clinicId, phoneNumber, 'user', rawUserMsg);
    await appendChatHistory(clinicId, phoneNumber, 'model', warmGreeting);

    return {
      replyText: warmGreeting,
      toolCallsExecuted: [],
      isEmergency: false,
      iterations: 0,
      conversationId: conversation.id,
    };
  }

  // 3. Waitlist Sniper Confirmation State Machine
  // Captures patient response "نعم أكد الموعد" to immediately confirm the vacancy without starting a fresh conversation loop
  const isWaitlistConfirm =
    /(?:نعم\s*أكد\s*الموعد|أكد\s*الموعد|نعم\s*أكد|تمام\s*أكد|أكدلي|احجزلي\s*إياه|نعم\s*بدي|نعم\s*احجز|موافق|تأكيد\s*الموعد)/.test(rawUserMsg);

  if (isWaitlistConfirm) {
    const candidateWaitlist = tenantStore.waitlist.find(
      (w) =>
        w.clinic_id === clinicId &&
        phonesMatch(w.patient_phone, phoneNumber) &&
        (w.status === 'NOTIFIED' || w.status === 'WAITING')
    );

    if (candidateWaitlist) {
      const preferredDate = candidateWaitlist.preferred_date;
      const preferredTime =
        candidateWaitlist.preferred_time_range === 'morning'
          ? '10:00'
          : candidateWaitlist.preferred_time_range === 'afternoon'
          ? '16:00'
          : '11:00';
      const patientFullName = candidateWaitlist.patient_name || conversation.patient_name || params.patientName || 'مريض نشمي';

      const bookingResult = await executeClinicTool(
        'book_appointment',
        {
          clinic_id: clinicId,
          patient_name: patientFullName,
          patient_phone: phoneNumber,
          date: preferredDate,
          time: preferredTime,
          service_type: candidateWaitlist.requested_service || 'consultation',
        },
        phoneNumber
      );

      candidateWaitlist.status = 'BOOKED';

      const successReply = `يا هلا والله يا ${patientFullName}! تم تأكيد وتثبيت موعدك الشاغر بنجاح في مركز نشمي لطب وجراحة الأسنان بعمان بتاريخ ${preferredDate} الساعة ${preferredTime}. بانتظارك وتنورنا بأي وقت! 🦷✨`;

      await appendChatHistory(clinicId, phoneNumber, 'user', rawUserMsg);
      await appendChatHistory(clinicId, phoneNumber, 'model', successReply);

      return {
        replyText: successReply,
        toolCallsExecuted: [
          {
            name: 'book_appointment',
            args: { patient_phone: phoneNumber, date: preferredDate, time: preferredTime },
            result: bookingResult,
          },
        ],
        isEmergency: false,
        iterations: 1,
        conversationId: conversation.id,
      };
    }
  }

  // 4. Emergency Guardrail (Medical Liability Law No. 25 of 2018)
  let isEmergency = false;
  const hasEmergency = MEDICAL_LIABILITY_GUARDRAILS.emergencyKeywords.some((kw) =>
    rawUserMsg.toLowerCase().includes(kw)
  );

  if (hasEmergency) {
    isEmergency = true;
    void executeClinicTool('trigger_emergency_handover', {
      patient_name: params.patientName || conversation.patient_name || 'مريض طوارئ',
      patient_phone: phoneNumber,
      symptoms: rawUserMsg,
    }, phoneNumber);
  }

  // Append user message to persistent state
  await appendChatHistory(clinicId, phoneNumber, 'user', rawUserMsg || '[رسالة صوتية]');

  // 4. Strict Patient Name & Multi-Person Guard
  const historyToUse = params.chatHistoryOverride || conversation.chat_history;
  const detectedNames = extractCandidateNames(rawUserMsg, historyToUse);
  const isMultiPersonIntent =
    /(?:إلي ولقريبي|إلي ولأخوي|إلي ولزوجتي|شخصين|موعدين|مع بعض|حجز مشترك|لي ولـ|حجز لشخصين|ومعي|وقريبي|وأخوي|وزوجتي|بدنا|لشخصين)/.test(rawUserMsg);
  const colloquialTime = extractTimeSlots(rawUserMsg).specificTime;
  const timeMatch =
    rawUserMsg.match(/\b([01]?[0-9]|2[0-3]):[0-5][0-9]\b/) ||
    rawUserMsg.match(/(?:الساعة|ساعة)\s*(\d{1,2}(?::\d{2})?)/) ||
    (colloquialTime ? [colloquialTime, colloquialTime] : null);

  // If user requested a time without providing requisite names, strictly enforce asking for names
  if (timeMatch) {
    if (isMultiPersonIntent && detectedNames.length < 2) {
      const namePrompt = 'تمام! بس اعطيني اسمك الكريم واسم قريبك/المرافق عشان أثبتلكم المواعيد فوراً.';
      await appendChatHistory(clinicId, phoneNumber, 'model', namePrompt);
      return {
        replyText: namePrompt,
        toolCallsExecuted: [],
        isEmergency,
        iterations: 0,
        conversationId: conversation.id,
      };
    } else if (!isMultiPersonIntent && detectedNames.length === 0) {
      const namePrompt = 'تمام! بس اعطيني اسمك الكريم عشان أثبتلك الموعد فوراً.';
      await appendChatHistory(clinicId, phoneNumber, 'model', namePrompt);
      return {
        replyText: namePrompt,
        toolCallsExecuted: [],
        isEmergency,
        iterations: 0,
        conversationId: conversation.id,
      };
    }
  }

  // 5. Prepare Current Turn Content Parts
  const currentParts: any[] = [];
  if (params.imageBase64) {
    currentParts.push({
      inlineData: {
        mimeType: params.mimeType || 'image/jpeg',
        data: params.imageBase64,
      },
    });
    if (rawUserMsg) {
      currentParts.push({ text: rawUserMsg });
    } else {
      currentParts.push({
        text: 'حلل صورة بطاقة التأمين الصحي أو الوثيقة المرفقة، واستخرج اسم شبكة التأمين ورقم البطاقة، واستدعِ فوراً أداة verify_insurance_card للتحقق من التغطية وطمأنة المريض.',
      });
    }
  } else if (params.audioBufferBase64) {
    currentParts.push({
      inlineData: {
        mimeType: params.mimeType || 'audio/ogg',
        data: params.audioBufferBase64,
      },
    });
    if (rawUserMsg) {
      currentParts.push({ text: rawUserMsg });
    } else {
      currentParts.push({
        text: 'استمع إلى هذه الرسالة الصوتية المرفقة من المريض، وتصرف كسكرتير نشمي لعيادة الأسنان في عمان وفق القواعد المحددة.',
      });
    }
  } else {
    currentParts.push({ text: rawUserMsg });
  }

  // Build Full Conversation Contents with Token-Optimized Summary
  const contents = buildGeminiContents(historyToUse, currentParts, conversation.summary);

  const toolCallsExecuted: any[] = [];
  let finalReplyText = '';
  let iterationCount = 0;
  const systemInstruction = getMasterSystemInstruction();

  // 6. ReAct Loop (strictly capped at MAX_REACT_ITERATIONS = 3)
  while (iterationCount < MAX_REACT_ITERATIONS) {
    if (params.abortSignal?.aborted) {
      throw new Error('OPERATION_ABORTED');
    }
    iterationCount++;
    console.log(`[ReAct Agent] Iteration ${iterationCount} of ${MAX_REACT_ITERATIONS} for ${phoneNumber}`);

    let response: any = null;
    let selectedModel = '';

    // Multi-Model Failover Pool
    for (const model of CANDIDATE_MODELS) {
      try {
        const genPromise = ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: clinicTools as any }],
          },
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('REACT_MODEL_TIMEOUT')), 5000)
        );

        response = await Promise.race([genPromise, timeoutPromise]);
        selectedModel = model;
        break;
      } catch (modelErr: any) {
        console.log(`[ReAct Agent] Failover from ${model} due to: ${modelErr?.message || modelErr}`);
      }
    }

    if (!response) {
      console.error('[ReAct Agent] All candidate models exhausted in iteration', iterationCount);
      break;
    }

    const rawFunctionCalls: any =
      response.functionCalls ||
      response.candidates?.[0]?.content?.parts?.filter((p: any) => p.functionCall)?.map((p: any) => p.functionCall);

    const functionCalls = Array.isArray(rawFunctionCalls) ? rawFunctionCalls : [];

    if (functionCalls.length === 0) {
      finalReplyText = response.text || '';
      console.log(`[ReAct Agent] Iteration ${iterationCount}: Final text generated via ${selectedModel}`);
      break;
    }

    // Tools called! Execute each tool within strict 8-second timeout
    console.log(
      `[ReAct Agent] Iteration ${iterationCount}: Executing ${functionCalls.length} tool call(s):`,
      functionCalls.map((c: any) => c.name)
    );

    if (response.candidates?.[0]?.content) {
      contents.push(response.candidates[0].content);
    } else {
      contents.push({
        role: 'model',
        parts: functionCalls.map((c: any) => ({ functionCall: c })),
      });
    }

    const functionResponseParts: any[] = [];

    for (const call of functionCalls) {
      let toolResult: any;
      try {
        const TOOL_TIMEOUT_MS = 8000;
        const toolPromise = executeClinicTool(call.name, call.args, phoneNumber);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TOOL_EXECUTION_TIMEOUT')), TOOL_TIMEOUT_MS)
        );

        toolResult = await Promise.race([toolPromise, timeoutPromise]);
      } catch (toolExecErr: any) {
        console.error(`[ReAct Agent] Tool ${call.name} error/timeout:`, toolExecErr?.message || toolExecErr);
        toolResult = {
          status: 'error',
          message: toolExecErr?.message || 'API timeout',
          tool: call.name,
        };
      }

      toolCallsExecuted.push({
        name: call.name,
        args: call.args,
        result: toolResult,
        iteration: iterationCount,
      });

      if (call.name === 'trigger_emergency_handover') {
        isEmergency = true;
      }

      functionResponseParts.push({
        functionResponse: {
          name: call.name,
          response: toolResult,
        },
      });
    }

    contents.push({
      role: 'user',
      parts: functionResponseParts,
    });

    if (iterationCount >= MAX_REACT_ITERATIONS) {
      console.warn(`[ReAct Agent] Reached MAX_REACT_ITERATIONS (${MAX_REACT_ITERATIONS}), terminating loop.`);
      try {
        const finalGen = await ai.models.generateContent({
          model: selectedModel || 'gemini-3.5-flash-lite',
          contents,
          config: {
            systemInstruction,
          },
        });
        finalReplyText = finalGen.text || '';
      } catch {
        const lastTool = toolCallsExecuted[toolCallsExecuted.length - 1];
        finalReplyText = lastTool?.result?.message || 'يا هلا بك، تم تثبيت موعدك تمام، بانتظارك وتنورنا!';
      }
      break;
    }
  }

  // 7. Strict Tool Enforcement & Premature Confirmation Interception
  const prematureConfirmation =
    finalReplyText.includes('تم تثبيت') ||
    finalReplyText.includes('ثبتتلك') ||
    finalReplyText.includes('حجزتلك') ||
    finalReplyText.includes('بانتظارك وتنورنا');

  if ((prematureConfirmation || !finalReplyText) && toolCallsExecuted.length === 0) {
    if (timeMatch && detectedNames.length > 0) {
      // Programmatically enforce the tool call since user gave name & time
      const rawTime = timeMatch[1] || timeMatch[0];
      const cleanTime = rawTime.includes(':') ? rawTime : `${rawTime.padStart(2, '0')}:00`;

      if (isMultiPersonIntent && detectedNames.length >= 2) {
        console.log('[Strict Enforcement] Executing multi-person booking tool:', detectedNames);
        const autoRes = await executeClinicTool(
          'create_appointment',
          {
            patients: detectedNames.slice(0, 2),
            time_str: cleanTime,
            date_str: 'غداً',
          },
          phoneNumber
        );
        if (autoRes?.message) finalReplyText = autoRes.message;
        toolCallsExecuted.push({ name: 'create_appointment', args: { patients: detectedNames }, result: autoRes });
      } else {
        console.log('[Strict Enforcement] Executing single booking tool for:', detectedNames[0]);
        const autoRes = await executeClinicTool(
          'create_appointment',
          {
            patient_name: detectedNames[0],
            time_str: cleanTime,
            date_str: 'غداً',
          },
          phoneNumber
        );
        if (autoRes?.message) finalReplyText = autoRes.message;
        toolCallsExecuted.push({ name: 'create_appointment', args: { patient_name: detectedNames[0] }, result: autoRes });
      }
    } else if (prematureConfirmation) {
      // Intercept and ask for names
      finalReplyText = isMultiPersonIntent
        ? 'تمام! بس اعطيني اسمك الكريم واسم قريبك/المرافق عشان أثبتلكم المواعيد فوراً.'
        : 'تمام! بس اعطيني اسمك الكريم عشان أثبتلك الموعد فوراً.';
    }
  }

  // 8. Fallback Recovery (Pillar 3: Triggered ONLY on real connection drops or model exhaustion)
  if (!finalReplyText) {
    const fallbackRes = await generateLocalFallbackResponse({
      rawUserMsg,
      phoneNumber,
      clinicId,
      isEmergency,
      detectedNames,
      timeMatch,
      isMultiPersonIntent,
    });
    finalReplyText = fallbackRes.reply;
    if (fallbackRes.isEmergency) {
      isEmergency = true;
    }
  }

  // 9. Anti-Markdown & Human Reception Styling
  let cleanedReply = cleanHumanPlainText(finalReplyText);

  // Guarantee ZERO deposits / CliQ mention
  cleanedReply = cleanedReply
    .replace(/(?:عربون|دفعة أولى|كليك|CliQ|حوللنا)/gi, '')
    .trim();

  // Enforce one question at a time
  cleanedReply = enforceOneQuestion(cleanedReply);

  // 10. Checkpoint Model Turn into Supabase Chat History
  await appendChatHistory(clinicId, phoneNumber, 'model', cleanedReply, toolCallsExecuted);

  return {
    replyText: cleanedReply,
    toolCallsExecuted,
    isEmergency,
    iterations: iterationCount,
    conversationId: conversation.id,
  };
}

/**
 * Universal wrapper for backward compatibility across existing suites
 */
export async function processConversationalMessage(params: {
  userMessage?: string;
  audioBufferBase64?: string;
  mimeType?: string;
  patientPhone: string;
  chatHistory: Array<{ role: 'user' | 'model'; text: string }>;
}): Promise<{
  replyText: string;
  toolCallsExecuted: any[];
  isEmergency: boolean;
}> {
  const result = await runReactAgent({
    phoneNumber: params.patientPhone,
    userMessage: params.userMessage,
    audioBufferBase64: params.audioBufferBase64,
    mimeType: params.mimeType,
    chatHistoryOverride: params.chatHistory,
  });

  return {
    replyText: result.replyText,
    toolCallsExecuted: result.toolCallsExecuted,
    isEmergency: result.isEmergency,
  };
}
