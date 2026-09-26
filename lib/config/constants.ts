// NashmiOps Enterprise (MVP Edition) - Configuration & Clinical Constants

import { ServiceDefinition, ServiceType } from '@/types';

export const CLINIC_CONFIG = {
  id: 'clinic-amman-nashmi-001',
  name: 'نظام ترتيب - العيادة التجريبية',
  nameEn: 'Tarteeb Medical OS - Demo Clinic',
  phone: '+96265000000',
  whatsappPhone: '+962790000000',
  address: 'عمان - الدوار السابع - مجمع النشامى الطبي - الطابق الثالث',
  googleMapsUrl: 'https://maps.google.com/?q=31.9539,35.8578', // Amman 7th Circle
  taxNumber: '100492837', // ISTD Registered Tax Number
  licenseNumber: 'MOH-JO-2024-9981', // Ministry of Health License
  timezone: 'Asia/Amman',
  workingHours: {
    start: '09:00',
    end: '20:00',
    days: [0, 1, 2, 3, 4, 6], // Sunday through Thursday + Saturday (Friday closed)
  },
  sterilizationBufferMinutes: 15, // Mandatory clinical buffer per Law No. 25
};

export const CLINICAL_SERVICES: Record<ServiceType, ServiceDefinition> = {
  consultation: {
    id: 'consultation',
    nameAr: 'كشف واستشارة طبية شاملة',
    nameEn: 'Comprehensive Consultation & Exam',
    durationMinutes: 30,
    sterilizationMinutes: 15,
    basePriceJOD: 15.0,
    taxRatePercent: 0, // Diagnostic/basic health exempted under specific ISTD schedules
  },
  cleaning: {
    id: 'cleaning',
    nameAr: 'تنظيف وتقليح الأسنان وإزالة الجير',
    nameEn: 'Dental Scaling & Prophylaxis',
    durationMinutes: 45,
    sterilizationMinutes: 15,
    basePriceJOD: 25.0,
    taxRatePercent: 0,
  },
  restoration: {
    id: 'restoration',
    nameAr: 'حشوات تجميلية كمبوزيت / علاج نخر',
    nameEn: 'Composite Restoration / Filling',
    durationMinutes: 45,
    sterilizationMinutes: 15,
    basePriceJOD: 35.0,
    taxRatePercent: 0,
  },
  extraction: {
    id: 'extraction',
    nameAr: 'خلع ضرس / جراحة صغرى',
    nameEn: 'Tooth Extraction / Minor Surgery',
    durationMinutes: 45,
    sterilizationMinutes: 15,
    basePriceJOD: 40.0,
    taxRatePercent: 0,
  },
  emergency: {
    id: 'emergency',
    nameAr: 'طوارئ وألم حاد فوري',
    nameEn: 'Urgent Dental Emergency',
    durationMinutes: 30,
    sterilizationMinutes: 15,
    basePriceJOD: 20.0,
    taxRatePercent: 0,
  },
  whitening: {
    id: 'whitening',
    nameAr: 'تبييض الأسنان بالليزر',
    nameEn: 'Laser Teeth Whitening',
    durationMinutes: 60,
    sterilizationMinutes: 15,
    basePriceJOD: 120.0,
    taxRatePercent: 16, // Cosmetic standard rate 16%
  },
  orthodontics_check: {
    id: 'orthodontics_check',
    nameAr: 'تقييم واستشارة تقويم الأسنان',
    nameEn: 'Orthodontic Evaluation',
    durationMinutes: 30,
    sterilizationMinutes: 15,
    basePriceJOD: 20.0,
    taxRatePercent: 0,
  },
};

// Regulatory Guardrails: Law No. 25 of 2018 (Medical Liability)
export const MEDICAL_LIABILITY_GUARDRAILS = {
  forbiddenKeywords: [
    'panadol', 'بنادول', 'باراسيتامول', 'paracetamol',
    'ibuprofen', 'بروفين', 'ايبوبروفين', 'voltarin', 'فولتارين',
    'amoxicillin', 'اموكسيسيلين', 'مضاد حيوي', 'antibiotic',
    'اشرب دواء', 'خذ حبة', 'جرعة', 'مسكن', 'مرهم'
  ],
  emergencyKeywords: [
    'نزيف', 'دم مستمر', 'ورم كبير', 'انتفاخ بالوجه', 'انتفاخ بالفك',
    'مش قادر اتنفس', 'الم لا يحتمل', 'كسر بالفك', 'سقط سني', 'صعوبة بالبلع',
    'حرارة عالية مع ورم', 'hemorrhage', 'bleeding', 'severe swelling'
  ],
  emergencyTriggerCode: '[EMERGENCY_TRIGGER]',
  emergencyResponseAr: `⚠️ تنبيه طبي عاجل: تم تفعيل بروتوكول الطوارئ الفوري وفق قانون المسؤولية الطبية رقم 25 لسنة 2018.
يرجى التوجه فوراً إلى العيادة أو أقرب قسم طوارئ. تم إرسال تنبيه عاجل للطبيب المناوب للمتابعة معك هاتفياً فوراً.`,
};

// Regulatory Disclaimer: Law No. 24 of 2023 (Personal Data Protection)
export const PDPL_CONSENT_MESSAGE = `مرحباً بك في مركز نشمي لطب الأسنان في عمان 🦷
وفقاً لقانون حماية البيانات الشخصية الأردني رقم 24 لسنة 2023، نحرص على خصوصية بياناتك الطبية.
هل توافق على معالجة اسمك ورقم هاتفك لحجز موعدك الطبي وتوثيقه في ملفك الصحي؟
(يرجى الرد بـ "نعم موافق" أو "أوافق" للمتابعة).`;

export function formatJOD(amount: number): string {
  return `${amount.toFixed(3)} د.أ`;
}
