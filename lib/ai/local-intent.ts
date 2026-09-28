// NashmiOps Enterprise (MVP Edition) - Autonomous Local Intent Classification Engine
// Operates as an offline-resilient, deterministic NLP triage engine for Jordanian dialect patient communications
// Full compliance with Jordanian Medical Liability Law No. 25 of 2018 & Zero-Deposit Policy

import { CLINIC_CONFIG, CLINICAL_SERVICES, MEDICAL_LIABILITY_GUARDRAILS, formatJOD } from '@/lib/config/constants';
import { queryClinicFaq } from '@/lib/db/supabase';

export type LocalIntentType =
  | 'EMERGENCY'
  | 'GREETING'
  | 'WAITLIST_CONFIRM'
  | 'BOOKING_REQUEST'
  | 'RESCHEDULE_CANCEL'
  | 'INSURANCE_QUERY'
  | 'PRICING_QUERY'
  | 'SERVICES_QUERY'
  | 'LOCATION_HOURS'
  | 'DOCTOR_INQUIRY'
  | 'FEEDBACK_COMPLAINT'
  | 'GENERAL_INQUIRY';

export interface ExtractedSlots {
  patientName?: string;
  isMultiPerson: boolean;
  serviceType?: string;
  serviceLabelAr?: string;
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
  specificTime?: string;
  dayOrDate?: string;
  insuranceNetwork?: string;
  urgency: 'EMERGENCY' | 'URGENT' | 'ROUTINE';
}

export interface ClassifiedIntent {
  primaryIntent: LocalIntentType;
  secondaryIntents: LocalIntentType[];
  confidence: number;
  slots: ExtractedSlots;
  isEmergency: boolean;
  rawText: string;
}

// ====================================================================
// 1. INTENT LEXICONS & JORDANIAN DIALECT PATTERNS
// ====================================================================

const INTENT_PATTERNS: Record<LocalIntentType, RegExp[]> = {
  EMERGENCY: [
    /(?:نزيف|دم\s*مستمر|سيلان\s*دم|نزف)/,
    /(?:ورم|انتفاخ|ورمان|منفخ)/,
    /(?:مش\s*قادر\s*اتنفس|صعوبة\s*(?:بالتنفس|بالبلع)|خنقة)/,
    /(?:ألم\s*(?:حاد|قاتل|صدمي|لا\s*يحتمل|فظيع|بموت|مش\s*طبيعي)|وجع\s*(?:فظيع|حاد|مش\s*محتمل))/,
    /(?:كسر\s*(?:بالفك|بالعظم|حاد|بالأسنان)|حادث|صدمة)/,
    /(?:حرارة\s*عالية|حمى\s*شديدة|سخونة)/,
  ],
  GREETING: [
    /(?:السلام\s*عليكم|سلام\s*عليكم|وعليكم\s*السلام)/,
    /(?:صباح\s*(?:الخير|الورد|الياسمين)|مساء\s*(?:الخير|الورد|الياسمين))/,
    /(?:مرحبا|مرحباً|يا\s*هلا|هلا\s*والله|هلا|أهلاً|اهلا|أهلاً\s*وسهلاً|اهلا\s*وسهلا)/,
    /(?:يعطيك\s*العافية|يعطيكم\s*العافية|الله\s*يعافيك)/,
    /(?:الو|ألو|هاي|هلو|تحياتي)/,
  ],
  WAITLIST_CONFIRM: [
    /(?:نعم\s*أكد\s*الموعد|أكد\s*الموعد|نعم\s*أكد|تمام\s*أكد|أكدلي|احجزلي\s*إياه|نعم\s*بدي|نعم\s*احجز|موافق|تأكيد\s*الموعد)/,
    /(?:اعتمد\s*الموعد|ثبتلي\s*الموعد\s*الشاغر|بناسبني\s*الشاغر)/,
  ],
  BOOKING_REQUEST: [
    /(?:بدي\s*احجز|بدي\s*أحجز|حابب\s*احجز|بدي\s*موعد|في\s*مجال\s*لموعد|رتبلي\s*موعد|احجزلي|أحجزلي|سجلي\s*موعد)/,
    /(?:بدي\s*اجي|بدي\s*أجي|حابب\s*اشرفكم|بقدر\s*اجي|في\s*موعد|حجز\s*موعد)/,
    /(?:بناسبني\s*(?:موعد|يوم|الساعة)|متى\s*في\s*موعد|متى\s*أقرب\s*موعد)/,
  ],
  RESCHEDULE_CANCEL: [
    /(?:بدي\s*(?:أأجل|ااجل|اغير|أغير|ابدل|أبدل)\s*الموعد)/,
    /(?:تغيير\s*الموعد|تأجيل\s*الموعد|تعديل\s*الموعد)/,
    /(?:بدي\s*(?:ألغي|الغي)\s*(?:الموعد|الحجز)|إلغاء\s*الموعد|الغاء\s*الموعد)/,
    /(?:ما\s*(?:بقدر|راح\s*اقدر|بلحق)\s*اجي|اعتذار\s*عن\s*الموعد|صار\s*عندي\s*ظرف)/,
  ],
  INSURANCE_QUERY: [
    /(?:تأمين|تامين|بطاقة\s*تأمين|شبكات\s*التأمين|تغطية\s*التأمين)/,
    /(?:نات\s*هيلث|nathealth|ميدنت|mednet|الشرق\s*العربي|gig|العربية\s*الأوروبية)/,
    /(?:بتتعاملوا\s*مع\s*تأمين|بتغطوا|موافقة\s*(?:مسبقة|مباشرة))/,
  ],
  PRICING_QUERY: [
    /(?:كم\s*(?:سعر|تكلفة|الكشفية|الفحص|الحشوة|التنظيف|الزراعة|التقويم|التبييض))/,
    /(?:شو\s*(?:الأسعار|الاسعار|التكلفة|سعر))/,
    /(?:قديش\s*بتكلف|بكم|تكلفة\s*العلاج|قائمة\s*الأسعار)/,
  ],
  SERVICES_QUERY: [
    /(?:بتعملوا|في\s*عندكم|بتسووا|بتقدموا)\s*(?:زراعة|تقويم|تبييض|عصب|تنظيف|خلع|قص\s*لثة|ابتسامة\s*هوليوود|فينير)/,
    /(?:علاج\s*عصب|سحب\s*عصب|حشوة\s*تجميلية|تركيبات\s*زركون|خلع\s*ضرس\s*عقل)/,
  ],
  LOCATION_HOURS: [
    /(?:وين\s*(?:موقعكم|مكانكم|العيادة|المركز)|عنوانكم|موقع\s*العيادة)/,
    /(?:ساعات\s*(?:الدوام|العمل)|أوقات\s*الدوام|متى\s*(?:بتفتحوا|بتسكروا))/,
    /(?:فاتحين\s*اليوم|بتفتحوا\s*الجمعة|السبت\s*دوام)/,
    /(?:الشميساني|مواقف\s*سيارات|في\s*صفة|باركنج|فاليه)/,
  ],
  DOCTOR_INQUIRY: [
    /(?:مين\s*الدكتور|اسم\s*الدكتور|أطباء\s*المركز|مين\s*بشتغل|طبيب\s*الأسنان)/,
    /(?:دكتور\s*قاسم|دكتورة\s*ديما|أخصائي\s*التقويم|أخصائي\s*الجراحة)/,
    /(?:رقم\s*الدكتور\s*(?:الخاص|الشخصي)|بدي\s*احكي\s*مع\s*الدكتور\s*مباشرة)/,
  ],
  FEEDBACK_COMPLAINT: [
    /(?:عندي\s*مشكلة|مش\s*راضي|صار\s*معي\s*وجع\s*بعد|الحشوة\s*وقعت|الحشوة\s*انكسرت)/,
    /(?:شكوى|اعتراض|ملاحظة\s*على\s*الشغل|المعاملة)/,
  ],
  GENERAL_INQUIRY: [
    /(?:سؤال|استفسار|حابب\s*اعرف|ممكن\s*افهم|عندي\s*استفسار)/,
  ],
};

// ====================================================================
// 2. SLOT EXTRACTION HELPERS
// ====================================================================

export function extractTimeSlots(text: string): { specificTime?: string; timeOfDay?: 'morning' | 'afternoon' | 'evening' } {
  const clean = text.toLowerCase().trim();

  // 1. Determine general time of day (morning, afternoon, evening)
  let timeOfDay: 'morning' | 'afternoon' | 'evening' | undefined;
  const isExplicitMorning = /(?:الصبح|صباحاً|صباحا|بدري|الفجر)/.test(clean);
  const isExplicitAfternoon = /(?:العصر|بعد\s*الظهر|الظهر|بعد\s*العصر)/.test(clean);
  const isExplicitEvening = /(?:المساء|مساءً|المسا|مساء|بالليل|المغرب|العشا)/.test(clean);

  if (isExplicitMorning) timeOfDay = 'morning';
  else if (isExplicitEvening) timeOfDay = 'evening';
  else if (isExplicitAfternoon) timeOfDay = 'afternoon';

  // 2. Explicit digital time format (e.g. 11:30, 16:00, 09:15)
  const timeRegex = /\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/;
  const matchExplicit = clean.match(timeRegex);
  if (matchExplicit) {
    const hh = matchExplicit[1].padStart(2, '0');
    const mm = matchExplicit[2];
    return { specificTime: `${hh}:${mm}`, timeOfDay };
  }

  // 3. Digital hour with prefix (e.g. الساعة 4 أو الساعة 4:30)
  const hourRegex = /(?:الساعة|ساعة|ع\s*الساعة|عالـ|ع\s*الـ|عـ)\s*(\d{1,2})(?::(\d{2}))?/;
  const matchHour = clean.match(hourRegex);
  if (matchHour) {
    let rawH = parseInt(matchHour[1], 10);
    const m = matchHour[2] || '00';
    if (rawH >= 1 && rawH <= 7 && !isExplicitMorning) {
      rawH += 12; // PM for Jordanian clinic working hours
    }
    const specificTime = `${String(rawH).padStart(2, '0')}:${m}`;
    return { specificTime, timeOfDay: timeOfDay || (rawH >= 12 ? 'afternoon' : 'morning') };
  }

  // 4. Jordanian Colloquial Word-Based Time Parsing
  const jordanianHourWords: Array<{ patterns: RegExp[]; hour: number }> = [
    { patterns: [/(?:الحداعش|إحدعش|احدعش|حداعش|إيدعش|ايدعش|أحد\s*عشر)/], hour: 11 },
    { patterns: [/(?:الطنعش|إطنعش|اطنعش|إتناعش|اثنا\s*عشر)/], hour: 12 },
    { patterns: [/(?:العشرة|عشرة|عشر)/], hour: 10 },
    { patterns: [/(?:التسعة|تسعة|تسع)/], hour: 9 },
    { patterns: [/(?:التمانية|ثمانية|تمانية|تمان|ثمان)/], hour: 8 },
    { patterns: [/(?:السبعة|سبعة|سبع)/], hour: 7 },
    { patterns: [/(?:الستة|ستة|ست)/], hour: 6 },
    { patterns: [/(?:الخمسة|خمسة|خمس)/], hour: 5 },
    { patterns: [/(?:الأربعة|الاربعة|أربعة|اربعة|أربع|اربع)/], hour: 4 },
    { patterns: [/(?:التلاتة|الثلاثة|تلاتة|ثلاثة|تلات|ثلاث)/], hour: 3 },
    { patterns: [/(?:الثنتين|التنتين|ثنتين|تنتين|اثنتين|ساعتين)/], hour: 2 },
    { patterns: [/(?:الوحدة|الواحدة|وحدة|واحدة)/], hour: 1 },
  ];

  for (const item of jordanianHourWords) {
    for (const pat of item.patterns) {
      const fullPat = new RegExp(
        `(?:(?:ع\\s*الـ|ع\\s*الأ|ع\\s*الإ|عالـ|على\\s*الـ|عـ|الساعة|ساعة)\\s*)?${pat.source}`
      );
      const match = clean.match(fullPat);
      if (match) {
        let baseHour = item.hour;
        let minuteStr = '00';

        // Check for fractions/modifiers following the hour
        const afterText = clean.substring(match.index! + match[0].length, match.index! + match[0].length + 20);

        if (/(?:ونص|و\s*نصف)/.test(afterText)) {
          minuteStr = '30';
        } else if (/(?:وربع|و\s*ربع)/.test(afterText)) {
          minuteStr = '15';
        } else if (/(?:وتلت|و\s*تلت|وثلث|و\s*ثلث)/.test(afterText)) {
          minuteStr = '20';
        } else if (/(?:وعشرة|و\s*عشر)/.test(afterText)) {
          minuteStr = '10';
        } else if (/(?:وخمسة|و\s*خمس)/.test(afterText)) {
          minuteStr = '05';
        } else if (/(?:إلا\s*ربع|الا\s*ربع)/.test(afterText)) {
          baseHour -= 1;
          minuteStr = '45';
        } else if (/(?:إلا\s*تلت|الا\s*تلت|إلا\s*ثلث|الا\s*ثلث)/.test(afterText)) {
          baseHour -= 1;
          minuteStr = '40';
        } else if (/(?:إلا\s*عشرة|الا\s*عشرة)/.test(afterText)) {
          baseHour -= 1;
          minuteStr = '50';
        }

        // AM/PM resolution for Jordan clinic (09:00 - 20:00)
        // 1 to 7 are PM unless "الصبح" is explicitly specified
        if (baseHour >= 1 && baseHour <= 7 && !isExplicitMorning) {
          baseHour += 12;
        }

        const specificTime = `${String(baseHour).padStart(2, '0')}:${minuteStr}`;
        return {
          specificTime,
          timeOfDay: timeOfDay || (baseHour >= 12 ? 'afternoon' : 'morning'),
        };
      }
    }
  }

  // 5. General colloquial approximations without explicit hour
  if (/(?:الصبح\s*بدري|بدري\s*الصبح|أول\s*الدوام|الصبح\s*أول\s*ما\s*تفتحوا)/.test(clean)) {
    return { specificTime: '09:00', timeOfDay: 'morning' };
  }
  if (/(?:بعد\s*العصر\s*بشوي|بعد\s*العصر|العصر|وقت\s*العصر)/.test(clean)) {
    return { specificTime: '17:00', timeOfDay: 'afternoon' };
  }
  if (/(?:بعد\s*الظهر|وقت\s*الظهر|الظهر)/.test(clean)) {
    return { specificTime: '14:00', timeOfDay: 'afternoon' };
  }
  if (/(?:المساء|المسا|آخر\s*الدوام|قبل\s*ما\s*تسكروا)/.test(clean)) {
    return { specificTime: '18:30', timeOfDay: 'evening' };
  }

  return { specificTime: undefined, timeOfDay };
}

export function extractDateSlots(text: string): string | undefined {
  const clean = text.toLowerCase().trim();

  if (/(?:اليوم|الليلة)/.test(clean)) return 'اليوم';
  if (/(?:بكرة|بكرا|غداً|غدا)/.test(clean)) return 'غداً';
  if (/(?:بعد\s*بكرة|بعد\s*بكرا)/.test(clean)) return 'بعد غد';

  const dayMap: Record<string, number> = {
    'الأحد': 0, 'الاحد': 0,
    'الإثنين': 1, 'الاثنين': 1,
    'الثلاثاء': 2,
    'الأربعاء': 3, 'الاربعاء': 3,
    'الخميس': 4,
    'الجمعة': 5,
    'السبت': 6,
  };

  const daysMatch = clean.match(/(?:يوم\s*)?(الأحد|الاحد|الإثنين|الاثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)/);
  if (daysMatch) {
    const dayName = daysMatch[1];
    const targetDayIndex = dayMap[dayName];

    // Check if the user refers to next week: "الجاي", "القادم", "المقبل", or explicitly "الأسبوع الجاي"
    const isExplicitNextWeek = /(?:الاسبوع\s*الجاي|الأسبوع\s*القادم|الاسبوع\s*القادم|الأسبوع\s*المقبل)/.test(clean);
    const hasNextQualifier = /(?:الجاي|القادم|المقبل)/.test(clean);

    if ((hasNextQualifier || isExplicitNextWeek) && targetDayIndex !== undefined) {
      const now = new Date();
      const currentDayIndex = now.getDay();
      // Calculate offset to that weekday in current cycle (0 to 6)
      const diff = (targetDayIndex - currentDayIndex + 7) % 7;
      let daysToAdd: number;

      if (diff === 0) {
        // Same day of week: add 7 full days
        daysToAdd = 7;
      } else if (isExplicitNextWeek) {
        // Patient explicitly requested next week: add cycle offset plus 7 days
        daysToAdd = diff + 7;
      } else {
        // Upcoming day in current cycle: add diff days
        daysToAdd = diff;
      }

      const targetDate = new Date(now.getTime() + daysToAdd * 86400000);
      const yyyy = targetDate.getFullYear();
      const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
      const dd = String(targetDate.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    return dayName;
  }

  return undefined;
}

function extractInsuranceNetwork(text: string): string | undefined {
  if (/(?:نات\s*هيلث|nathealth)/i.test(text)) return 'نات هيلث (NatHealth)';
  if (/(?:ميدنت|mednet)/i.test(text)) return 'ميدنت (MedNet)';
  if (/(?:الشرق\s*العربي|gig)/i.test(text)) return 'الشرق العربي للتأمين (GIG)';
  if (/(?:العربية\s*الأوروبية)/i.test(text)) return 'المجموعة العربية الأوروبية';
  if (/(?:تأمين|تامين)/.test(text)) return 'شبكات التأمين المعتمدة';
  return undefined;
}

function extractServiceType(text: string): { serviceType?: string; serviceLabelAr?: string } {
  if (/(?:تنظيف|تقليح|جير|تلميع)/.test(text)) {
    return { serviceType: 'cleaning', serviceLabelAr: CLINICAL_SERVICES.cleaning.nameAr };
  }
  if (/(?:تبييض|تبييض\s*ليزر|تبييض\s*الأسنان)/.test(text)) {
    return { serviceType: 'whitening', serviceLabelAr: CLINICAL_SERVICES.whitening.nameAr };
  }
  if (/(?:تقويم|سلك|حاصرات)/.test(text)) {
    return { serviceType: 'orthodontics_check', serviceLabelAr: CLINICAL_SERVICES.orthodontics_check.nameAr };
  }
  if (/(?:زراعة|زرعة|غرس)/.test(text)) {
    return { serviceType: 'implant', serviceLabelAr: 'زراعة الأسنان الفورية' };
  }
  if (/(?:عصب|سحب\s*عصب|قناة\s*الجذر)/.test(text)) {
    return { serviceType: 'endodontics', serviceLabelAr: 'علاج وسحب العصب الدقيق' };
  }
  if (/(?:خلع|قلع|ضرس\s*عقل)/.test(text)) {
    return { serviceType: 'extraction', serviceLabelAr: CLINICAL_SERVICES.extraction.nameAr };
  }
  if (/(?:حشوة|حشوات|نخر|تسوس)/.test(text)) {
    return { serviceType: 'restoration', serviceLabelAr: CLINICAL_SERVICES.restoration.nameAr };
  }
  if (/(?:كشف|كشفية|فحص|استشارة|ألم|وجع)/.test(text)) {
    return { serviceType: 'consultation', serviceLabelAr: CLINICAL_SERVICES.consultation.nameAr };
  }
  return {};
}

// ====================================================================
// 3. INTENT CLASSIFICATION CORE ENGINE
// ====================================================================

export function classifyLocalIntent(
  userMsg: string,
  detectedNames: string[] = [],
  isMultiPersonIntent: boolean = false
): ClassifiedIntent {
  const clean = userMsg.trim().toLowerCase();
  const secondaryIntents: LocalIntentType[] = [];

  // 1. Emergency Detection (Priority 1 - Regulatory Mandate)
  const isEmergency =
    INTENT_PATTERNS.EMERGENCY.some((regex) => regex.test(clean)) ||
    MEDICAL_LIABILITY_GUARDRAILS.emergencyKeywords.some((kw) => clean.includes(kw.toLowerCase()));

  if (isEmergency) {
    return {
      primaryIntent: 'EMERGENCY',
      secondaryIntents: [],
      confidence: 0.99,
      slots: {
        patientName: detectedNames[0],
        isMultiPerson: isMultiPersonIntent,
        urgency: 'EMERGENCY',
      },
      isEmergency: true,
      rawText: userMsg,
    };
  }

  // 2. Score All Intent Categories
  const scores: Record<LocalIntentType, number> = {
    EMERGENCY: 0,
    GREETING: 0,
    WAITLIST_CONFIRM: 0,
    BOOKING_REQUEST: 0,
    RESCHEDULE_CANCEL: 0,
    INSURANCE_QUERY: 0,
    PRICING_QUERY: 0,
    SERVICES_QUERY: 0,
    LOCATION_HOURS: 0,
    DOCTOR_INQUIRY: 0,
    FEEDBACK_COMPLAINT: 0,
    GENERAL_INQUIRY: 0,
  };

  for (const [intentKey, patterns] of Object.entries(INTENT_PATTERNS) as [LocalIntentType, RegExp[]][]) {
    if (intentKey === 'EMERGENCY') continue;
    for (const pattern of patterns) {
      if (pattern.test(clean)) {
        scores[intentKey] += 1;
      }
    }
  }

  // Check if non-greeting intents are present
  const hasSubstantiveIntent =
    scores.BOOKING_REQUEST > 0 ||
    scores.INSURANCE_QUERY > 0 ||
    scores.PRICING_QUERY > 0 ||
    scores.LOCATION_HOURS > 0 ||
    scores.RESCHEDULE_CANCEL > 0 ||
    scores.DOCTOR_INQUIRY > 0 ||
    scores.SERVICES_QUERY > 0 ||
    scores.WAITLIST_CONFIRM > 0;

  if (!hasSubstantiveIntent && scores.GREETING > 0) {
    scores.GREETING += 5;
  }

  // Sort intents by matched score
  const sortedIntents = (Object.keys(scores) as LocalIntentType[])
    .filter((k) => scores[k] > 0)
    .sort((a, b) => scores[b] - scores[a]);

  let primaryIntent: LocalIntentType = sortedIntents[0] || 'GENERAL_INQUIRY';
  if (sortedIntents.length > 1) {
    for (let i = 1; i < sortedIntents.length; i++) {
      secondaryIntents.push(sortedIntents[i]);
    }
  }

  // Slot Extractions
  const { specificTime, timeOfDay } = extractTimeSlots(clean);
  const dayOrDate = extractDateSlots(clean);
  const insuranceNetwork = extractInsuranceNetwork(clean);
  const { serviceType, serviceLabelAr } = extractServiceType(clean);

  // Determine Urgency
  let urgency: 'EMERGENCY' | 'URGENT' | 'ROUTINE' = 'ROUTINE';
  if (/(?:ضروري|اليوم|عاجل|وجع\s*شديد|طول\s*الليل)/.test(clean)) {
    urgency = 'URGENT';
  }

  // Confidence calculation
  const topScore = scores[primaryIntent] || 0;
  const confidence = primaryIntent === 'GENERAL_INQUIRY' ? 0.5 : Math.min(0.7 + topScore * 0.1, 0.98);

  return {
    primaryIntent,
    secondaryIntents,
    confidence,
    slots: {
      patientName: detectedNames[0],
      isMultiPerson: isMultiPersonIntent,
      serviceType,
      serviceLabelAr,
      timeOfDay,
      specificTime,
      dayOrDate,
      insuranceNetwork,
      urgency,
    },
    isEmergency: false,
    rawText: userMsg,
  };
}

// ====================================================================
// 4. INTELLIGENT MULTI-INTENT JORDANIAN RESPONSE GENERATION
// ====================================================================

export async function generateIntelligentLocalResponse(
  classified: ClassifiedIntent,
  clinicId: string = CLINIC_CONFIG.id
): Promise<{ reply: string; isEmergency: boolean }> {
  const { primaryIntent, secondaryIntents, slots, rawText } = classified;

  // 1. Emergency Protocol under Medical Liability Law No. 25 of 2018
  if (classified.isEmergency || primaryIntent === 'EMERGENCY') {
    return {
      reply: `${MEDICAL_LIABILITY_GUARDRAILS.emergencyTriggerCode}\n${MEDICAL_LIABILITY_GUARDRAILS.emergencyResponseAr}`,
      isEmergency: true,
    };
  }

  // 2. Name Greeting Prefix
  const nameSalutation = slots.patientName ? `يا هلا بك يا ${slots.patientName}` : 'يا هلا والله فيك';

  // 3. Intent-Driven Response Synthesis
  switch (primaryIntent) {
    case 'GREETING': {
      return {
        reply: 'يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان بعمان! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟ 🦷',
        isEmergency: false,
      };
    }

    case 'WAITLIST_CONFIRM': {
      return {
        reply: `${nameSalutation}! تم تأكيد طلبك للشاغر وتثبيت اهتمامك بنجاح في مركز نشمي. بانتظار تشريفك وتنورنا بأي وقت! 🦷✨`,
        isEmergency: false,
      };
    }

    case 'RESCHEDULE_CANCEL': {
      return {
        reply: `${nameSalutation}، ولا يهمك وبسيطة أبداً! يرجى تزويدي باسمك الكريم والوقت الجديد اللي بناسبك (أو تأكيد رغبتك بالإلغاء) وبنحدث ملفك بالسيستم فوراً بدون أي غلبة 🦷`,
        isEmergency: false,
      };
    }

    case 'INSURANCE_QUERY': {
      const network = slots.insuranceNetwork || 'معظم شبكات التأمين الرئيسية في الأردن';
      let answer = `${nameSalutation}! مركزنا معتمد رسمياً لـ ${network} (مثل نات هيلث، ميدنت، الشرق العربي GIG). ابعثلي صورة بطاقة التأمين لنتأكدلك من التغطية والموافقة المباشرة فوراً 🦷`;

      if (secondaryIntents.includes('BOOKING_REQUEST')) {
        answer += '\nوبنقدر نرتبلك موعد بنفس الوقت، بس اعطيني اسمك الكريم واليوم المفضل لحتى نثبتلك إياه.';
      }
      return { reply: answer, isEmergency: false };
    }

    case 'PRICING_QUERY': {
      let pricingDetail = 'الكشفية والاستشارة الطبية الشاملة 20 د.أ، وتنظيف وتلميع الأسنان يبدأ من 25 د.أ.';
      if (slots.serviceType === 'whitening') {
        pricingDetail = `تبييض الأسنان بالليزر يشمل جلسة كاملة ومادّة حماية اللثة بتكلفة تقريبية ${formatJOD(120)}.`;
      } else if (slots.serviceType === 'implant') {
        pricingDetail = 'زراعة الأسنان تتضمن أفضل الغرسات السويسرية والألمانية المعتمدة، والتكلفة الدقيقة تحدد بعد الفحص والأشعة البانورامية.';
      } else if (slots.serviceType === 'orthodontics_check') {
        pricingDetail = 'جلسة تقييم واستشارة التقويم 20 د.أ شاملة فحص إطباق الفكين ووضع خطة العلاج.';
      }

      let reply = `${nameSalutation}! ${pricingDetail} والخطة العلاجية والتكلفة النهائية يحددها الطبيب بدقة بعد الفحص السريري. بتحب نرتبلك موعد فحص واستشارة؟ 🦷`;
      return { reply, isEmergency: false };
    }

    case 'SERVICES_QUERY': {
      const serviceName = slots.serviceLabelAr || 'هذا الإجراء';
      let reply = `${nameSalutation}! نعم بالتأكيد، قسم ${serviceName} مجهز بأحدث الأجهزة والتقنيات الطبية المعتمدة في مركز نشمي. بتحب نرتبلك موعد كشف واستشارة مع الطبيب المختص؟ 🦷`;
      return { reply, isEmergency: false };
    }

    case 'LOCATION_HOURS': {
      return {
        reply: 'يا هلا فيك! موقعنا في عمان، الشميساني - مقابل المستشفى التخصصي. دوامنا من السبت للخميس من 09:00 صباحاً حتى 08:00 مساءً (الجمعة عطلة). متوفر مواقف سيارات خاصة ومجانية وخدمة فاليه لراحتك. متى بناسبك تشرفنا؟ 🦷',
        isEmergency: false,
      };
    }

    case 'DOCTOR_INQUIRY': {
      return {
        reply: `${nameSalutation}! يضم كادرنا نخبة من الأطباء الاستشاريين والأخصائيين المعتمدين في جراحة وطب الأسنان والتقويم. وحفاظاً على تركيز أطبائنا داخل غرف العمليات وخصوصيتهم، يتم تنسيق كافة المواعيد والاستشارات عبرنا مباشرة. بتحب نرتبلك موعد فحص سريري؟ 🦷`,
        isEmergency: false,
      };
    }

    case 'FEEDBACK_COMPLAINT': {
      return {
        reply: `${nameSalutation}، سلامتك وألف لا بأس عليك! صحتك وراحتك هي أولويتنا الأولى. تم تسجيل ملاحظتك فوراً، وبحب أطمنك إن طبيب الطوارئ والمناوب سيتابع حالتك ويشرف عليها فوراً. تفضل بالزيارة أو تواصل معنا بأي لحظة 🦷`,
        isEmergency: false,
      };
    }

    case 'BOOKING_REQUEST':
    default: {
      const insuranceNote = (slots.insuranceNetwork || secondaryIntents.includes('INSURANCE_QUERY'))
        ? `ونعم، مركزنا معتمد لـ ${slots.insuranceNetwork || 'شبكات التأمين (مثل ميدنت ونات هيلث)'}. `
        : '';

      if (slots.isMultiPerson && !slots.patientName) {
        return {
          reply: `${insuranceNote}تمام! بس اعطيني اسمك الكريم واسم قريبك/المرافق عشان أثبتلكم المواعيد فوراً 🦷`.trim(),
          isEmergency: false,
        };
      }
      if (!slots.patientName && (slots.specificTime || slots.dayOrDate)) {
        return {
          reply: `${insuranceNote}تمام! بس اعطيني اسمك الكريم عشان أثبتلك الموعد فوراً 🦷`.trim(),
          isEmergency: false,
        };
      }
      if (slots.patientName && slots.specificTime) {
        return {
          reply: `يا هلا بك يا ${slots.patientName}! ${insuranceNote}تم تسجيل طلبك للساعة ${slots.specificTime}. بنثبتلك الموعد بالسيستم فوراً وبانتظارك تنورنا بالمركز! 🦷`.trim(),
          isEmergency: false,
        };
      }

      // Check FAQ fallback before generic default
      try {
        const matchedFaqs = await queryClinicFaq(clinicId, rawText);
        if (matchedFaqs && matchedFaqs.length > 0) {
          return {
            reply: matchedFaqs[0].answer_ar,
            isEmergency: false,
          };
        }
      } catch (_) {}

      return {
        reply: `${nameSalutation}! ${insuranceNote}تكرم عيونك، يسعدنا نرتبلك أنسب موعد بمركز نشمي. بس اعطيني اسمك الكريم واليوم أو الوقت اللي بناسبك (صباحاً أو بعد الظهر) وبنرتبه فوراً 🦷`.trim(),
        isEmergency: false,
      };
    }
  }
}
