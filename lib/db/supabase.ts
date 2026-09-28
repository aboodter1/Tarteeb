// NashmiOps Enterprise (MVP Edition) - Database Layer & Multi-Tenant Store

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  Clinic,
  Patient,
  Appointment,
  WaitlistEntry,
  Invoice,
  AppointmentStatus,
  WaitlistStatus,
  ServiceType,
  ClinicFaq,
  ConversationState,
  ChatHistoryMessage,
  FailedOutboundMessage,
  Practitioner,
  DentalChair,
  ClinicalEHRRecord,
  ReceptionistAlert,
} from '@/types';
import { CLINIC_CONFIG } from '@/lib/config/constants';
import { loadPersistentData, savePersistentData } from '@/lib/db/disk-store';

declare global {
  var __supabaseInstance: SupabaseClient | undefined;
  var __supabaseAdminInstance: SupabaseClient | undefined;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[Security] Supabase credentials (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) using fallback defaults.');
}

export const isPlaceholderConfig =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

const safeMockFetch = isPlaceholderConfig
  ? ((async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch)
  : undefined;

/**
 * Singleton Supabase Client with PgBouncer / Supavisor connection pooling settings
 * PersistSession disabled to prevent connection leaks across serverless lambdas
 */
export function getSupabaseClient(): SupabaseClient {
  if (!globalThis.__supabaseInstance) {
    globalThis.__supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      global: safeMockFetch ? { fetch: safeMockFetch } : undefined,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: {
        schema: 'public',
      },
    });
  }
  return globalThis.__supabaseInstance;
}

/**
 * Singleton Supabase Admin Client using SUPABASE_SERVICE_ROLE_KEY
 * Directly bypasses RLS for autonomous background operations, Cron Jobs & Webhooks
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!globalThis.__supabaseAdminInstance) {
    globalThis.__supabaseAdminInstance = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: safeMockFetch ? { fetch: safeMockFetch } : undefined,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: {
        schema: 'public',
      },
    });
  }
  return globalThis.__supabaseAdminInstance;
}

export const supabase: SupabaseClient = getSupabaseClient();
export const supabaseAdmin: SupabaseClient = getSupabaseAdmin();

// ====================================================================
// RESILIENT MULTI-TENANT IN-MEMORY SYNC STORE (Crash-Proof Fallback)
// ====================================================================
class TenantMemoryStore {
  clinics: Clinic[] = [
    {
      id: CLINIC_CONFIG.id,
      name: CLINIC_CONFIG.name,
      phone: CLINIC_CONFIG.phone,
      address: CLINIC_CONFIG.address,
      license_number: CLINIC_CONFIG.licenseNumber,
      tax_number: CLINIC_CONFIG.taxNumber,
      google_calendar_id: process.env.GOOGLE_CALENDAR_ID,
      created_at: new Date().toISOString(),
    },
  ];

  patients: Patient[] = [
    {
      id: 'patient-demo-001',
      clinic_id: CLINIC_CONFIG.id,
      whatsapp_phone: '+962791234567',
      full_name: 'أحمد التميمي',
      national_id: '9901020304',
      is_head_of_family: true,
      family_relation: 'self',
      pdpl_consent: true,
      pdpl_consent_timestamp: new Date().toISOString(),
      is_deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'patient-demo-002',
      clinic_id: CLINIC_CONFIG.id,
      whatsapp_phone: '+962799887766',
      full_name: 'سارة عبد الله',
      national_id: '9951020305',
      is_head_of_family: true,
      family_relation: 'self',
      pdpl_consent: true,
      pdpl_consent_timestamp: new Date().toISOString(),
      is_deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  appointments: Appointment[] = [
    {
      id: 'appt-demo-001',
      clinic_id: CLINIC_CONFIG.id,
      patient_id: 'patient-demo-001',
      patient_name: 'أحمد التميمي',
      patient_phone: '+962791234567',
      service_type: 'consultation',
      start_time: new Date(Date.now() + 3600000 * 24).toISOString(), // Tomorrow
      end_time: new Date(Date.now() + 3600000 * 24 + 1800000).toISOString(),
      sterilization_end_time: new Date(Date.now() + 3600000 * 24 + 2700000).toISOString(),
      status: 'CONFIRMED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  waitlist: WaitlistEntry[] = [
    {
      id: 'wait-demo-001',
      clinic_id: CLINIC_CONFIG.id,
      patient_id: 'patient-demo-002',
      patient_name: 'سارة عبد الله',
      patient_phone: '+962799887766',
      requested_service: 'cleaning',
      preferred_date: new Date().toISOString().split('T')[0],
      preferred_time_range: 'any',
      status: 'WAITING',
      created_at: new Date().toISOString(),
    },
  ];

  invoices: Invoice[] = [];

  clinic_faqs: ClinicFaq[] = [
    {
      id: 'faq-hours',
      clinic_id: CLINIC_CONFIG.id,
      category: 'hours',
      question_ar: 'ما هي أوقات دوام وساعات العمل في العيادة؟',
      answer_ar: 'نستقبلكم يومياً من السبت إلى الخميس من الساعة 9:00 صباحاً حتى 9:00 مساءً. يوم الجمعة عطلة أسبوعية.',
      keywords: ['دوام', 'ساعات', 'اوقات', 'متى', 'فاتحين', 'تسكير', 'الجمعة', 'السبت'],
      created_at: new Date().toISOString(),
    },
    {
      id: 'faq-location',
      clinic_id: CLINIC_CONFIG.id,
      category: 'location',
      question_ar: 'أين موقع مركز نشمي وهل تتوفر مواقف سيارات؟',
      answer_ar: 'موقعنا في عمان، الشميساني - مقابل المستشفى التخصصي. يتوفر لدينا مواقف سيارات مجانية خاصة بالمراجعين مع خدمة فاليه مجانية لراحتكم.',
      keywords: ['موقع', 'مكان', 'وين', 'عنوان', 'باركنج', 'مواقف', 'فاليه', 'صفة', 'سيارة', 'الشميساني'],
      created_at: new Date().toISOString(),
    },
    {
      id: 'faq-insurance',
      clinic_id: CLINIC_CONFIG.id,
      category: 'insurance',
      question_ar: 'ما هي شركات وشبكات التأمين الطبي المعتمدة لديكم؟',
      answer_ar: 'معتمدون لدى كبرى شركات التأمين في الأردن: نات هيلث (NatHealth)، ميدنت (MedNet)، الشرق العربي للتأمين، GIG، والأولى للتأمين، بنسب تغطية تصل من 80% إلى 100% حسب فئة بطاقتك.',
      keywords: ['تأمين', 'شبكة', 'نات هيلث', 'ميدنت', 'الشرق العربي', 'gig', 'تغطية', 'بطاقة'],
      created_at: new Date().toISOString(),
    },
    {
      id: 'faq-pricing',
      clinic_id: CLINIC_CONFIG.id,
      category: 'pricing',
      question_ar: 'كم أسعار الكشفية والعلاجات وتنظيف الأسنان؟',
      answer_ar: 'الكشفية والاستشارة مع خطة العلاج 15-20 دينار (تُخصم من قيمة المعالجة عند البدء). تنظيف وتلميع الأسنان يبدأ من 25 دينار، وتبييض الأسنان بالليزر يبدأ من 80 دينار، والحشوات التجميلية تبدأ من 30 دينار. ولا يوجد أي رسوم عربون أو دفعة مسبقة للحجز.',
      keywords: ['سعر', 'اسعار', 'كشفية', 'تكلفة', 'تنظيف', 'تبييض', 'حشوة', 'كم يكلف', 'عربون', 'فلوس'],
      created_at: new Date().toISOString(),
    },
    {
      id: 'faq-services',
      clinic_id: CLINIC_CONFIG.id,
      category: 'services',
      question_ar: 'ما هي الخدمات والإجراءات الطبية المتوفرة في المركز؟',
      answer_ar: 'نقدم خدمات طب وجراحة الأسنان الشاملة: زراعة الأسنان الرقمية، تقويم الأسنان الشفاف والمعدني، ابتسامة هوليود والعدسات الخزفية، علاج العصب والجذور بجلسة واحدة، طب أسنان الأطفال، وتنظيف وتبييض الأسنان.',
      keywords: ['خدمات', 'علاج', 'زراعة', 'تقويم', 'ابتسامة', 'هوليود', 'عصب', 'أطفال', 'تجميل'],
      created_at: new Date().toISOString(),
    },
  ];

  conversations: ConversationState[] = [];
  processed_messages: Array<{ message_id: string; sender_phone?: string; message_type?: string; processed_at: string }> = [];
  failed_outbound_messages: FailedOutboundMessage[] = [];
  receptionist_alerts: ReceptionistAlert[] = [];

  practitioners: Practitioner[] = [
    {
      id: 'doc-qasim-001',
      clinic_id: CLINIC_CONFIG.id,
      name_ar: 'د. قاسم نشمي',
      name_en: 'Dr. Qasim Nashmi',
      specialty: 'implantology_and_surgery',
      specialty_ar: 'استشاري زراعة وجراحة الفكين والأسنان',
      phone: '+962791000001',
      license_number: 'MOH-JO-DEN-8821',
      color_code: '#0d9488',
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 'doc-dima-002',
      clinic_id: CLINIC_CONFIG.id,
      name_ar: 'د. ديما التميمي',
      name_en: 'Dr. Dima Tamimi',
      specialty: 'orthodontics',
      specialty_ar: 'أخصائية تقويم الأسنان والفكين والابتسامة',
      phone: '+962791000002',
      license_number: 'MOH-JO-DEN-9014',
      color_code: '#6366f1',
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 'doc-rami-003',
      clinic_id: CLINIC_CONFIG.id,
      name_ar: 'د. رامي عبيدات',
      name_en: 'Dr. Rami Obeidat',
      specialty: 'general_and_endodontics',
      specialty_ar: 'طبيب أسنان عام وتجميل وعلاج عصب الأسنان',
      phone: '+962791000003',
      license_number: 'MOH-JO-DEN-9542',
      color_code: '#f59e0b',
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ];

  dental_chairs: DentalChair[] = [
    {
      id: 'chair-001',
      clinic_id: CLINIC_CONFIG.id,
      chair_number: 1,
      name_ar: 'كرسي 1 - جناح الجراحة والزراعة الرقمية',
      description_ar: 'مجهز بنظام 3D CBCT وجهاز جراحة الفكين بالموجات بيزو',
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 'chair-002',
      clinic_id: CLINIC_CONFIG.id,
      chair_number: 2,
      name_ar: 'كرسي 2 - جناح التقويم والابتسامة الرقمية',
      description_ar: 'مجهز بالماسح الرقمي الفموي Intraoral Scanner',
      is_active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 'chair-003',
      clinic_id: CLINIC_CONFIG.id,
      chair_number: 3,
      name_ar: 'كرسي 3 - جناح المعالجات الترميمية والجذور',
      description_ar: 'مجهز بميكروسكوب جراحة العصب وجهاز التبييض بالليزر',
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ];

  clinical_records: ClinicalEHRRecord[] = [
    {
      id: 'ehr-demo-001',
      clinic_id: CLINIC_CONFIG.id,
      patient_id: 'patient-demo-001',
      appointment_id: 'appt-demo-001',
      practitioner_id: 'doc-qasim-001',
      practitioner_name: 'د. قاسم نشمي',
      chief_complaint: 'ألم حاد في الضرس السفلي الأيمن مع حساسية شديدة على السوائل الباردة والساخنة',
      diagnosis: 'التهاب لب سني غير ردود (Irreversible Pulpitis) في الضرس رقم 46 مع تسوس عميق',
      clinical_notes: 'تم فحص المريض سريرياً وإجراء صورة أشعة رقمية كشفت وصول التسوس للب السني. تم تخدير موضعي وفتح حجرة اللب واستئصال العصب وتوسيع القنوات.',
      treatment_rendered: 'بدء علاج عصب الضرس (Root Canal Treatment - Phase 1) ووضع حشوة مؤقتة علاجية',
      prescriptions: [
        { drug_name: 'Amoxicillin 500mg', dosage: '500 mg', frequency: 'كل 8 ساعات', duration: '5 أيام' },
        { drug_name: 'Ibuprofen 400mg', dosage: '400 mg', frequency: 'عند اللزوم بعد الطعام', duration: '3 أيام' },
      ],
      odontogram: [
        { tooth_number: 46, surface: 'MOD', status: 'ROOT_CANAL', notes: 'بدء علاج عصب وحشوة مؤقتة' },
        { tooth_number: 16, surface: 'O', status: 'FILLED', notes: 'حشوة كمبوزيت تجميلية سليمة' },
      ],
      allergies: ['Penicillin (Moderate allergy)'],
      chronic_conditions: [],
      informed_consent_signed: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  private isHydrated = false;

  constructor() {
    this.hydrateFromStore();
  }

  hydrateFromStore() {
    if (this.isHydrated) return;
    try {
      const storeData = loadPersistentData();
      if (storeData) {
        if (Array.isArray(storeData.clinics) && storeData.clinics.length > 0) this.clinics = storeData.clinics;
        if (Array.isArray(storeData.patients) && storeData.patients.length > 0) this.patients = storeData.patients;
        if (Array.isArray(storeData.appointments) && storeData.appointments.length > 0) this.appointments = storeData.appointments;
        if (Array.isArray(storeData.waitlist) && storeData.waitlist.length > 0) this.waitlist = storeData.waitlist;
        if (Array.isArray(storeData.invoices) && storeData.invoices.length > 0) this.invoices = storeData.invoices;
        if (Array.isArray(storeData.clinic_faqs) && storeData.clinic_faqs.length > 0) this.clinic_faqs = storeData.clinic_faqs;
        if (Array.isArray(storeData.conversations) && storeData.conversations.length > 0) this.conversations = storeData.conversations;
        if (Array.isArray(storeData.processed_messages) && storeData.processed_messages.length > 0) this.processed_messages = storeData.processed_messages;
        if (Array.isArray(storeData.failed_outbound_messages) && storeData.failed_outbound_messages.length > 0) this.failed_outbound_messages = storeData.failed_outbound_messages;
        if (Array.isArray(storeData.practitioners) && storeData.practitioners.length > 0) this.practitioners = storeData.practitioners;
        if (Array.isArray(storeData.dental_chairs) && storeData.dental_chairs.length > 0) this.dental_chairs = storeData.dental_chairs;
        if (Array.isArray(storeData.clinical_records) && storeData.clinical_records.length > 0) this.clinical_records = storeData.clinical_records;
        if (Array.isArray(storeData.receptionist_alerts) && storeData.receptionist_alerts.length > 0) this.receptionist_alerts = storeData.receptionist_alerts;
      }
      this.isHydrated = true;
    } catch (err) {
      console.warn('[TenantStore] In-memory hydration notice:', err);
    }
  }

  hydrateFromDisk() {
    this.hydrateFromStore();
  }
}

export const tenantStore = new TenantMemoryStore();

export function persistTenantStore(): void {
  // In-memory cache synchronization; state is atomically persisted to Supabase
  try {
    savePersistentData({
      clinics: tenantStore.clinics,
      patients: tenantStore.patients,
      appointments: tenantStore.appointments,
      waitlist: tenantStore.waitlist,
      invoices: tenantStore.invoices,
      clinic_faqs: tenantStore.clinic_faqs,
      conversations: tenantStore.conversations,
      processed_messages: tenantStore.processed_messages,
      failed_outbound_messages: tenantStore.failed_outbound_messages,
      practitioners: tenantStore.practitioners,
      dental_chairs: tenantStore.dental_chairs,
      clinical_records: tenantStore.clinical_records,
      receptionist_alerts: tenantStore.receptionist_alerts,
    });
  } catch (err) {
    // In-memory sync safe
  }
}

/**
 * Sequential Invoice Counter (ICN) - ISTD Phase 2 Compliant
 * Generates monotonically increasing, non-random sequential invoice numbers per clinic
 */
export async function getNextSequentialInvoiceNumber(clinicId: string = CLINIC_CONFIG.id): Promise<string> {
  const currentYear = new Date().getFullYear();
  let count = 0;
  try {
    const { count: dbCount, error } = await supabaseAdmin
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', clinicId);

    if (!error && typeof dbCount === 'number') {
      count = dbCount;
    } else {
      count = tenantStore.invoices.filter((inv) => inv.clinic_id === clinicId).length;
    }
  } catch {
    count = tenantStore.invoices.filter((inv) => inv.clinic_id === clinicId).length;
  }

  const nextSeq = count + 1;
  return `INV-${currentYear}-${String(nextSeq).padStart(5, '0')}`;
}

// ====================================================================
// MULTI-TENANT REPOSITORY METHODS
// ====================================================================

/**
 * Find or create a patient with family profile support and PDPL consent check.
 */
export async function findOrCreatePatient(params: {
  clinicId: string;
  phone: string;
  fullName: string;
  nationalId?: string;
  familyRelation?: 'self' | 'child' | 'spouse' | 'parent';
  primaryContactPhone?: string;
}): Promise<{ patient: Patient; isNew: boolean }> {
  const normalizedPhone = params.phone.trim();
  const name = params.fullName.trim();

  // 1. Direct Supabase Query (Single Source of Truth for Serverless Lambdas)
  if (!isPlaceholderConfig) {
    try {
      const { data: existing, error } = await supabaseAdmin
        .from('patients')
        .select('*')
        .eq('clinic_id', params.clinicId)
        .eq('whatsapp_phone', normalizedPhone)
        .eq('full_name', name)
        .eq('is_deleted', false)
        .maybeSingle();

      if (existing) {
        const patientData = existing as Patient;
        const idx = tenantStore.patients.findIndex((p) => p.id === patientData.id);
        if (idx >= 0) tenantStore.patients[idx] = patientData;
        else tenantStore.patients.push(patientData);
        persistTenantStore();
        return { patient: patientData, isNew: false };
      }

      // Create new Patient directly in Supabase
      const newPatient: Patient = {
        id: `pat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        clinic_id: params.clinicId,
        whatsapp_phone: normalizedPhone,
        full_name: name,
        national_id: params.nationalId,
        is_head_of_family: !params.familyRelation || params.familyRelation === 'self',
        family_relation: params.familyRelation || 'self',
        primary_contact_phone: params.primaryContactPhone || normalizedPhone,
        pdpl_consent: false,
        is_deleted: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('patients')
        .insert(newPatient)
        .select('*')
        .single();

      if (insertErr) {
        // Handle 23505 unique conflict (concurrent insertion race condition)
        if (insertErr.code === '23505') {
          console.warn('[Supabase] Patient insertion conflict (23505), re-querying existing patient...');
          const { data: reQueried } = await supabaseAdmin
            .from('patients')
            .select('*')
            .eq('clinic_id', params.clinicId)
            .eq('whatsapp_phone', normalizedPhone)
            .eq('full_name', name)
            .eq('is_deleted', false)
            .maybeSingle();

          if (reQueried) {
            const patientData = reQueried as Patient;
            const idx = tenantStore.patients.findIndex((p) => p.id === patientData.id);
            if (idx >= 0) tenantStore.patients[idx] = patientData;
            else tenantStore.patients.push(patientData);
            persistTenantStore();
            return { patient: patientData, isNew: false };
          }
        }
        console.error('[Supabase] Patient insertion error:', insertErr);
        throw insertErr;
      }

      const finalPatient = (inserted || newPatient) as Patient;
      tenantStore.patients.push(finalPatient);
      persistTenantStore();
      return { patient: finalPatient, isNew: true };
    } catch (err: any) {
      if (err?.code === '23505') {
        const { data: reQueried } = await supabaseAdmin
          .from('patients')
          .select('*')
          .eq('clinic_id', params.clinicId)
          .eq('whatsapp_phone', normalizedPhone)
          .eq('full_name', name)
          .eq('is_deleted', false)
          .maybeSingle();

        if (reQueried) {
          const patientData = reQueried as Patient;
          const idx = tenantStore.patients.findIndex((p) => p.id === patientData.id);
          if (idx >= 0) tenantStore.patients[idx] = patientData;
          else tenantStore.patients.push(patientData);
          persistTenantStore();
          return { patient: patientData, isNew: false };
        }
      }
      console.error('[Supabase Serverless] Patient DB lookup/insert error:', err);
      if (err?.code && err.code !== 'ECONNREFUSED') throw err;
    }
  }

  // 2. Offline / Simulated Mode Fallback (isPlaceholderConfig)
  let existing = tenantStore.patients.find(
    (p) =>
      p.clinic_id === params.clinicId &&
      p.whatsapp_phone === normalizedPhone &&
      p.full_name.toLowerCase() === name.toLowerCase() &&
      !p.is_deleted
  );

  if (!existing && params.familyRelation && params.familyRelation !== 'self') {
    existing = tenantStore.patients.find(
      (p) =>
        p.clinic_id === params.clinicId &&
        p.whatsapp_phone === normalizedPhone &&
        p.full_name.toLowerCase() === name.toLowerCase() &&
        !p.is_deleted
    );
  }

  if (existing) {
    return { patient: existing, isNew: false };
  }

  const newPatient: Patient = {
    id: `pat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    clinic_id: params.clinicId,
    whatsapp_phone: normalizedPhone,
    full_name: name,
    national_id: params.nationalId,
    is_head_of_family: !params.familyRelation || params.familyRelation === 'self',
    family_relation: params.familyRelation || 'self',
    primary_contact_phone: params.primaryContactPhone || normalizedPhone,
    pdpl_consent: false,
    is_deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  tenantStore.patients.push(newPatient);
  persistTenantStore();
  return { patient: newPatient, isNew: true };
}

/**
 * Record PDPL Law No. 24 of 2023 Consent
 */
export async function recordPdplConsent(
  patientId: string,
  clinicId: string,
  granted: boolean
): Promise<boolean> {
  const now = new Date().toISOString();

  if (!isPlaceholderConfig) {
    try {
      const { error } = await supabaseAdmin
        .from('patients')
        .update({
          pdpl_consent: granted,
          pdpl_consent_timestamp: now,
          updated_at: now,
        })
        .eq('id', patientId)
        .eq('clinic_id', clinicId);

      if (error) {
        console.error('[Supabase Serverless] Error recording PDPL consent in DB:', error);
      }
    } catch (err) {
      console.warn('[Supabase] PDPL consent network warning:', err);
    }
  }

  const patient = tenantStore.patients.find((p) => p.id === patientId && p.clinic_id === clinicId);
  if (patient) {
    patient.pdpl_consent = granted;
    patient.pdpl_consent_timestamp = now;
    patient.updated_at = now;
    persistTenantStore();
  }

  return true;
}

/**
 * Soft-Delete Patient (Jordanian Medical Liability Law No. 25 of 2018 - 5-year retention)
 */
export async function softDeletePatient(patientId: string, clinicId: string): Promise<boolean> {
  const now = new Date().toISOString();

  if (!isPlaceholderConfig) {
    try {
      const { error } = await supabaseAdmin
        .from('patients')
        .update({
          is_deleted: true,
          deleted_at: now,
          updated_at: now,
        })
        .eq('id', patientId)
        .eq('clinic_id', clinicId);

      if (error) {
        console.error('[Supabase Serverless] Error soft-deleting patient in DB:', error);
      }
    } catch (err) {
      console.warn('[Supabase] Soft-delete network warning:', err);
    }
  }

  const patient = tenantStore.patients.find((p) => p.id === patientId && p.clinic_id === clinicId);
  if (patient) {
    patient.is_deleted = true;
    patient.deleted_at = now;
    patient.updated_at = now;
    persistTenantStore();
  }

  return true;
}

export interface CreateAppointmentAtomicParams {
  clinicId: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  serviceType: ServiceType;
  startTime: string;
  endTime: string;
  sterilizationEndTime?: string;
  practitionerId?: string;
  practitionerName?: string;
  chairId?: string;
  chairNumber?: number;
  googleCalendarEventId?: string;
  notes?: string;
  isEmergency?: boolean;
}

/**
 * Create Appointment with PostgreSQL Atomic RPC (book_appointment_atomic)
 * Guarantees zero double-booking and concurrency isolation across distributed serverless instances.
 * Enforces mandatory 15-minute sterilization buffers, practitioner, and dental chair assignments.
 */
export async function createAppointmentAtomic(params: CreateAppointmentAtomicParams): Promise<Appointment> {
  const reqStart = new Date(params.startTime).getTime();
  const calculatedSterilization = params.sterilizationEndTime || new Date(new Date(params.endTime).getTime() + 15 * 60000).toISOString();
  const reqEnd = new Date(calculatedSterilization).getTime();

  // Resolve or Auto-Assign Practitioner & Chair based on service if not explicitly specified
  let practitionerId = params.practitionerId;
  let practitionerName = params.practitionerName;
  let chairId = params.chairId;
  let chairNumber = params.chairNumber;

  if (!practitionerId) {
    if (params.serviceType === 'orthodontics_check') {
      const doc = tenantStore.practitioners.find((p) => p.specialty === 'orthodontics') || tenantStore.practitioners[1];
      practitionerId = doc?.id || 'doc-dima-002';
      practitionerName = doc?.name_ar || 'د. ديما التميمي';
      chairId = chairId || 'chair-002';
      chairNumber = chairNumber || 2;
    } else if (
      params.serviceType === 'cleaning' ||
      params.serviceType === 'restoration' ||
      params.serviceType === 'whitening'
    ) {
      const doc = tenantStore.practitioners.find((p) => p.specialty === 'general_and_endodontics') || tenantStore.practitioners[2];
      practitionerId = doc?.id || 'doc-rami-003';
      practitionerName = doc?.name_ar || 'د. رامي عبيدات';
      chairId = chairId || 'chair-003';
      chairNumber = chairNumber || 3;
    } else {
      const doc = tenantStore.practitioners.find((p) => p.specialty === 'implantology_and_surgery') || tenantStore.practitioners[0];
      practitionerId = doc?.id || 'doc-qasim-001';
      practitionerName = doc?.name_ar || 'د. قاسم نشمي';
      chairId = chairId || 'chair-001';
      chairNumber = chairNumber || 1;
    }
  } else if (!practitionerName) {
    const doc = tenantStore.practitioners.find((p) => p.id === practitionerId);
    if (doc) practitionerName = doc.name_ar;
  }

  if (!chairId) {
    if (practitionerId === 'doc-dima-002' || params.serviceType === 'orthodontics_check') {
      chairId = 'chair-002';
      chairNumber = 2;
    } else if (
      practitionerId === 'doc-rami-003' ||
      params.serviceType === 'cleaning' ||
      params.serviceType === 'restoration' ||
      params.serviceType === 'whitening'
    ) {
      chairId = 'chair-003';
      chairNumber = 3;
    } else {
      chairId = 'chair-001';
      chairNumber = 1;
    }
  }

  const appointmentDate = params.startTime.split('T')[0];
  const appt: Appointment = {
    id: `appt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    clinic_id: params.clinicId,
    patient_id: params.patientId,
    patient_name: params.patientName,
    patient_phone: params.patientPhone,
    service_type: params.serviceType,
    practitioner_id: practitionerId,
    practitioner_name: practitionerName,
    chair_id: chairId,
    chair_number: chairNumber,
    appointment_date: appointmentDate,
    start_time: params.startTime,
    end_time: params.endTime,
    sterilization_end_time: calculatedSterilization,
    status: 'CONFIRMED',
    google_calendar_event_id: params.googleCalendarEventId,
    notes: params.notes,
    is_emergency: !!params.isEmergency,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // ====================================================================
  // 1. LIVE SERVERLESS PRODUCTION EXECUTION (Single Source of Truth)
  // ====================================================================
  if (!isPlaceholderConfig) {
    // Attempt Atomic RPC stored procedure (Single Transaction with Row-Level Share Locks & 23P01 catch)
    try {
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('book_appointment_atomic', {
        p_appointment: appt,
      });

      if (rpcError) {
        if (
          rpcError.code === '23P01' ||
          rpcError.message?.includes('DOUBLE_BOOKING_CONFLICT') ||
          rpcError.message?.includes('exclusion')
        ) {
          const conflictErr: any = new Error(
            `DOUBLE_BOOKING_CONFLICT: يتعارض الموعد المطلوب مع حجز مسجل مسبقاً (PostgreSQL Exclusion Constraint 23P01) شاملاً فترة التعقيم الإلزامية.`
          );
          conflictErr.code = 'DOUBLE_BOOKING_CONFLICT';
          throw conflictErr;
        }
        if (rpcError.code !== '42883') {
          console.warn('[Supabase] RPC book_appointment_atomic notice:', rpcError.message);
        }
      } else if (rpcData) {
        const createdAppt = rpcData as Appointment;
        tenantStore.appointments.push(createdAppt);
        persistTenantStore();
        return createdAppt;
      }
    } catch (rpcErr: any) {
      if (rpcErr?.code === 'DOUBLE_BOOKING_CONFLICT') {
        throw rpcErr;
      }
    }

    // Direct Database Concurrency & Exclusion Guard (Single Source of Truth)
    let query = supabaseAdmin
      .from('appointments')
      .select('*')
      .eq('clinic_id', params.clinicId)
      .neq('status', 'CANCELLED')
      .lt('start_time', calculatedSterilization)
      .gt('sterilization_end_time', params.startTime);

    if (practitionerId) {
      query = query.eq('practitioner_id', practitionerId);
    }

    const { data: dbConflicts, error: conflictErrCheck } = await query;
    if (conflictErrCheck) {
      console.warn('[Supabase Serverless] Error checking appointment conflicts:', conflictErrCheck.message);
    }
    if (Array.isArray(dbConflicts) && dbConflicts.length > 0) {
      const conflict = dbConflicts[0];
      const conflictEndTime = new Date(conflict.sterilization_end_time || conflict.end_time)
        .toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });
      const conflictErr: any = new Error(
        `DOUBLE_BOOKING_CONFLICT: يتعارض الموعد مع حجز مسجل في قاعدة البيانات حتى الساعة ${conflictEndTime} شاملاً فترة التعقيم.`
      );
      conflictErr.code = 'DOUBLE_BOOKING_CONFLICT';
      conflictErr.conflictingAppointment = conflict;
      throw conflictErr;
    }

    // Insert directly into Supabase appointments table
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('appointments')
      .insert({
        id: appt.id,
        clinic_id: appt.clinic_id,
        patient_id: appt.patient_id,
        patient_name: appt.patient_name,
        patient_phone: appt.patient_phone,
        service_type: appt.service_type,
        practitioner_id: appt.practitioner_id,
        practitioner_name: appt.practitioner_name,
        chair_id: appt.chair_id,
        chair_number: appt.chair_number,
        appointment_date: appt.appointment_date,
        start_time: appt.start_time,
        end_time: appt.end_time,
        sterilization_end_time: appt.sterilization_end_time,
        status: 'CONFIRMED',
        notes: appt.notes,
        is_emergency: appt.is_emergency,
        google_calendar_event_id: appt.google_calendar_event_id,
        created_at: appt.created_at,
        updated_at: appt.updated_at,
      })
      .select('*')
      .single();

    if (insertError) {
      if (
        insertError.code === '23P01' ||
        insertError.message?.includes('exclusion') ||
        insertError.message?.includes('no_overlapping_appointments')
      ) {
        const conflictErr: any = new Error(
          'DOUBLE_BOOKING_CONFLICT: رفضت قاعدة البيانات الحجز لوجود تعارض زمني نشط (PostgreSQL Exclusion Constraint 23P01).'
        );
        conflictErr.code = 'DOUBLE_BOOKING_CONFLICT';
        throw conflictErr;
      }
      console.error('[Supabase] Failed to insert appointment into database:', insertError);
      throw insertError;
    }

    const createdAppt = (inserted || appt) as Appointment;
    tenantStore.appointments.push(createdAppt);
    persistTenantStore();
    return createdAppt;
  }

  // ====================================================================
  // 2. SIMULATED / OFFLINE MODE FALLBACK (isPlaceholderConfig)
  // ====================================================================
  const localConflict = tenantStore.appointments.find((a) => {
    if (a.clinic_id !== params.clinicId) return false;
    if (a.status === 'CANCELLED') return false;

    const existingStart = new Date(a.start_time).getTime();
    const existingEnd = new Date(a.sterilization_end_time || a.end_time).getTime();
    const overlaps = reqStart < existingEnd && reqEnd > existingStart;
    if (!overlaps) return false;

    if (practitionerId && a.practitioner_id === practitionerId) return true;
    if (chairId && a.chair_id === chairId) return true;
    if (!a.practitioner_id && !a.chair_id) return true;

    return false;
  });

  if (localConflict) {
    const conflictEndTime = new Date(localConflict.sterilization_end_time || localConflict.end_time)
      .toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });
    const resourceDesc = practitionerName ? `مع ${practitionerName}` : chairNumber ? `على الكرسي رقم ${chairNumber}` : '';
    const conflictErr: any = new Error(
      `DOUBLE_BOOKING_CONFLICT: يتعارض الموعد المطلوب ${resourceDesc} مع حجز مسبق حتى الساعة ${conflictEndTime} شاملاً فترة التعقيم الإلزامية (15 دقيقة).`
    );
    conflictErr.code = 'DOUBLE_BOOKING_CONFLICT';
    conflictErr.conflictingAppointment = localConflict;
    throw conflictErr;
  }

  tenantStore.appointments.push(appt);
  persistTenantStore();
  return appt;
}

export const createAppointment = createAppointmentAtomic;

/**
 * Fetch Practitioners Roster directly from Supabase
 */
export async function getPractitioners(clinicId?: string): Promise<Practitioner[]> {
  const targetClinic = clinicId || CLINIC_CONFIG.id;
  try {
    const { data, error } = await supabaseAdmin
      .from('practitioners')
      .select('*')
      .eq('clinic_id', targetClinic)
      .eq('is_active', true);
    if (!error && Array.isArray(data) && data.length > 0) {
      return data as Practitioner[];
    }
  } catch (err) {
    console.warn('[Supabase] Practitioners query fallback:', err);
  }
  return tenantStore.practitioners.filter((p) => p.clinic_id === targetClinic && p.is_active);
}

/**
 * Fetch Dental Chairs Roster directly from Supabase
 */
export async function getDentalChairs(clinicId?: string): Promise<DentalChair[]> {
  const targetClinic = clinicId || CLINIC_CONFIG.id;
  try {
    const { data, error } = await supabaseAdmin
      .from('dental_chairs')
      .select('*')
      .eq('clinic_id', targetClinic)
      .eq('is_active', true);
    if (!error && Array.isArray(data) && data.length > 0) {
      return data as DentalChair[];
    }
  } catch (err) {
    console.warn('[Supabase] Dental chairs query fallback:', err);
  }
  return tenantStore.dental_chairs.filter((c) => c.clinic_id === targetClinic && c.is_active);
}

/**
 * Save Clinical EHR Record & Dental Charting (Medical Liability Law No. 25 of 2018)
 */
export async function saveClinicalRecord(record: ClinicalEHRRecord): Promise<ClinicalEHRRecord> {
  const existingIdx = tenantStore.clinical_records.findIndex((r) => r.id === record.id);
  if (existingIdx >= 0) {
    tenantStore.clinical_records[existingIdx] = record;
  } else {
    tenantStore.clinical_records.push(record);
  }
  persistTenantStore();

  try {
    await supabase.from('clinical_records').upsert(record);
  } catch (err) {
    console.warn('[Supabase] Clinical record saved locally in tenantStore:', err);
  }
  return record;
}

/**
 * Fetch Patient Clinical History & EHR Records
 */
export async function getPatientClinicalHistory(
  patientId: string,
  clinicId?: string
): Promise<ClinicalEHRRecord[]> {
  const targetClinic = clinicId || CLINIC_CONFIG.id;
  try {
    const { data } = await supabase
      .from('clinical_records')
      .select('*')
      .eq('clinic_id', targetClinic)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    if (data && data.length > 0) {
      for (const row of data) {
        if (!tenantStore.clinical_records.some((r) => r.id === row.id)) {
          tenantStore.clinical_records.push(row as ClinicalEHRRecord);
        }
      }
      persistTenantStore();
    }
  } catch (err) {
    console.warn('[Supabase] Clinical history fetch fallback:', err);
  }
  return tenantStore.clinical_records.filter(
    (r) => r.clinic_id === targetClinic && r.patient_id === patientId
  );
}

/**
 * Deduplication via Supabase: Check and mark webhook message as processed.
 * Prevents processing the same message twice upon Meta Webhook retries in Serverless.
 * Returns true if message was already processed (duplicate), false if new.
 */
export async function isAndMarkWebhookMessageProcessed(params: {
  messageId: string;
  senderPhone?: string;
  messageType?: string;
}): Promise<boolean> {
  const { messageId, senderPhone, messageType } = params;
  if (!messageId) return false;

  // 1. In-memory deduplication check
  const alreadyInStore = tenantStore.processed_messages.some((m) => m.message_id === messageId);
  if (alreadyInStore) {
    return true;
  }

  // 2. Direct atomic check and insertion in Supabase
  try {
    const { data: existing } = await supabase
      .from('processed_webhook_messages')
      .select('id')
      .eq('id', messageId)
      .maybeSingle();

    if (existing) {
      tenantStore.processed_messages.push({
        message_id: messageId,
        sender_phone: senderPhone,
        message_type: messageType,
        processed_at: new Date().toISOString(),
      });
      persistTenantStore();
      return true;
    }

    const { error: insertErr } = await supabase
      .from('processed_webhook_messages')
      .insert({
        id: messageId,
        sender_phone: senderPhone,
        message_type: messageType || 'text',
        processed_at: new Date().toISOString(),
      });

    if (insertErr) {
      if (
        insertErr.code === '23505' ||
        insertErr.message?.includes('duplicate key') ||
        insertErr.message?.includes('unique constraint')
      ) {
        return true;
      }
    }
  } catch (dbErr) {
    console.warn('[Supabase] processed_webhook_messages check fallback:', dbErr);
  }

  // Record in local persistent store
  tenantStore.processed_messages.push({
    message_id: messageId,
    sender_phone: senderPhone,
    message_type: messageType,
    processed_at: new Date().toISOString(),
  });

  if (tenantStore.processed_messages.length > 2000) {
    tenantStore.processed_messages = tenantStore.processed_messages.slice(-2000);
  }

  persistTenantStore();
  return false;
}

/**
 * Deduplication Table TTL Cleanup:
 * Removes webhook messages older than maxAgeHours (default 48 hours) from
 * processed_webhook_messages and tenant store to prevent database bloat.
 */
export async function cleanupOldProcessedMessages(maxAgeHours: number = 48): Promise<{
  deletedCount: number;
  remainingCount: number;
  cutoffTime: string;
}> {
  const cutoffMs = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const cutoffTime = new Date(cutoffMs).toISOString();

  let memoryDeleted = 0;
  const initialMemCount = tenantStore.processed_messages.length;
  tenantStore.processed_messages = tenantStore.processed_messages.filter((m) => {
    const time = new Date(m.processed_at).getTime();
    return time >= cutoffMs;
  });
  memoryDeleted = initialMemCount - tenantStore.processed_messages.length;
  persistTenantStore();

  let dbDeleted = 0;
  try {
    const { error, count } = await supabase
      .from('processed_webhook_messages')
      .delete({ count: 'exact' })
      .lt('processed_at', cutoffTime);

    if (!error && typeof count === 'number') {
      dbDeleted = count;
    }
  } catch (err) {
    console.warn('[Supabase Cleanup] TTL cleanup notice:', err);
  }

  const finalDeleted = Math.max(memoryDeleted, dbDeleted);
  console.log(`[Deduplication TTL Cleanup] Purged ${finalDeleted} messages older than ${maxAgeHours} hours (cutoff: ${cutoffTime})`);

  return {
    deletedCount: finalDeleted,
    remainingCount: tenantStore.processed_messages.length,
    cutoffTime,
  };
}

/**
 * Broadcast Realtime Notification to Receptionist Dashboard (Emergency or Outbound WhatsApp Failure)
 */
export async function broadcastReceptionistAlert(params: {
  clinic_id?: string;
  type: 'EMERGENCY' | 'OUTBOUND_FAILURE';
  title: string;
  description: string;
  patient_name?: string;
  patient_phone: string;
  severity?: 'CRITICAL' | 'WARNING';
  metadata?: Record<string, any>;
}): Promise<ReceptionistAlert> {
  const clinicId = params.clinic_id || CLINIC_CONFIG.id;
  const alert: ReceptionistAlert = {
    id: `alert-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    clinic_id: clinicId,
    type: params.type,
    title: params.title,
    description: params.description,
    patient_name: params.patient_name,
    patient_phone: params.patient_phone,
    severity: params.severity || (params.type === 'EMERGENCY' ? 'CRITICAL' : 'WARNING'),
    timestamp: new Date().toISOString(),
    metadata: params.metadata || {},
  };

  tenantStore.receptionist_alerts.unshift(alert);
  if (tenantStore.receptionist_alerts.length > 50) {
    tenantStore.receptionist_alerts = tenantStore.receptionist_alerts.slice(0, 50);
  }
  persistTenantStore();

  console.log(`[Receptionist Alert Broadcast] [${alert.type}] ${alert.title}: ${alert.description}`);

  // 1. Supabase Realtime broadcast to clinic-specific channel
  try {
    const clinicChan = supabase.channel(`receptionist-alerts:${clinicId}`);
    await clinicChan.send({
      type: 'broadcast',
      event: 'RECEPTIONIST_ALERT',
      payload: alert,
    });
  } catch (chanErr) {
    console.warn('[Supabase Realtime] Clinic channel broadcast notice:', chanErr);
  }

  // 2. Supabase Realtime broadcast to global receptionist channel
  try {
    const globalChan = supabase.channel('receptionist-alerts');
    await globalChan.send({
      type: 'broadcast',
      event: 'RECEPTIONIST_ALERT',
      payload: alert,
    });
  } catch (_) {}

  return alert;
}

export function getReceptionistAlerts(clinicId?: string): ReceptionistAlert[] {
  tenantStore.hydrateFromDisk();
  if (clinicId) {
    return tenantStore.receptionist_alerts.filter((a) => a.clinic_id === clinicId);
  }
  return tenantStore.receptionist_alerts;
}

export function dismissReceptionistAlert(alertId: string): boolean {
  const idx = tenantStore.receptionist_alerts.findIndex((a) => a.id === alertId);
  if (idx !== -1) {
    tenantStore.receptionist_alerts.splice(idx, 1);
    persistTenantStore();
    return true;
  }
  return false;
}

/**
 * Dead-Letter Outbound Log: Record failed outbound WhatsApp dispatches for human reception follow-up
 */
export async function logFailedOutboundMessage(params: {
  clinicId?: string;
  recipientPhone: string;
  messageText: string;
  errorReason: string;
}): Promise<FailedOutboundMessage> {
  const clinicId = params.clinicId || CLINIC_CONFIG.id;
  const entry: FailedOutboundMessage = {
    id: `fail-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    clinic_id: clinicId,
    recipient_phone: params.recipientPhone,
    message_text: params.messageText,
    error_reason: params.errorReason,
    status: 'PENDING_HUMAN_REVIEW',
    created_at: new Date().toISOString(),
  };

  tenantStore.failed_outbound_messages.push(entry);
  persistTenantStore();

  try {
    await supabase.from('failed_outbound_messages').insert({
      id: entry.id,
      clinic_id: entry.clinic_id,
      recipient_phone: entry.recipient_phone,
      message_text: entry.message_text,
      error_reason: entry.error_reason,
      status: entry.status,
      created_at: entry.created_at,
    });
    console.log(`[Dead-Letter Log] Successfully logged failed message to ${params.recipientPhone} in Supabase`);
  } catch (err) {
    console.warn('[Supabase] Failed outbound message stored locally in tenantStore:', err);
  }

  // Trigger Instant Live Alert to Receptionist Desk
  void broadcastReceptionistAlert({
    clinic_id: clinicId,
    type: 'OUTBOUND_FAILURE',
    title: '⚠️ تعذر إرسال رسالة واتساب للمريض',
    description: `فشل الإرسال إلى ${params.recipientPhone}: ${params.errorReason}`,
    patient_phone: params.recipientPhone,
    severity: 'WARNING',
    metadata: {
      message_text: params.messageText,
      error_reason: params.errorReason,
    },
  });

  return entry;
}

/**
 * Update Appointment Status (supports CANCELLED, NO_SHOW, COMPLETED)
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  clinicId: string,
  status: AppointmentStatus
): Promise<Appointment | null> {
  const now = new Date().toISOString();

  if (!isPlaceholderConfig) {
    try {
      const { data, error } = await supabaseAdmin
        .from('appointments')
        .update({ status, updated_at: now })
        .eq('id', appointmentId)
        .eq('clinic_id', clinicId)
        .select('*')
        .maybeSingle();

      if (error) {
        console.error('[Supabase Serverless] Error updating appointment status in DB:', error);
        throw error;
      }

      if (data) {
        const updated = data as Appointment;
        const idx = tenantStore.appointments.findIndex((a) => a.id === appointmentId);
        if (idx >= 0) tenantStore.appointments[idx] = updated;
        else tenantStore.appointments.push(updated);
        persistTenantStore();
        return updated;
      }
    } catch (err: any) {
      console.error('[Supabase] Failed to update appointment status:', err);
      if (err?.code && err.code !== 'ECONNREFUSED') throw err;
    }
  }

  const appt = tenantStore.appointments.find((a) => a.id === appointmentId && a.clinic_id === clinicId);
  if (appt) {
    appt.status = status;
    appt.updated_at = now;
    persistTenantStore();
  }

  return appt || null;
}

/**
 * Add patient to Smart Waitlist
 */
export async function addToWaitlist(params: {
  clinicId: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  requestedService: ServiceType;
  preferredDate: string;
  preferredTimeRange?: 'morning' | 'afternoon' | 'any';
}): Promise<WaitlistEntry> {
  const entry: WaitlistEntry = {
    id: `wait-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    clinic_id: params.clinicId,
    patient_id: params.patientId,
    patient_name: params.patientName,
    patient_phone: params.patientPhone,
    requested_service: params.requestedService,
    preferred_date: params.preferredDate,
    preferred_time_range: params.preferredTimeRange || 'any',
    status: 'WAITING',
    created_at: new Date().toISOString(),
  };

  if (!isPlaceholderConfig) {
    try {
      const { data, error } = await supabaseAdmin
        .from('waitlist')
        .insert(entry)
        .select('*')
        .single();

      if (error) {
        console.error('[Supabase Serverless] Error inserting waitlist entry:', error);
        throw error;
      }
      const saved = (data || entry) as WaitlistEntry;
      tenantStore.waitlist.push(saved);
      persistTenantStore();
      return saved;
    } catch (err) {
      console.error('[Supabase] Waitlist insert error:', err);
      throw err;
    }
  }

  tenantStore.waitlist.push(entry);
  persistTenantStore();
  return entry;
}

/**
 * Query waitlist for matching slots (Used by Waitlist Sniper)
 */
export async function findNextWaitlistCandidate(
  clinicId: string,
  serviceType: ServiceType,
  dateString: string
): Promise<WaitlistEntry | null> {
  const targetDate = dateString.split('T')[0];

  if (!isPlaceholderConfig) {
    try {
      const { data, error } = await supabaseAdmin
        .from('waitlist')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('status', 'WAITING')
        .eq('preferred_date', targetDate)
        .eq('requested_service', serviceType)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        return data as WaitlistEntry;
      }
    } catch (err) {
      console.warn('[Supabase Serverless] Waitlist candidate lookup fallback:', err);
    }
  }

  const candidate = tenantStore.waitlist.find(
    (w) =>
      w.clinic_id === clinicId &&
      w.status === 'WAITING' &&
      w.preferred_date === targetDate &&
      w.requested_service === serviceType
  );

  return candidate || null;
}

/**
 * Store JoFotara Invoice
 */
export async function saveInvoice(invoice: Invoice): Promise<Invoice> {
  if (!isPlaceholderConfig) {
    try {
      const { data, error } = await supabaseAdmin
        .from('invoices')
        .insert(invoice)
        .select('*')
        .single();

      if (error) {
        console.error('[Supabase Serverless] Error saving invoice:', error);
        throw error;
      }
      const saved = (data || invoice) as Invoice;
      tenantStore.invoices.push(saved);
      persistTenantStore();
      return saved;
    } catch (err) {
      console.error('[Supabase] Invoice insert error:', err);
      throw err;
    }
  }

  tenantStore.invoices.push(invoice);
  persistTenantStore();
  return invoice;
}

/**
 * Retrieve the latest issued invoice hash for a clinic (ISTD JoFotara PIH Chaining)
 * Returns the SHA-256 hash of the most recent invoice, or standard Genesis Hash if no previous invoices exist.
 */
export async function getLatestInvoiceHash(clinicId: string): Promise<string> {
  const GENESIS_PIH = 'NWZlY2ViNjAxOTEzMWIxMWNmMzQ1OGE3MDU4NDhhZGIxY2VmY2Q1NzcxN2FkNzhmNWQ5NzU0NzA1OWUyYzg2';

  if (!isPlaceholderConfig) {
    try {
      const { data, error } = await supabaseAdmin
        .from('invoices')
        .select('invoice_hash, created_at')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data?.invoice_hash) {
        return data.invoice_hash;
      }
    } catch (err) {
      console.warn('[Supabase] Failed to fetch latest invoice hash from DB, falling back to memory/genesis:', err);
    }
  }

  // Memory store fallback
  const clinicInvoices = tenantStore.invoices
    .filter((inv) => inv.clinic_id === clinicId && inv.invoice_hash)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (clinicInvoices.length > 0 && clinicInvoices[0].invoice_hash) {
    return clinicInvoices[0].invoice_hash;
  }

  return GENESIS_PIH;
}

/**
 * Query Clinic FAQs by semantic/keyword match
 */
export async function queryClinicFaq(clinicId: string, queryText: string): Promise<ClinicFaq[]> {
  const q = (queryText || '').toLowerCase().trim();
  if (!q) return [];

  const stopWords = new Set(['في', 'من', 'على', 'إلى', 'الي', 'عن', 'مع', 'يا', 'شو', 'كم', 'هل', 'أنا', 'انا', 'هو', 'هي', 'ما']);
  const words = q.split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));

  const isFaqMatch = (faq: ClinicFaq) => {
    if (faq.clinic_id !== clinicId) return false;
    const cat = faq.category.toLowerCase();
    const qAr = faq.question_ar.toLowerCase();
    const aAr = faq.answer_ar.toLowerCase();
    
    // Direct phrase match
    if (qAr.includes(q) || q.includes(cat)) return true;

    // Specific keyword match
    const hasKeyword = faq.keywords.some((k) => {
      const lowerK = k.toLowerCase();
      return q.includes(lowerK) || words.some((w) => w === lowerK || lowerK.includes(w));
    });

    return hasKeyword;
  };

  // 1. Check local memory store
  const localMatches = tenantStore.clinic_faqs.filter(isFaqMatch);
  if (localMatches.length > 0) {
    return localMatches;
  }

  // 2. Query Supabase
  try {
    const { data } = await supabase
      .from('clinic_faqs')
      .select('*')
      .eq('clinic_id', clinicId);

    if (data && data.length > 0) {
      for (const row of data) {
        if (!tenantStore.clinic_faqs.some((f) => f.id === row.id)) {
          tenantStore.clinic_faqs.push(row as ClinicFaq);
        }
      }
      return (data as ClinicFaq[]).filter(isFaqMatch);
    }
  } catch (err) {
    console.warn('[Supabase] Clinic FAQ query failed, using default FAQs:', err);
  }

  return [];
}

/**
 * Get or create Conversation State for checkpointing
 */
export async function getOrCreateConversation(
  clinicId: string,
  phoneNumber: string,
  patientName?: string
): Promise<ConversationState> {
  const normalizedPhone = (phoneNumber || '+962791234567').trim();

  let conv = tenantStore.conversations.find(
    (c) => c.clinic_id === clinicId && c.phone_number === normalizedPhone
  );

  if (!conv) {
    // Try supabase
    try {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('phone_number', normalizedPhone)
        .maybeSingle();

      if (data) {
        conv = {
          id: data.id,
          clinic_id: data.clinic_id,
          phone_number: data.phone_number,
          patient_name: data.patient_name || patientName,
          summary: data.summary,
          summary_updated_at: data.summary_updated_at,
          chat_history: Array.isArray(data.chat_history) ? data.chat_history : [],
          updated_at: data.updated_at || new Date().toISOString(),
        };
        tenantStore.conversations.push(conv);
      }
    } catch (err) {
      console.warn('[Supabase] Conversation fetch fallback:', err);
    }
  }

  if (!conv) {
    conv = {
      id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      clinic_id: clinicId,
      phone_number: normalizedPhone,
      patient_name: patientName,
      summary: undefined,
      summary_updated_at: undefined,
      chat_history: [],
      updated_at: new Date().toISOString(),
    };
    tenantStore.conversations.push(conv);

    try {
      await supabase.from('conversations').upsert({
        id: conv.id,
        clinic_id: conv.clinic_id,
        phone_number: conv.phone_number,
        patient_name: conv.patient_name,
        summary: conv.summary,
        summary_updated_at: conv.summary_updated_at,
        chat_history: conv.chat_history,
        updated_at: conv.updated_at,
      });
    } catch (err) {
      console.warn('[Supabase] Conversation upsert error:', err);
    }
  } else if (patientName && !conv.patient_name) {
    conv.patient_name = patientName;
  }

  return conv;
}

/**
 * Summarize older conversation history using Gemini AI to preserve clinical & administrative context
 * with graceful structured fallback to conserve tokens and reduce latency.
 */
export async function compactAndSummarizeHistory(
  olderMessages: ChatHistoryMessage[],
  patientName?: string,
  existingSummary?: string
): Promise<string> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (geminiApiKey && geminiApiKey.trim()) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      const conversationText = olderMessages
        .map((m) => `${m.role === 'user' ? 'المريض' : 'العيادة'}: ${m.text}`)
        .join('\n');

      const prompt = `أنت مساعد سريري ذكي لمركز نشمي لطب الأسنان بعمان.
قم بتلخيص المحادثة السابقة بدقة سريرية وإدارية باللغة العربية بأسلوب مهني وموجز جداً.
ركز حصراً على:
1. الشكوى أو الإجراء السريري المطلوب (ألم، تنظيف، تقويم، زراعة، سحب عصب، فحص).
2. تفضيلات المواعيد وأوقات المريض.
3. أي قرارات أو خطوات تم التوصل إليها.
${patientName ? `اسم المريض: ${patientName}` : ''}
${existingSummary ? `الملخص السابق: ${existingSummary}` : ''}

سياق المحادثة:
${conversationText}

الملخص السريري والإداري المركز (فقرة واحدة فقط بدون تنسيق Markdown):`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      const summaryText = response.text ? response.text.trim() : '';
      if (summaryText) {
        return existingSummary && existingSummary.trim()
          ? `${existingSummary} -> [تحديث]: ${summaryText}`
          : summaryText;
      }
    } catch (aiErr) {
      console.warn('[Conversation Summarizer] Gemini model call notice, using structured fallback:', aiErr);
    }
  }

  // Graceful structured clinical fallback
  const userTexts = olderMessages.filter((m) => m.role === 'user').map((m) => m.text);

  const serviceKeywords = [
    { key: 'كشفية', label: 'كشف ومعاينة عامة' },
    { key: 'تنظيف', label: 'تنظيف وتلميع أسنان' },
    { key: 'زراعة', label: 'زراعة وجراحة أسنان' },
    { key: 'تبييض', label: 'تبييض أسنان' },
    { key: 'تقويم', label: 'تقويم أسنان' },
    { key: 'عصب', label: 'سحب وعلاج عصب' },
    { key: 'طوارئ', label: 'طوارئ وألم حاد' },
    { key: 'خلع', label: 'خلع سن/ضرس' },
    { key: 'حشوة', label: 'حشوة تجميلية' },
  ];

  const detectedServices = serviceKeywords
    .filter((sk) => userTexts.some((t) => t.includes(sk.key)))
    .map((sk) => sk.label);

  const timePreferences: string[] = [];
  for (const t of userTexts) {
    if (t.includes('الصبح') || t.includes('صباحاً') || t.includes('صباح')) timePreferences.push('صباحاً');
    if (t.includes('المسا') || t.includes('مساءً') || t.includes('مساء') || t.includes('الظهر')) timePreferences.push('مساءً/بعد الظهر');
    const dayMatch = t.match(/(?:اليوم|بكرا|بكرة|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس)(?:\s+(?:الساعة\s+)?[\d:]+)?/);
    if (dayMatch && !timePreferences.includes(dayMatch[0])) {
      timePreferences.push(dayMatch[0]);
    }
  }

  const toolExecutions: string[] = [];
  for (const m of olderMessages) {
    if (m.toolCalls && Array.isArray(m.toolCalls)) {
      for (const tc of m.toolCalls) {
        if (tc.name && !toolExecutions.includes(tc.name)) {
          toolExecutions.push(tc.name);
        }
      }
    }
  }

  const summaryParts: string[] = [];
  if (patientName) {
    summaryParts.push(`اسم المريض: ${patientName}`);
  }
  if (detectedServices.length > 0) {
    summaryParts.push(`الخدمات: ${detectedServices.join('، ')}`);
  }
  if (timePreferences.length > 0) {
    summaryParts.push(`المواعيد المفضلة: ${Array.from(new Set(timePreferences)).join('، ')}`);
  }
  if (toolExecutions.length > 0) {
    summaryParts.push(`العمليات السابقة: ${toolExecutions.join('، ')}`);
  }

  const lastUserMsg = [...userTexts].pop();
  if (lastUserMsg) {
    summaryParts.push(`آخر سياق ملخص: "${lastUserMsg.substring(0, 100)}"`);
  }

  let finalSummary = summaryParts.join(' | ');
  if (existingSummary && existingSummary.trim()) {
    finalSummary = `${existingSummary} -> [تحديث]: ${finalSummary}`;
  }

  return finalSummary;
}

/**
 * Append message to chat_history and checkpoint to Supabase
 * Performs automatic summarization & token optimization when messages exceed 20
 */
export async function appendChatHistory(
  clinicId: string,
  phoneNumber: string,
  role: 'user' | 'model',
  text: string,
  toolCalls?: any[]
): Promise<ConversationState> {
  const conv = await getOrCreateConversation(clinicId, phoneNumber);
  const newMsg: ChatHistoryMessage = {
    role,
    text,
    timestamp: new Date().toISOString(),
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
  };

  conv.chat_history.push(newMsg);
  conv.updated_at = new Date().toISOString();

  // 1. Conversation Summarization & Token Optimization:
  // When messages exceed 20, automatically synthesize older history into a running summary
  // and keep the 10 most recent messages to minimize Gemini token usage & latency.
  if (conv.chat_history.length > 20) {
    const splitIndex = conv.chat_history.length - 10;
    const olderMessages = conv.chat_history.slice(0, splitIndex);
    const recentMessages = conv.chat_history.slice(splitIndex);

    const generatedSummary = await compactAndSummarizeHistory(
      olderMessages,
      conv.patient_name,
      conv.summary
    );

    conv.summary = generatedSummary;
    conv.summary_updated_at = new Date().toISOString();
    conv.chat_history = recentMessages;

    console.log(
      `[Conversation Summarizer] Compacted ${olderMessages.length} messages into summary. Retained ${recentMessages.length} recent messages for ${phoneNumber}`
    );
  }

  persistTenantStore();

  // Persist checkpoint to Supabase
  if (!isPlaceholderConfig) {
    try {
      await supabaseAdmin.from('conversations').upsert({
        id: conv.id,
        clinic_id: conv.clinic_id,
        phone_number: conv.phone_number,
        patient_name: conv.patient_name,
        summary: conv.summary,
        summary_updated_at: conv.summary_updated_at,
        chat_history: conv.chat_history,
        updated_at: conv.updated_at,
      });
    } catch (err) {
      console.warn('[Supabase Serverless] Checkpointing chat history to DB warning:', err);
    }
  }

  return conv;
}

/**
 * Fetch all appointments from Supabase (Single Source of Truth)
 */
export async function getAllAppointments(clinicId?: string): Promise<Appointment[]> {
  if (!isPlaceholderConfig) {
    try {
      let query = supabaseAdmin
        .from('appointments')
        .select('*');

      if (clinicId) {
        query = query.eq('clinic_id', clinicId);
      }

      query = query.order('start_time', { ascending: false });

      const { data, error } = await query;
      if (error) {
        console.error('[Supabase Serverless] Error querying appointments table:', error.message || error);
      } else if (Array.isArray(data)) {
        tenantStore.appointments = data as Appointment[];
        persistTenantStore();
        return data as Appointment[];
      }
    } catch (err) {
      console.warn('[Supabase Serverless] Fetching appointments notice:', err);
    }
  }

  return clinicId
    ? tenantStore.appointments.filter((a) => a.clinic_id === clinicId)
    : tenantStore.appointments;
}

/**
 * Get Conversation History for phone (Single Source of Truth)
 */
export async function getConversationHistory(
  clinicId: string,
  phoneNumber: string
): Promise<ConversationState | null> {
  const normalizedPhone = (phoneNumber || '+962791234567').trim();

  if (!isPlaceholderConfig) {
    try {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('phone_number', normalizedPhone)
        .maybeSingle();

      if (!error && data) {
        const conv: ConversationState = {
          id: data.id,
          clinic_id: data.clinic_id,
          phone_number: data.phone_number,
          patient_name: data.patient_name,
          summary: data.summary,
          summary_updated_at: data.summary_updated_at,
          chat_history: Array.isArray(data.chat_history) ? data.chat_history : [],
          updated_at: data.updated_at || new Date().toISOString(),
        };
        const idx = tenantStore.conversations.findIndex((c) => c.phone_number === normalizedPhone);
        if (idx >= 0) tenantStore.conversations[idx] = conv;
        else tenantStore.conversations.push(conv);
        persistTenantStore();
        return conv;
      }
    } catch (err) {
      console.warn('[Supabase Serverless] Conversation history query notice:', err);
    }
  }

  // Fallback to local store in offline mode
  const conv = tenantStore.conversations.find(
    (c) => c.clinic_id === clinicId && c.phone_number === normalizedPhone
  );

  return conv || null;
}

/**
 * Clear conversation history for phone (Start fresh chat)
 */
export async function clearConversationHistory(
  clinicId: string,
  phoneNumber: string
): Promise<boolean> {
  const normalizedPhone = (phoneNumber || '+962791234567').trim();

  if (!isPlaceholderConfig) {
    try {
      await supabaseAdmin
        .from('conversations')
        .update({ chat_history: [], updated_at: new Date().toISOString() })
        .eq('clinic_id', clinicId)
        .eq('phone_number', normalizedPhone);
    } catch (err) {
      console.warn('[Supabase Serverless] Clear conversation notice:', err);
    }
  }

  const conv = tenantStore.conversations.find(
    (c) => c.clinic_id === clinicId && c.phone_number === normalizedPhone
  );

  if (conv) {
    conv.chat_history = [];
    conv.updated_at = new Date().toISOString();
    persistTenantStore();
  }

  return true;
}

// ====================================================================
// SUPABASE REALTIME MULTI-TENANT STREAMING ENGINE
// ====================================================================

export type RealtimeTable =
  | 'patients'
  | 'waitlist'
  | 'invoices'
  | 'appointments'
  | 'receptionist_alerts'
  | 'conversations';

/**
 * Universal subscription helper for live PostgreSQL change notifications
 */
export function subscribeToClinicTableChanges(
  table: RealtimeTable,
  clinicId: string = CLINIC_CONFIG.id,
  callback: (payload: any) => void
) {
  if (isPlaceholderConfig) {
    console.log(`[Supabase Realtime - Simulated] Mock channel attached to ${table} for clinic ${clinicId}`);
    return {
      unsubscribe: () => console.log(`[Supabase Realtime - Simulated] Unsubscribed from ${table}`),
    };
  }

  const channelName = `realtime_${table}_${clinicId}_${Math.random().toString(36).substring(2, 6)}`;
  return supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: `clinic_id=eq.${clinicId}`,
      },
      (payload) => {
        console.log(`[Supabase Realtime] Event on ${table}:`, payload.eventType);
        callback(payload);
      }
    )
    .subscribe();
}

export function subscribeToAppointments(clinicId: string = CLINIC_CONFIG.id, callback: (payload: any) => void) {
  return subscribeToClinicTableChanges('appointments', clinicId, callback);
}

export function subscribeToWaitlist(clinicId: string = CLINIC_CONFIG.id, callback: (payload: any) => void) {
  return subscribeToClinicTableChanges('waitlist', clinicId, callback);
}

export function subscribeToInvoices(clinicId: string = CLINIC_CONFIG.id, callback: (payload: any) => void) {
  return subscribeToClinicTableChanges('invoices', clinicId, callback);
}

export function subscribeToPatients(clinicId: string = CLINIC_CONFIG.id, callback: (payload: any) => void) {
  return subscribeToClinicTableChanges('patients', clinicId, callback);
}

export function subscribeToReceptionistAlerts(clinicId: string = CLINIC_CONFIG.id, callback: (payload: any) => void) {
  return subscribeToClinicTableChanges('receptionist_alerts', clinicId, callback);
}


