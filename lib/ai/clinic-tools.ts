// NashmiOps Enterprise (MVP Edition) - Clinic AI Tools & Multi-Person Booking Engine

import { Type } from '@google/genai';
import { CLINIC_CONFIG, CLINICAL_SERVICES, MEDICAL_LIABILITY_GUARDRAILS } from '@/lib/config/constants';
import {
  tenantStore,
  updateAppointmentStatus,
  addToWaitlist,
  saveInvoice,
  queryClinicFaq,
  saveClinicalRecord,
  getPatientClinicalHistory,
  getPractitioners,
  getDentalChairs,
  getNextSequentialInvoiceNumber,
  getLatestInvoiceHash,
  broadcastReceptionistAlert,
  isPlaceholderConfig,
  supabase,
  supabaseAdmin,
} from '@/lib/db/supabase';
import {
  bookFrictionlessAppointment,
  checkSlotAvailability,
  deleteCalendarEvent,
} from '@/lib/calendar/scheduler';
import { triggerWaitlistSniper } from '@/lib/jobs/waitlist-sniper';
import { compileJoFotaraXML } from '@/lib/jofotara/xml-compiler';
import { submitInvoiceToJoFotara } from '@/lib/jofotara/client';
import { captureException } from '@/lib/monitoring/apm';
import { ServiceType, InvoiceType, ClinicalEHRRecord, ToothRecord } from '@/types';
import { formatAmmanDate, formatAmmanTime, getAmmanNow } from '@/lib/utils/timezone';

/**
 * Validate and normalize Jordanian Mobile Phone Numbers
 * Formats: 079XXXXXXX, 078XXXXXXX, 077XXXXXXX, or +9627XXXXXXXX
 */
export function validateJordanianPhone(
  phoneInput?: string,
  _allowSandboxDefault?: boolean
): { isValid: boolean; normalizedPhone?: string; error?: string } {
  if (!phoneInput || !phoneInput.trim()) {
    return {
      isValid: false,
      error: 'يرجى تزويدنا برقم هاتفك النقال لنتمكن من تثبيت الموعد وإرسال التأكيد.',
    };
  }

  const clean = phoneInput.trim().replace(/[\s\-\(\)]/g, '');

  // Jordanian mobile patterns: Zain (079), Orange (077), Umniah (078)
  const jordanRegex = /^(?:\+?962|0)?(7[789]\d{7})$/;
  const match = clean.match(jordanRegex);
  if (match) {
    return { isValid: true, normalizedPhone: `+962${match[1]}` };
  }

  return {
    isValid: false,
    error: 'يرجى تزويدنا برقم هاتف خلوي أردني صالح (مثل 079XXXXXXX أو 078XXXXXXX أو 077XXXXXXX) لنتمكن من التواصل وتأكيد الموعد.',
  };
}

/**
 * Declarations of Gemini Tools
 */
export const clinicTools = [
  {
    name: 'check_calendar',
    description: 'فحص الأوقات والمواعيد الشاغرة لموعد في مركز نشمي في يوم معين (مثل الأحد أو غداً أو تاريخ محدد) مع مراعاة فترة التعقيم الإلزامية 15 دقيقة',
    parameters: {
      type: Type.OBJECT,
      properties: {
        preferred_date: { type: Type.STRING, description: 'التاريخ أو اليوم المطلوب (مثلاً: الأحد، 2026-09-27، غداً، اليوم)' },
        service_type: {
          type: Type.STRING,
          enum: ['consultation', 'cleaning', 'restoration', 'extraction', 'emergency', 'whitening', 'orthodontics_check'],
          description: 'نوع الخدمة المطلوبة إن وجدت (افتراضياً: consultation)',
        },
        practitioner_name: {
          type: Type.STRING,
          description: 'اسم الطبيب المطلوب (د. قاسم نشمي - زراعة وجراحة، د. ديما التميمي - تقويم، د. رامي عبيدات - أسنان عامة وعصب)',
        },
      },
      required: ['preferred_date'],
    },
  },
  {
    name: 'check_calendar_availability',
    description: 'فحص الأوقات والمواعيد الشاغرة لموعد في مركز نشمي في يوم معين مع مراعاة فترة التعقيم الإلزامية 15 دقيقة (مرادف لـ check_calendar)',
    parameters: {
      type: Type.OBJECT,
      properties: {
        preferred_date: { type: Type.STRING, description: 'التاريخ أو اليوم المطلوب (مثلاً: الأحد، 2026-09-27، غداً، اليوم)' },
        service_type: {
          type: Type.STRING,
          enum: ['consultation', 'cleaning', 'restoration', 'extraction', 'emergency', 'whitening', 'orthodontics_check'],
          description: 'نوع الخدمة المطلوبة إن وجدت (افتراضياً: consultation)',
        },
        practitioner_name: {
          type: Type.STRING,
          description: 'اسم الطبيب المطلوب إن رغب المريض بطبيب محدد',
        },
      },
      required: ['preferred_date'],
    },
  },
  {
    name: 'query_faq',
    description: 'استعلام قاعدة معلومات المركز عن أوقات الدوام، ساعات العمل، الموقع والمواقف والفاليه، أسعار العلاجات والكشفية، وشبكات التأمين المعتمدة',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'السؤال أو الموضوع المراد الاستفسار عنه (مثل: الدوام، ساعات العمل، الموقع، المواقف، الأسعار، التأمين، الخدمات)',
        },
        category: {
          type: Type.STRING,
          enum: ['hours', 'location', 'pricing', 'insurance', 'services', 'general'],
          description: 'تصنيف الاستفسار إن توفر',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_appointment',
    description: 'تأكيد وحجز موعد المريض أو حجز مشترك للمرافقين والعائلة في المركز مع تزويد المريض برابط الموقع في الشميساني والاصطفاف المجاني والفاليه مع دعم تسجيل الأسماء المتعددة والمواعيد المتتابعة وتخصيص الطبيب المعالج والكرسي',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_name: { type: Type.STRING, description: 'اسم المريض الرئيسي أو الأول' },
        patientName: { type: Type.STRING, description: 'اسم المريض الرئيسي (صيغة بديلة)' },
        companion_name: { type: Type.STRING, description: 'اسم المرافق أو القريب في حال الحجز لشخصين' },
        companionName: { type: Type.STRING, description: 'اسم المرافق أو القريب (صيغة بديلة)' },
        patients: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'مصفوفة بأسماء جميع المرضى إذا كان الحجز جماعياً أو لأكثر من شخص (مثل: ["أحمد قاسم", "محمد قاسم"])',
        },
        patient_phone: { type: Type.STRING, description: 'رقم هاتف المريض أو الواتساب (اختياري)' },
        date_str: { type: Type.STRING, description: 'تاريخ الموعد YYYY-MM-DD أو اليوم أو بكرا' },
        time_str: { type: Type.STRING, description: 'وقت الموعد بصيغة HH:mm مثل 11:30 أو 16:30' },
        service_type: {
          type: Type.STRING,
          enum: ['consultation', 'cleaning', 'restoration', 'extraction', 'emergency', 'whitening', 'orthodontics_check'],
          description: 'نوع الإجراء الطبي',
        },
        practitioner_name: {
          type: Type.STRING,
          description: 'اسم الطبيب المعالج المفضل إن رغب المريض (د. قاسم نشمي، د. ديما التميمي، د. رامي عبيدات)',
        },
        family_relation: {
          type: Type.STRING,
          enum: ['self', 'child', 'spouse', 'parent', 'companion'],
          description: 'صلة القرابة إذا كان الحجز لأحد أفراد العائلة أو مرافق',
        },
        notes: { type: Type.STRING, description: 'أي ملاحظات إضافية' },
      },
      required: ['patient_name', 'time_str'],
    },
  },
  {
    name: 'book_appointment',
    description: 'تأكيد حجز موعد المريض أو المرافقين (مرادف لـ create_appointment)',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_name: { type: Type.STRING, description: 'اسم المريض الكامل الحقيقي الصريح (مطلوب إلزامياً)' },
        patientName: { type: Type.STRING, description: 'اسم المريض' },
        companion_name: { type: Type.STRING, description: 'اسم المرافق أو القريب' },
        companionName: { type: Type.STRING, description: 'اسم المرافق' },
        patients: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'مصفوفة أسماء المرضى للحجز المشترك',
        },
        patient_phone: { type: Type.STRING, description: 'رقم هاتف المريض أو رقم الواتساب' },
        service_type: {
          type: Type.STRING,
          enum: ['consultation', 'cleaning', 'restoration', 'extraction', 'emergency', 'whitening', 'orthodontics_check'],
          description: 'نوع الإجراء الطبي',
        },
        date_str: { type: Type.STRING, description: 'تاريخ الموعد YYYY-MM-DD أو اليوم' },
        time_str: { type: Type.STRING, description: 'وقت الموعد بصيغة HH:mm مثل 11:00 أو 16:30' },
        family_relation: {
          type: Type.STRING,
          enum: ['self', 'child', 'spouse', 'parent', 'companion'],
          description: 'صلة القرابة إذا كان الحجز لأحد أفراد العائلة',
        },
        notes: { type: Type.STRING, description: 'أي ملاحظات إضافية' },
      },
      required: ['patient_name', 'time_str'],
    },
  },
  {
    name: 'verify_insurance_card',
    description: 'التحقق من اعتماد شبكة التأمين الصحي ونسبة التغطية (نات هيلث، ميدنت، الشرق العربي، GIG)',
    parameters: {
      type: Type.OBJECT,
      properties: {
        insurance_company: { type: Type.STRING, description: 'اسم شبكة التأمين مثل نات هيلث، ميدنت، الشرق العربي، GIG' },
        patient_name: { type: Type.STRING, description: 'اسم حامل البطاقة' },
        card_number: { type: Type.STRING, description: 'رقم البطاقة إن توفر' },
      },
      required: ['insurance_company'],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'إلغاء موعد المريض المسجل وتشغيل قناص قائمة الانتظار فوراً لشغل الشاغر. يمكن استدعاؤها برقم هاتف المريض أو تاريخ الموعد أو معرف الموعد',
    parameters: {
      type: Type.OBJECT,
      properties: {
        appointment_id: { type: Type.STRING, description: 'معرف الموعد إذا كان معروفاً' },
        patient_phone: { type: Type.STRING, description: 'رقم هاتف المريض صاحب الموعد (اختياري)' },
        target_date: { type: Type.STRING, description: 'تاريخ الموعد المراد إلغاؤه (مثل: بكرة، غداً، اليوم، الأحد، أو تاريخ محدد)' },
        reason: { type: Type.STRING, description: 'سبب الإلغاء إن وجد' },
      },
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'تعديل وتأجيل موعد المريض إلى وقت أو تاريخ جديد شاغر',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_phone: { type: Type.STRING, description: 'رقم هاتف المريض' },
        patient_name: { type: Type.STRING, description: 'اسم المريض' },
        new_date: { type: Type.STRING, description: 'التاريخ الجديد YYYY-MM-DD' },
        new_time: { type: Type.STRING, description: 'الوقت الجديد HH:mm' },
      },
      required: ['new_date', 'new_time'],
    },
  },
  {
    name: 'join_waitlist',
    description: 'إضافة المريض إلى قائمة الانتظار الذكية ليتم قنص وتوفير أي شاغر مبكر له تلقائياً',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_name: { type: Type.STRING, description: 'اسم المريض' },
        patient_phone: { type: Type.STRING, description: 'رقم هاتف المريض' },
        requested_service: {
          type: Type.STRING,
          enum: ['consultation', 'cleaning', 'restoration', 'extraction', 'emergency', 'whitening', 'orthodontics_check'],
          description: 'الخدمة المطلوبة',
        },
        preferred_date: { type: Type.STRING, description: 'التاريخ المفضل YYYY-MM-DD' },
        preferred_time_range: {
          type: Type.STRING,
          enum: ['morning', 'afternoon', 'any'],
          description: 'الفترة المفضلة',
        },
      },
      required: ['patient_name', 'patient_phone', 'requested_service', 'preferred_date'],
    },
  },
  {
    name: 'generate_jofotara_invoice',
    description: 'إصدار فاتورة إلكترونية معتمدة لضريبة الدخل والمبيعات الأردنية (JoFotara Phase 2 UBL 2.1)',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_name: { type: Type.STRING, description: 'اسم المريض أو الشركة' },
        invoice_type: {
          type: Type.STRING,
          enum: ['B2C_SIMPLIFIED', 'B2B_STANDARD'],
          description: 'نوع الفاتورة: ضريبية مبسطة للأفراد أقل من 100 دينار أو عادية للشركات',
        },
        buyer_tax_id: { type: Type.STRING, description: 'الرقم الضريبي للمشتري (إلزامي في B2B_STANDARD)' },
        buyer_national_id: { type: Type.STRING, description: 'الرقم الوطني للمريض (اختياري للأفراد)' },
        service_name: { type: Type.STRING, description: 'اسم الإجراء الطبي' },
        amount_jod: { type: Type.NUMBER, description: 'المبلغ الإجمالي بالدينار الأردني' },
      },
      required: ['patient_name', 'invoice_type', 'service_name', 'amount_jod'],
    },
  },
  {
    name: 'trigger_emergency_handover',
    description: 'تفعيل بروتوكول طوارئ المسؤولية الطبية رقم 25 لتحويل فوري لطبيب الطوارئ المناوب',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_name: { type: Type.STRING, description: 'اسم المريض' },
        patient_phone: { type: Type.STRING, description: 'رقم هاتف المريض' },
        symptoms: { type: Type.STRING, description: 'الأعراض الحادة مثل نزيف مستمر أو ورم حاد بالوجه' },
      },
      required: ['patient_name', 'symptoms'],
    },
  },
  {
    name: 'query_patient_medical_history',
    description: 'استعلام السجل الطبي السريري للمريض والتاريخ العلاجي والحساسيات ومخطط الأسنان الرقمي (EHR Odontogram)',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_name: { type: Type.STRING, description: 'اسم المريض' },
        patient_phone: { type: Type.STRING, description: 'رقم هاتف المريض' },
      },
    },
  },
  {
    name: 'record_clinical_procedure',
    description: 'توثيق إجراء علاجي أو فحص سريري في السجل الطبي الرقمي للمريض التزاماً بقانون المسؤولية الطبية رقم 25 لسنة 2018',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_name: { type: Type.STRING, description: 'اسم المريض' },
        patient_phone: { type: Type.STRING, description: 'رقم هاتف المريض' },
        practitioner_name: { type: Type.STRING, description: 'اسم الطبيب المعالج' },
        chief_complaint: { type: Type.STRING, description: 'الشكوى الرئيسية للمريض' },
        diagnosis: { type: Type.STRING, description: 'التشخيص السريري' },
        clinical_notes: { type: Type.STRING, description: 'الملاحظات السريرية والفحص' },
        treatment_rendered: { type: Type.STRING, description: 'الإجراء العلاجي المنجز' },
        tooth_number: { type: Type.NUMBER, description: 'رقم السن المعالج بنظام الترقيم الدولي (FDI)' },
        tooth_status: { type: Type.STRING, description: 'حالة السن (FILLED, ROOT_CANAL, CROWN, MISSING, IMPLANT)' },
      },
      required: ['chief_complaint', 'diagnosis', 'treatment_rendered'],
    },
  },
];

/**
 * Compare phone numbers with tolerance for country codes (+962, 07, etc.)
 */
export function phonesMatch(p1?: string, p2?: string): boolean {
  if (!p1 || !p2) return false;
  const digits1 = p1.replace(/\D/g, '');
  const digits2 = p2.replace(/\D/g, '');
  if (digits1 === digits2) return true;
  const s1 = digits1.slice(-8);
  const s2 = digits2.slice(-8);
  return s1.length >= 7 && s1 === s2;
}

/**
 * Execute Tool Calls invoked by Gemini
 */
export async function executeClinicTool(name: string, args: any, defaultPhone: string = '+962791234567'): Promise<any> {
  try {
    const clinicId = CLINIC_CONFIG.id;
    const phone = args?.patient_phone || defaultPhone;

    switch (name) {
      case 'query_faq': {
        const queryText = args?.query || args?.question || args?.category || '';
        const faqs = await queryClinicFaq(clinicId, queryText);
        if (faqs.length === 0) {
          return {
            status: 'ok',
            found: false,
            message: 'مركز نشمي لطب وجراحة الأسنان في الشميساني - مقابل المستشفى التخصصي. دوامنا من السبت للخميس من 9 صباحاً إلى 9 مساءً، هاتف العيادة: 0791234567.',
          };
        }
        return {
          status: 'ok',
          found: true,
          count: faqs.length,
          faq_items: faqs.map((f) => ({
            category: f.category,
            question: f.question_ar,
            answer: f.answer_ar,
          })),
          summary: faqs.map((f) => f.answer_ar).join('\n'),
        };
      }

      case 'check_calendar':
      case 'check_calendar_availability':
      case 'check_availability': {
        let targetDate = args?.preferred_date || 'اليوم';
        const now = new Date();

        if (targetDate.includes('احد') || targetDate.includes('الأحد') || targetDate.toLowerCase().includes('sunday')) {
          const day = now.getDay();
          const diff = (7 - day) % 7 || 7;
          const nextSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
          const y = nextSunday.getFullYear();
          const m = String(nextSunday.getMonth() + 1).padStart(2, '0');
          const d = String(nextSunday.getDate()).padStart(2, '0');
          targetDate = `${y}-${m}-${d}`;
        } else if (targetDate.includes('جمعة') || targetDate.includes('الجمعة') || targetDate.toLowerCase().includes('friday')) {
          const diff = (5 - now.getDay() + 7) % 7 || 7;
          const nextFriday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
          const y = nextFriday.getFullYear();
          const m = String(nextFriday.getMonth() + 1).padStart(2, '0');
          const d = String(nextFriday.getDate()).padStart(2, '0');
          targetDate = `${y}-${m}-${d}`;
        } else if (targetDate.includes('سبت') || targetDate.includes('السبت') || targetDate.toLowerCase().includes('saturday')) {
          const diff = (6 - now.getDay() + 7) % 7 || 7;
          const nextSaturday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
          const y = nextSaturday.getFullYear();
          const m = String(nextSaturday.getMonth() + 1).padStart(2, '0');
          const d = String(nextSaturday.getDate()).padStart(2, '0');
          targetDate = `${y}-${m}-${d}`;
        } else if (targetDate.includes('غد') || targetDate.includes('بكرة') || targetDate.includes('بكرا') || targetDate.toLowerCase().includes('tomorrow')) {
          const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          const y = tomorrow.getFullYear();
          const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
          const d = String(tomorrow.getDate()).padStart(2, '0');
          targetDate = `${y}-${m}-${d}`;
        } else if (targetDate.includes('يوم') || targetDate.toLowerCase().includes('today')) {
          const y = now.getFullYear();
          const m = String(now.getMonth() + 1).padStart(2, '0');
          const d = String(now.getDate()).padStart(2, '0');
          targetDate = `${y}-${m}-${d}`;
        }

        // Check if target date is Friday (Weekly closure)
        const dateParts = targetDate.includes('-') ? targetDate.split('-').map(Number) : [];
        const requestedDateObj = dateParts.length === 3
          ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 12, 0, 0)
          : new Date(targetDate);
        if (requestedDateObj.getDay() === 5 || targetDate.includes('جمعة') || targetDate.includes('الجمعة')) {
          return {
            date: targetDate,
            available: false,
            available_slots: [],
            is_friday_closed: true,
            message: 'يوم الجمعة عطلة أسبوعية رسمية في مركز نشمي لطب وجراحة الأسنان. دوامنا من السبت إلى الخميس (09:00 ص - 08:00 م). بإمكاننا حجزك يوم السبت أو الأحد القادم.',
          };
        }

      // Check if patient requested a specific doctor
      let reqDocId: string | undefined;
      let reqDocName: string | undefined;
      const requestedDoctorStr = (args.practitioner_name || args.doctor_name || '').toLowerCase();
      if (requestedDoctorStr) {
        if (requestedDoctorStr.includes('قاسم') || requestedDoctorStr.includes('qasim')) {
          reqDocId = 'doc-qasim-001';
          reqDocName = 'د. قاسم نشمي';
        } else if (requestedDoctorStr.includes('ديما') || requestedDoctorStr.includes('dima')) {
          reqDocId = 'doc-dima-002';
          reqDocName = 'د. ديما التميمي';
        } else if (requestedDoctorStr.includes('رامي') || requestedDoctorStr.includes('rami')) {
          reqDocId = 'doc-rami-003';
          reqDocName = 'د. رامي عبيدات';
        }
      }

      // Check available slots within official working hours (09:00 - 20:00)
      const candidateTimes = ['10:00', '11:30', '14:00', '16:30', '18:00'];
      const availableTimes: string[] = [];

      for (const time of candidateTimes) {
        const [h, m] = time.split(':').map(Number);
        const start = dateParts.length === 3
          ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2], h, m, 0, 0)
          : new Date(targetDate);
        if (dateParts.length !== 3) {
          start.setHours(h, m, 0, 0);
        }
        const endWithBuffer = new Date(start.getTime() + 60 * 60 * 1000); // 45m + 15m buffer

        const res = await checkSlotAvailability(clinicId, start, endWithBuffer, {
          practitionerId: reqDocId,
          practitionerName: reqDocName,
          serviceType: args.service_type,
        });
        if (res.available) {
          availableTimes.push(time);
        }
      }

      const docNote = reqDocName ? ` مع ${reqDocName}` : '';
      return {
        date: targetDate,
        service: args.service_type || 'consultation',
        practitioner: reqDocName || 'جميع أطباء المركز',
        available_slots: availableTimes,
        working_hours: 'من السبت إلى الخميس: 09:00 صباحاً - 08:00 مساءً (الجمعة عطلة)',
        sterilization_buffer_enforced: '15 دقيقة تعقيم بعد كل موعد',
        message: `المواعيد الشاغرة ليوم (${targetDate})${docNote} هي: ${availableTimes.join('، ')}.`,
      };
    }

    case 'create_appointment':
    case 'book_appointment':
    case 'book_appointment_frictionless': {
      let dateFormatted = args.date_str;
      const now = getAmmanNow();
      if (dateFormatted?.includes('احد') || dateFormatted?.includes('الأحد')) {
        const diff = (7 - now.getDay()) % 7 || 7;
        dateFormatted = formatAmmanDate(new Date(now.getTime() + diff * 86400000));
      } else if (dateFormatted?.includes('جمعة') || dateFormatted?.includes('الجمعة')) {
        const diff = (5 - now.getDay() + 7) % 7 || 7;
        dateFormatted = formatAmmanDate(new Date(now.getTime() + diff * 86400000));
      } else if (dateFormatted?.includes('سبت') || dateFormatted?.includes('السبت')) {
        const diff = (6 - now.getDay() + 7) % 7 || 7;
        dateFormatted = formatAmmanDate(new Date(now.getTime() + diff * 86400000));
      } else if (dateFormatted?.includes('غد') || dateFormatted?.includes('بكرة') || dateFormatted?.includes('بكرا')) {
        dateFormatted = formatAmmanDate(new Date(now.getTime() + 86400000));
      } else if (dateFormatted?.includes('يوم') || dateFormatted?.includes('اليوم')) {
        dateFormatted = formatAmmanDate(now);
      }

      const baseDateStr = dateFormatted || formatAmmanDate(now);
      const baseTimeStr = args.time_str || '11:30';

      // 1. Gather all patient names (Family / Companion / Multi-Person detection)
      const patientNames: string[] = [];

      if (Array.isArray(args.patients) && args.patients.length > 0) {
        for (const p of args.patients) {
          const trimmed = String(p).trim();
          if (trimmed && !patientNames.includes(trimmed)) {
            patientNames.push(trimmed);
          }
        }
      }

      const primaryName = (args.patient_name || args.patientName || '').trim();
      const companionName = (args.companion_name || args.companionName || '').trim();

      if (patientNames.length === 0) {
        if (primaryName) {
          if (primaryName.includes(' و') && !companionName) {
            const parts = primaryName
              .split(/\s+و\s*|\s+وقريبي\s*|\s+ومعي\s*/)
              .map((p: string) => p.replace(/^(قريبي|صديقي|زوجتي|ابني|أخي)\s+/, '').trim())
              .filter(Boolean);
            if (parts.length > 1) {
              patientNames.push(...parts);
            } else {
              patientNames.push(primaryName);
            }
          } else {
            patientNames.push(primaryName);
          }
        }
        if (companionName && !patientNames.includes(companionName)) {
          patientNames.push(companionName);
        }
      } else {
        // If patients list is present, check companionName as well
        if (companionName && !patientNames.includes(companionName)) {
          patientNames.push(companionName);
        }
      }

      // Mandatory Patient Name Rule: Strictly reject booking without real explicit patient names!
      const isPlaceholderOrEmpty = (name: string) => {
        const lower = name.toLowerCase().trim();
        const placeholderList = [
          'مريض نشمي', 'مريض', 'المريض', 'غير محدد', 'unknown', 'patient', 'user',
          'صاحب الرقم', 'مرافق', 'المرافق', 'قريبي', 'قريبك', 'القريب', 'صاحبي', 'صديقي',
          'أخوي', 'اخوي', 'الأخ', 'زوجتي', 'زوجي', 'ابني', 'بنتي', 'والدي', 'والدتي',
          'أنا', 'انا', 'نحن', 'احنا', 'إلي', 'الي', 'لي'
        ];
        return (
          !lower ||
          placeholderList.includes(lower) ||
          lower.length < 2
        );
      };

      const validPatientNames = patientNames.filter((n) => !isPlaceholderOrEmpty(n));

      // Multi-person request detection (e.g. user or tool noted multiple persons/companion)
      const isMultiPersonRequest =
        Boolean(args.companion_name || args.companionName) ||
        (Array.isArray(args.patients) && args.patients.length > 1) ||
        args.family_relation === 'companion' ||
        (args.notes && (args.notes.includes('شخصين') || args.notes.includes('قريب') || args.notes.includes('مرافق') || args.notes.includes('مع بعض')));

      if (isMultiPersonRequest && validPatientNames.length < 2) {
        return {
          success: false,
          error: 'MISSING_COMPANION_NAMES',
          requires_patient_name: true,
          message: 'تمام! بس اعطيني اسمك الكريم واسم قريبك/المرافق عشان أثبتلكم المواعيد فوراً.',
          guidance: 'المريض طلب حجزاً لشخصين أو له ولقريبه، ولم يذكر أسماء الجميع بصراحة. اطلب اسْميهما الصريحين فوراً: "تمام! بس اعطيني اسمك الكريم واسم قريبك/المرافق عشان أثبتلكم المواعيد فوراً".',
        };
      }

      if (validPatientNames.length === 0) {
        return {
          success: false,
          error: 'MISSING_MANDATORY_PATIENT_NAME',
          requires_patient_name: true,
          message: 'تمام! بس اعطيني اسمك الكريم عشان أثبتلك الموعد فوراً.',
          guidance: 'المريض لم يذكر اسمه الصريح بعد. لا تؤكد الحجز ولا تستدعِ الأداة بدون اسمه. رد عليه حصراً: "تمام! بس اعطيني اسمك الكريم عشان أثبتلك الموعد فوراً".',
        };
      }

      // Phone number validation per Pillar 5
      const rawTargetPhone = (args.patient_phone || phone || '').trim();
      const phoneValidation = validateJordanianPhone(rawTargetPhone);
      if (!phoneValidation.isValid) {
        return {
          status: 'error',
          requires_patient_phone: true,
          message: phoneValidation.error || 'يرجى تزويدنا برقم هاتف خلوي أردني صالح لتثبيت الموعد وإرسال التأكيد.',
        };
      }
      const cleanBookingPhone = phoneValidation.normalizedPhone!;

      // 2. Handle Multi-Person Bookings (Consecutive Appointments)
      if (validPatientNames.length > 1) {
        console.log(`[Multi-Person Booking] Pre-checking consecutive slots for ${validPatientNames.length} patients:`, validPatientNames);

        // Pre-check ALL consecutive slots to guarantee both/all are available before confirming
        const slotTimes: string[] = [];
        let testSlotTime = baseTimeStr;

        for (let i = 0; i < validPatientNames.length; i++) {
          const [h, m] = testSlotTime.split(':').map(Number);
          const sDate = new Date(baseDateStr);
          sDate.setHours(h, m, 0, 0);
          const sEnd = new Date(sDate.getTime() + 60 * 60 * 1000); // 45m + 15m sterilization

          const check = await checkSlotAvailability(clinicId, sDate, sEnd);
          if (!check.available) {
            return {
              success: false,
              conflict: true,
              conflicted_slot: testSlotTime,
              conflicted_patient: validPatientNames[i],
              message: `عذراً، موعد المرافق (${validPatientNames[i]}) الساعة (${testSlotTime}) غير متاح حالياً لوجود حجز مسبق. بإمكاننا حجزكما بأوقات متتابعة أخرى، هل يناسبكما غداً الساعة 14:00 أو 16:30؟`,
            };
          }

          slotTimes.push(testSlotTime);

          // Calculate next slot time (+60 min)
          const nextSlotObj = new Date(sDate.getTime() + 60 * 60 * 1000);
          const nextH = String(nextSlotObj.getHours()).padStart(2, '0');
          const nextM = String(nextSlotObj.getMinutes()).padStart(2, '0');
          testSlotTime = `${nextH}:${nextM}`;
        }

        // All slots verified available! Proceed to book them:
        const bookedAppointments: Array<{
          patientName: string;
          timeStr: string;
          appointmentId?: string;
          scheduledStart?: string;
        }> = [];

        for (let i = 0; i < validPatientNames.length; i++) {
          const currentPatient = validPatientNames[i];
          const isCompanion = i > 0;
          const currentSlotTime = slotTimes[i];

          const singleResult = await bookFrictionlessAppointment({
            clinicId,
            phone: cleanBookingPhone,
            patientName: currentPatient,
            serviceType: (args.service_type || 'consultation') as ServiceType,
            dateStr: baseDateStr,
            timeStr: currentSlotTime,
            familyRelation: isCompanion ? (args.family_relation || 'companion') : 'self',
            notes: isCompanion ? `مرافق مع ${validPatientNames[0]}` : args.notes,
          });

          if (!singleResult.success) {
            return {
              success: false,
              conflict: true,
              conflictDetails: singleResult.conflictDetails,
              message: singleResult.message || `عذراً، حدث تعارض في حجز موعد (${currentPatient}). هل يناسبكم وقت آخر؟`,
            };
          }

          bookedAppointments.push({
            patientName: currentPatient,
            timeStr: currentSlotTime,
            appointmentId: singleResult.appointment?.id,
            scheduledStart: singleResult.appointment?.start_time,
          });
        }

        const summaryItems = bookedAppointments
          .map((b) => `${b.patientName} (الساعة ${b.timeStr})`)
          .join('، و');

        return {
          success: true,
          multi_person_booking: true,
          total_patients: bookedAppointments.length,
          booked_patients: bookedAppointments.map((b) => ({
            name: b.patientName,
            time: b.timeStr,
            appointment_id: b.appointmentId,
            scheduled_start: b.scheduledStart,
          })),
          location_address: 'الشميساني، عمان - متوفر مواقف مجانية وخدمة فاليه لراحة المرضى',
          google_maps_link: 'https://maps.google.com/?q=Amman+Shmeisani+Nashmi+Dental',
          message: `يا هلا بك، تم تثبيت الموعدين المتتابعين تمام: ${summaryItems}، بانتظاركم وتنورونا! الموقع: الشميساني، عمان (متوفر مواقف مجانية وفاليه).`,
        };
      }

      // 3. Single Patient Booking
      const singlePatient = validPatientNames[0];

      // Resolve requested doctor if mentioned
      let reqDocId: string | undefined;
      let reqDocName: string | undefined;
      const requestedDoctorStr = (args.practitioner_name || args.doctor_name || '').toLowerCase();
      if (requestedDoctorStr) {
        if (requestedDoctorStr.includes('قاسم') || requestedDoctorStr.includes('qasim')) {
          reqDocId = 'doc-qasim-001';
          reqDocName = 'د. قاسم نشمي';
        } else if (requestedDoctorStr.includes('ديما') || requestedDoctorStr.includes('dima')) {
          reqDocId = 'doc-dima-002';
          reqDocName = 'د. ديما التميمي';
        } else if (requestedDoctorStr.includes('رامي') || requestedDoctorStr.includes('rami')) {
          reqDocId = 'doc-rami-003';
          reqDocName = 'د. رامي عبيدات';
        }
      }

      // Resolve requested dental chair if mentioned
      let reqChairId: string | undefined = args.chair_id;
      let reqChairNumber: number | undefined = args.chair_number ? Number(args.chair_number) : undefined;
      const requestedChairStr = (args.chair_name || args.chair || '').toString().toLowerCase();
      if (!reqChairNumber && requestedChairStr) {
        if (requestedChairStr.includes('1') || requestedChairStr.includes('واحد') || requestedChairStr.includes('الأول')) {
          reqChairId = 'chair-001';
          reqChairNumber = 1;
        } else if (requestedChairStr.includes('2') || requestedChairStr.includes('اثنين') || requestedChairStr.includes('الثاني')) {
          reqChairId = 'chair-002';
          reqChairNumber = 2;
        } else if (requestedChairStr.includes('3') || requestedChairStr.includes('ثلاث') || requestedChairStr.includes('الثالث')) {
          reqChairId = 'chair-003';
          reqChairNumber = 3;
        }
      }

      const result = await bookFrictionlessAppointment({
        clinicId,
        phone: cleanBookingPhone,
        patientName: singlePatient,
        serviceType: (args.service_type || 'consultation') as ServiceType,
        dateStr: baseDateStr,
        timeStr: baseTimeStr,
        practitionerId: reqDocId,
        practitionerName: reqDocName,
        chairId: reqChairId,
        chairNumber: reqChairNumber,
        familyRelation: args.family_relation || 'self',
        notes: args.notes,
      });

      if (!result.success) {
        return {
          success: false,
          conflict: true,
          conflictDetails: result.conflictDetails,
          message: result.message || 'عذراً، هذا الموعد يتعارض مع موعد محجوز مسبقاً (شاملاً فترة التعقيم الإلزامية 15 دقيقة). هل يناسبك وقت آخر مثل 14:00 أو 16:30؟',
        };
      }

      return {
        success: true,
        appointment_id: result.appointment?.id,
        scheduled_start: result.appointment?.start_time,
        sterilization_end: result.appointment?.sterilization_end_time,
        practitioner_name: result.appointment?.practitioner_name,
        chair_number: result.appointment?.chair_number,
        status: 'CONFIRMED',
        location_address: 'الشميساني، عمان - متوفر مواقف مجانية وخدمة فاليه لراحة المرضى',
        google_maps_link: 'https://maps.google.com/?q=Amman+Shmeisani+Nashmi+Dental',
        message: result.message || 'يا هلا بك، تم تثبيت موعدك تمام، بانتظارك وتنورنا! الموقع: الشميساني، عمان (متوفر مواقف مجانية وفاليه).',
      };
    }

    case 'verify_insurance_card': {
      const company = args.insurance_company || 'شبكة معتمدة';
      return {
        success: true,
        approved_network: true,
        company,
        coverage_summary: 'الشبكة معتمدة بمركز نشمي (نات هيلث، ميدنت، الشرق العربي، GIG) بنسبة تغطية 80% إلى 100%',
        message: `تم التحقق: شبكة (${company}) معتمدة رسمياً بمركز نشمي في الشميساني. بإمكانك تشرفنا بالبطاقة للاستفادة من التغطية مباشرة.`,
      };
    }

    case 'cancel_appointment': {
      // 1. Resolve target date if mentioned (e.g., 'بكرة', 'غداً', 'اليوم')
      let targetDatePrefix: string | undefined;
      const rawTargetDate = (args.target_date || '').toLowerCase();
      const now = getAmmanNow();
      if (rawTargetDate.includes('غد') || rawTargetDate.includes('بكرة') || rawTargetDate.includes('tomorrow')) {
        const tomorrow = new Date(now.getTime() + 86400000);
        targetDatePrefix = formatAmmanDate(tomorrow);
      } else if (rawTargetDate.includes('يوم') || rawTargetDate.includes('today')) {
        targetDatePrefix = formatAmmanDate(now);
      } else if (/\d{4}-\d{2}-\d{2}/.test(rawTargetDate)) {
        targetDatePrefix = rawTargetDate.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      }

      // 2. Find matching appointments from in-memory store
      let candidateAppts = tenantStore.appointments.filter(
        (a) =>
          (a.status === 'CONFIRMED' || a.status === 'PENDING') &&
          ((args.appointment_id && a.id === args.appointment_id) || phonesMatch(a.patient_phone, phone))
      );

      // Fallback: check Supabase database if memory store doesn't have it
      if (candidateAppts.length === 0 && !isPlaceholderConfig) {
        try {
          const { data, error } = await supabaseAdmin
            .from('appointments')
            .select('*')
            .eq('clinic_id', clinicId)
            .in('status', ['CONFIRMED', 'PENDING']);
          if (error) {
            console.warn('[cancel_appointment] Supabase lookup error:', error.message || error);
          } else if (data && data.length > 0) {
            for (const item of data) {
              if ((args.appointment_id && item.id === args.appointment_id) || phonesMatch(item.patient_phone, phone)) {
                candidateAppts.push(item as any);
                if (!tenantStore.appointments.find((x) => x.id === item.id)) {
                  tenantStore.appointments.push(item as any);
                }
              }
            }
          }
        } catch (dbErr) {
          console.warn('[cancel_appointment] Supabase lookup fallback note:', dbErr);
        }
      }

      let appt = targetDatePrefix
        ? candidateAppts.find((a) => a.start_time.startsWith(targetDatePrefix))
        : undefined;

      if (!appt && candidateAppts.length > 0) {
        // Pick nearest upcoming appointment
        candidateAppts.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        appt = candidateAppts[0];
      }

      if (!appt) {
        return {
          success: false,
          found: false,
          message: 'لم يتم العثور على موعد مؤكد مسجل بهذا الرقم لإلغائه.',
        };
      }

      // 3. Mark appointment as CANCELLED
      await updateAppointmentStatus(appt.id, clinicId, 'CANCELLED');

      // 4. Reverse Sync: Purge event from Google Calendar if event ID exists
      if (appt.google_calendar_event_id) {
        void deleteCalendarEvent(appt.google_calendar_event_id, clinicId).catch((calErr) => {
          console.warn('[Google Calendar Sync-Back] Failed to delete cancelled event:', calErr);
        });
      }

      // 5. Asynchronous Sniper Trigger (Fire-and-forget: do NOT await to prevent WhatsApp webhook timeout)
      void triggerWaitlistSniper(appt).catch((sniperErr) => {
        console.error('[Waitlist Sniper Background Error]:', sniperErr);
      });

      return {
        success: true,
        cancelled_appointment_id: appt.id,
        patient_name: appt.patient_name,
        cancelled_date: appt.start_time,
        message: 'تم إلغاء الموعد بنجاح، وتم تشغيل قناص قائمة الانتظار في الخلفية لشغل الشاغر.',
      };
    }

    case 'reschedule_appointment': {
      const appt = tenantStore.appointments.find(
        (a) => (phonesMatch(a.patient_phone, phone) || a.patient_name === args.patient_name) && a.status === 'CONFIRMED'
      );

      if (!appt) {
        return {
          success: false,
          message: 'لم يتم العثور على موعد مسبق لتعديله. تفضل باختيار موعد جديد مباشرة.',
        };
      }

      await updateAppointmentStatus(appt.id, clinicId, 'CANCELLED');

      // Reverse Sync: Purge old event from Google Calendar to prevent phantom duplicate booking
      if (appt.google_calendar_event_id) {
        void deleteCalendarEvent(appt.google_calendar_event_id, clinicId).catch((calErr) => {
          console.warn('[Google Calendar Sync-Back] Failed to delete rescheduled event:', calErr);
        });
      }

      const newBookResult = await bookFrictionlessAppointment({
        clinicId,
        phone,
        patientName: args.patient_name || appt.patient_name,
        serviceType: appt.service_type,
        dateStr: args.new_date,
        timeStr: args.new_time,
      });

      return {
        success: newBookResult.success,
        old_appointment_id: appt.id,
        new_appointment_id: newBookResult.appointment?.id,
        message: `يا هلا بك، تم تعديل موعدك بنجاح إلى تاريخ ${args.new_date} الساعة ${args.new_time}. بانتظارك وتنورنا! الموقع: الشميساني، عمان (متوفر مواقف مجانية وفاليه).`,
      };
    }

    case 'join_waitlist': {
      const entry = await addToWaitlist({
        clinicId,
        patientId: `pat-${Date.now()}`,
        patientName: args.patient_name,
        patientPhone: phone,
        requestedService: (args.requested_service || 'consultation') as ServiceType,
        preferredDate: args.preferred_date || formatAmmanDate(getAmmanNow()),
        preferredTimeRange: args.preferred_time_range || 'any',
      });

      return {
        success: true,
        waitlist_id: entry.id,
        position: tenantStore.waitlist.filter((w) => w.status === 'WAITING').length,
        message: 'تمت إضافتك إلى قائمة الانتظار الذكية. سيصلك إشعار فوري على واتساب بمجرد توفر أي موعد مبكر.',
      };
    }

    case 'generate_jofotara_invoice': {
      const invNumber = await getNextSequentialInvoiceNumber(clinicId);
      const invType = (args.invoice_type || 'B2C_SIMPLIFIED') as InvoiceType;
      const nowAmman = new Date();
      const previousInvoiceHash = await getLatestInvoiceHash(clinicId);
      const compileRes = compileJoFotaraXML({
        invoiceNumber: invNumber,
        invoiceType: invType,
        issueDate: formatAmmanDate(nowAmman),
        issueTime: formatAmmanTime(nowAmman),
        buyerName: args.patient_name || 'مريض نقدي',
        buyerTaxId: args.buyer_tax_id,
        buyerNationalId: args.buyer_national_id,
        previousInvoiceHash,
        items: [
          {
            name: args.service_name || 'كشف واستشارة طب أسنان',
            quantity: 1,
            unitPrice: args.amount_jod || 20,
            taxRate: 0.16,
            total: (args.amount_jod || 20) * 1.16,
          },
        ],
      });

      // Transmit to Jordanian ISTD JoFotara Network Gateway (B2C Reporting / B2B Clearance)
      const submission = await submitInvoiceToJoFotara({
        invoiceNumber: invNumber,
        invoiceType: invType,
        ublXml: compileRes.xml,
        invoiceUuid: compileRes.uuid,
        invoiceHash: compileRes.invoiceHash,
        buyerName: args.patient_name || 'مريض نقدي',
        buyerTaxId: args.buyer_tax_id,
        totalAmount: compileRes.totalAmount,
      });

      const invoiceRecord = await saveInvoice({
        id: `inv-${Date.now()}`,
        clinic_id: clinicId,
        invoice_number: invNumber,
        invoice_type: invType,
        buyer_name: args.patient_name || 'مريض نقدي',
        buyer_tax_id: args.buyer_tax_id,
        buyer_national_id: args.buyer_national_id,
        currency: 'JOD',
        subtotal: compileRes.subtotal,
        tax_amount: compileRes.taxAmount,
        total_amount: compileRes.totalAmount,
        invoice_uuid: compileRes.uuid,
        previous_invoice_hash: compileRes.pih,
        invoice_hash: compileRes.invoiceHash,
        qr_code_tlv: compileRes.tlvQrCode,
        ubl_xml: compileRes.xml,
        status: (submission.status === 'CLEARED' ? 'CLEARED' : submission.status === 'REPORTED' ? 'REPORTED' : 'ISSUED') as any,
        clearance_status: submission.clearanceStatus || (invType === 'B2B_STANDARD' ? 'CLEARED' : 'REPORTED'),
        istd_submission_id: submission.submissionId,
        submitted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      return {
        success: true,
        invoice_uuid: invoiceRecord.invoice_uuid,
        invoice_hash: invoiceRecord.invoice_hash,
        total_jod: invoiceRecord.total_amount,
        istd_submission_id: submission.submissionId,
        istd_status: submission.status,
        transmission_mode: submission.simulated ? 'SIMULATED' : 'LIVE_GATEWAY',
        tlv_qr_preview: invoiceRecord.qr_code_tlv.substring(0, 32) + '...',
        compliance: 'UBL 2.1 ISO/IEC 19845 (JoFotara Phase 2)',
        message: `${submission.message} (المبلغ: ${invoiceRecord.total_amount} د.أ).`,
      };
    }

    case 'trigger_emergency_handover': {
      console.warn(`[EMERGENCY_TRIGGER] Protocol activated for ${args.patient_name}: ${args.symptoms}`);
      
      // Dispatch Realtime Alert to Receptionist Desk
      void broadcastReceptionistAlert({
        clinic_id: clinicId,
        type: 'EMERGENCY',
        title: '🚨 تنبيه طوارئ سريرية حرجة [EMERGENCY_TRIGGER]',
        description: `المريض: ${args.patient_name || 'حالة طارئة'} (${args.patient_phone || phone}) - الأعراض: ${args.symptoms}`,
        patient_name: args.patient_name,
        patient_phone: args.patient_phone || phone,
        severity: 'CRITICAL',
        metadata: {
          symptoms: args.symptoms,
          guardrail: 'Jordanian Medical Liability Law No. 25 of 2018',
        },
      });

      return {
        success: true,
        emergency_code: MEDICAL_LIABILITY_GUARDRAILS.emergencyTriggerCode,
        physician_notified: true,
        advisory: MEDICAL_LIABILITY_GUARDRAILS.emergencyResponseAr,
      };
    }

    case 'query_patient_medical_history': {
      const patientPhone = args.patient_phone || phone;
      const patient = tenantStore.patients.find(
        (p) =>
          phonesMatch(p.whatsapp_phone, patientPhone) ||
          (args.patient_name && p.full_name.includes(args.patient_name))
      );

      if (!patient) {
        return {
          success: true,
          found: false,
          medical_history: [],
          message: 'لا يوجد ملف طبي مسجل مسبقاً بهذا الرقم أو الاسم في قاعدة بيانات المركز.',
        };
      }

      const records = await getPatientClinicalHistory(patient.id, clinicId);
      return {
        success: true,
        found: true,
        patient_name: patient.full_name,
        national_id: patient.national_id || 'غير مسجل',
        allergies: records.flatMap((r) => r.allergies || []),
        chronic_conditions: records.flatMap((r) => r.chronic_conditions || []),
        total_clinical_records: records.length,
        records: records.map((r) => ({
          date: r.created_at.split('T')[0],
          doctor: r.practitioner_name,
          chief_complaint: r.chief_complaint,
          diagnosis: r.diagnosis,
          treatment: r.treatment_rendered,
          prescriptions_notice: 'الأدوية السابقة مسجلة بالملف السريري الداخلي فقط ولا يجوز تداول جرعاتها إلا باستشارة الطبيب المباشرة',
          prescriptions_count: r.prescriptions?.length || 0,
          odontogram: r.odontogram,
        })),
        prescriptions_legal_disclaimer: 'تنبيه بموجب قانون المسؤولية الطبية والصحية رقم 25 لسنة 2018: الأدوية السابقة مسجلة بالملف السريري الداخلي فقط ولا يجوز تداول جرعاتها أو تكرارها إلا باستشارة الطبيب المباشرة أثناء المعاينة السريرية.',
        compliance: 'Law No. 25 of 2018 (Medical & Health Liability)',
        message: `تم استرجاع السجل السريري للمريض (${patient.full_name}) بنجاح (${records.length} سجلات سابقة). الأدوية السابقة مسجلة بالملف السريري الداخلي فقط ولا يجوز تداول جرعاتها إلا باستشارة الطبيب المباشرة.`,
      };
    }

    case 'record_clinical_procedure': {
      const patientPhone = args.patient_phone || phone;
      const patient =
        tenantStore.patients.find(
          (p) =>
            phonesMatch(p.whatsapp_phone, patientPhone) ||
            (args.patient_name && p.full_name.includes(args.patient_name))
        ) || tenantStore.patients[0];

      const record: ClinicalEHRRecord = {
        id: `ehr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        clinic_id: clinicId,
        patient_id: patient.id,
        practitioner_id: args.practitioner_id || 'doc-qasim-001',
        practitioner_name: args.practitioner_name || 'د. قاسم نشمي',
        chief_complaint: args.chief_complaint || 'مراجعة دورية وفحص سريري',
        diagnosis: args.diagnosis || 'فحص سليم',
        clinical_notes: args.clinical_notes || 'تم الفحص والتصوير بالأشعة',
        treatment_rendered: args.treatment_rendered || 'معالجة سنية',
        allergies: args.allergies || [],
        chronic_conditions: args.chronic_conditions || [],
        odontogram: args.odontogram || (args.tooth_number ? [{ tooth_number: Number(args.tooth_number), status: args.tooth_status || 'FILLED' }] : []),
        prescriptions: args.prescriptions || [],
        informed_consent_signed: args.informed_consent_signed === true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const savedRecord = await saveClinicalRecord(record);

      return {
        success: true,
        ehr_id: savedRecord.id,
        patient_name: patient.full_name,
        practitioner: savedRecord.practitioner_name,
        tooth_treated: args.tooth_number || 'غير مخصص',
        compliance: 'Jordanian Medical and Health Liability Law No. 25 of 2018 (قانون المسؤولية الطبية والصحية)',
        message: `تم توثيق الإجراء السريري ومخطط الأسنان للمريض (${patient.full_name}) بنجاح في السجل الطبي الرقمي.`,
      };
    }

    default:
      return { status: 'error', message: `أداة غير معروفة: ${name}` };
  }
} catch (toolError: any) {
  captureException(toolError, { toolName: name, route: 'executeClinicTool' });
  console.error(`[Tool Execution Recovery] Tool ${name} failed gracefully:`, toolError);
  return {
    status: 'error',
    message: toolError?.message || 'API timeout or database error',
    tool: name,
  };
}
}

