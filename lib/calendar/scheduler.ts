// NashmiOps Enterprise (MVP Edition) - Dynamic Calendar Scheduler & Family Profiles

import { google } from 'googleapis';
import { Appointment, ServiceType } from '@/types';
import { CLINIC_CONFIG, CLINICAL_SERVICES } from '@/lib/config/constants';
import {
  tenantStore,
  createAppointment,
  findOrCreatePatient,
  recordPdplConsent,
  getDentalChairs,
  isPlaceholderConfig,
  supabase,
  supabaseAdmin,
} from '@/lib/db/supabase';

import { parseAmmanDateTime, toZonedTime, AMMAN_TIMEZONE, getAmmanNow } from '@/lib/utils/timezone';

let googleCalendarClient: any = null;

function getCalendarClient() {
  if (googleCalendarClient) return googleCalendarClient;

  try {
    const credsRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!credsRaw) {
      console.warn('[Calendar] GOOGLE_APPLICATION_CREDENTIALS_JSON missing, operating in simulated mode.');
      return null;
    }

    const creds = JSON.parse(credsRaw);
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    googleCalendarClient = google.calendar({ version: 'v3', auth });
    return googleCalendarClient;
  } catch (err) {
    console.warn('[Calendar] Failed to initialize Google Calendar client:', err);
    return null;
  }
}

export interface BookAppointmentInput {
  clinicId?: string;
  phone: string;
  patientName: string;
  serviceType: ServiceType;
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:mm (e.g. 11:00, 16:30)
  practitionerId?: string;
  practitionerName?: string;
  chairId?: string;
  chairNumber?: number;
  familyRelation?: 'self' | 'child' | 'spouse' | 'parent';
  nationalId?: string;
  notes?: string;
  isEmergency?: boolean;
}

export interface SchedulingResult {
  success: boolean;
  appointment?: Appointment;
  googleCalendarEventId?: string;
  message: string;
  conflictDetails?: string;
}

/**
 * Validate appointment against clinic working hours, Friday closure, and same-day past-time check using Asia/Amman timezone
 */
export function validateClinicWorkingHours(
  startTime: Date,
  endTimeWithBuffer: Date
): { valid: boolean; reason?: string } {
  // Same-Day Past-Time Booking Guard
  const nowAmman = getAmmanNow();
  if (startTime.getTime() <= nowAmman.getTime()) {
    return {
      valid: false,
      reason: 'عذراً، هذا الوقت قد مضى اليوم بالفعل. يسعدنا حجز أقرب وقت متاح لك لاحقاً اليوم أو غداً. هل يناسبك موعد لاحق؟ 🦷',
    };
  }

  const day = startTime.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday

  // Friday is weekly holiday
  if (day === 5 || !CLINIC_CONFIG.workingHours.days.includes(day)) {
    return {
      valid: false,
      reason: 'يوم الجمعة عطلة أسبوعية رسمية في مركز نشمي لطب وجراحة الأسنان. دوامنا من السبت إلى الخميس. نقترح عليك حجز الموعد يوم السبت أو الأحد القادم من الساعة 09:00 صباحاً حتى 08:00 مساءً. هل يناسبك يوم السبت أو الأحد؟ 🦷',
    };
  }

  const [startH, startM] = CLINIC_CONFIG.workingHours.start.split(':').map(Number);
  const [endH, endM] = CLINIC_CONFIG.workingHours.end.split(':').map(Number);

  const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
  const endMinutes = endTimeWithBuffer.getHours() * 60 + endTimeWithBuffer.getMinutes();

  const openMinutes = startH * 60 + startM;  // 09:00 -> 540
  const closeMinutes = endH * 60 + endM;    // 20:00 -> 1200

  if (startMinutes < openMinutes) {
    return {
      valid: false,
      reason: `الوقت المطلوب قبل بدء ساعات العمل الرسمية (نفتح من الساعة ${CLINIC_CONFIG.workingHours.start} صباحاً إلى ${CLINIC_CONFIG.workingHours.end} مساءً). بإمكانك الحجز في أقرب موعد متاح الساعة 09:30 أو 10:00 صباحاً. هل يناسبك ذلك؟ 🦷`,
    };
  }

  if (endMinutes > closeMinutes || startMinutes >= closeMinutes) {
    return {
      valid: false,
      reason: `الوقت المطلوب وفترة التعقيم يتجاوزان وقت إغلاق العيادة (نستقبل المرضى حتى الساعة ${CLINIC_CONFIG.workingHours.end} مساءً). نقترح عليك موعداً في نفس اليوم الساعة 18:30 أو 19:00 مساءً أو في صباح اليوم التالي. هل يناسبك ذلك؟ 🦷`,
    };
  }

  return { valid: true };
}

/**
 * Check slot availability including mandatory 15-minute sterilization buffer, working hours,
 * same-day past-time guard, and practitioner/chair roster allocation.
 */
export async function checkSlotAvailability(
  clinicId: string,
  startTime: Date,
  endTimeWithBuffer: Date,
  options?: {
    practitionerId?: string;
    practitionerName?: string;
    chairId?: string;
    chairNumber?: number;
    serviceType?: ServiceType;
  }
): Promise<{
  available: boolean;
  conflictReason?: string;
  assignedPractitioner?: string;
  assignedChair?: number;
}> {
  // 1. Same-Day Past-Time Guard
  const nowAmman = getAmmanNow();
  if (startTime.getTime() <= nowAmman.getTime()) {
    return {
      available: false,
      conflictReason: 'عذراً، هذا الوقت قد مضى اليوم بالفعل. يسعدنا حجز أقرب وقت متاح لك لاحقاً اليوم أو غداً. هل يناسبك موعد لاحق؟ 🦷',
    };
  }

  // 2. Working Hours & Friday Closure Guard
  const hoursCheck = validateClinicWorkingHours(startTime, endTimeWithBuffer);
  if (!hoursCheck.valid) {
    return {
      available: false,
      conflictReason: hoursCheck.reason,
    };
  }

  const reqStart = startTime.getTime();
  const reqEnd = endTimeWithBuffer.getTime();

  // Query Supabase directly (Single Source of Truth)
  let activeAppointments: Appointment[] = [];
  if (!isPlaceholderConfig) {
    try {
      const { data, error } = await supabaseAdmin
        .from('appointments')
        .select('*')
        .eq('clinic_id', clinicId)
        .neq('status', 'CANCELLED');

      if (!error && Array.isArray(data)) {
        activeAppointments = data as Appointment[];
      } else {
        if (error) {
          console.warn('[Calendar Scheduler] Supabase query error for appointments:', error.message || error);
        }
        activeAppointments = tenantStore.appointments.filter(
          (appt) => appt.clinic_id === clinicId && appt.status !== 'CANCELLED'
        );
      }
    } catch (err) {
      console.warn('[Calendar Scheduler] Exception querying appointments from Supabase:', err);
      activeAppointments = tenantStore.appointments.filter(
        (appt) => appt.clinic_id === clinicId && appt.status !== 'CANCELLED'
      );
    }
  } else {
    activeAppointments = tenantStore.appointments.filter(
      (appt) => appt.clinic_id === clinicId && appt.status !== 'CANCELLED'
    );
  }

  const overlappingAppts = activeAppointments.filter((appt) => {
    if (appt.clinic_id !== clinicId) return false;
    if (appt.status === 'CANCELLED') return false;

    const existingStart = new Date(appt.start_time).getTime();
    const existingEnd = new Date(appt.sterilization_end_time || appt.end_time).getTime();
    return reqStart < existingEnd && reqEnd > existingStart;
  });

  // Check specific practitioner conflict if specified
  if (options?.practitionerId) {
    const docConflict = overlappingAppts.find((a) => a.practitioner_id === options.practitionerId);
    if (docConflict) {
      const conflictDate = new Date(docConflict.sterilization_end_time || docConflict.end_time);
      const docName = options.practitionerName || docConflict.practitioner_name || 'الطبيب المطلوب';
      return {
        available: false,
        conflictReason: `الموعد المطلوب مع (${docName}) يتعارض مع موعد محجوز مسبقاً حتى الساعة ${conflictDate.toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })} (شاملاً فترة التعقيم 15 دقيقة).`,
      };
    }
  }

  // Check specific chair conflict if specified
  if (options?.chairId) {
    const chairConflict = overlappingAppts.find((a) => a.chair_id === options.chairId);
    if (chairConflict) {
      const conflictDate = new Date(chairConflict.sterilization_end_time || chairConflict.end_time);
      return {
        available: false,
        conflictReason: `الكرسي الطبي المطلوب مشغول حالياً حتى الساعة ${conflictDate.toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}.`,
      };
    }
  }

  // If total overlapping appointments reach total chairs capacity (3 chairs in Nashmi clinic)
  const activeChairs = await getDentalChairs(clinicId);
  const totalChairs = activeChairs.length || 3;
  if (overlappingAppts.length >= totalChairs) {
    const earliestEnd = Math.min(
      ...overlappingAppts.map((a) => new Date(a.sterilization_end_time || a.end_time).getTime())
    );
    const freeTime = new Date(earliestEnd).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });
    return {
      available: false,
      conflictReason: `كافة عيادات وكراسي المركز الـ (${totalChairs}) محجوزة بالكامل في هذا التوقيت. أقرب شاغر متاح عند الساعة ${freeTime}.`,
    };
  }

  return { available: true };
}

/**
 * Frictionless Booking:
 * - Multi-Practitioner & Multi-Chair allocation
 * - Zero upfront deposit
 * - Adds 15-min sterilization buffer
 * - Saves distinct patient record under WhatsApp number (Family Profiles)
 * - Pushes to Google Calendar via Service Account
 */
export async function bookFrictionlessAppointment(
  input: BookAppointmentInput
): Promise<SchedulingResult> {
  const clinicId = input.clinicId || CLINIC_CONFIG.id;
  const service = CLINICAL_SERVICES[input.serviceType] || CLINICAL_SERVICES.consultation;

  // 1. Calculate Timestamps (Amman working hours compatible)
  const [hours, minutes] = input.timeStr.split(':').map(Number);
  const dateParts = input.dateStr.includes('T')
    ? input.dateStr.split('T')[0].split('-').map(Number)
    : input.dateStr.split('-').map(Number);
  const startDate = dateParts.length === 3
    ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2], hours, minutes, 0, 0)
    : parseAmmanDateTime(input.dateStr, input.timeStr);

  const durationMs = service.durationMinutes * 60 * 1000;
  const sterilizationBufferMs = CLINIC_CONFIG.sterilizationBufferMinutes * 60 * 1000;

  const endDate = new Date(startDate.getTime() + durationMs);
  const sterilizationEndDate = new Date(endDate.getTime() + sterilizationBufferMs);

  // Resolve default practitioner & chair if omitted
  let resolvedPractitionerId = input.practitionerId;
  let resolvedPractitionerName = input.practitionerName;
  let resolvedChairId = input.chairId;
  let resolvedChairNumber = input.chairNumber;

  if (!resolvedPractitionerId) {
    if (input.serviceType === 'orthodontics_check') {
      resolvedPractitionerId = 'doc-dima-002';
      resolvedPractitionerName = 'د. ديما التميمي';
    } else if (
      input.serviceType === 'cleaning' ||
      input.serviceType === 'restoration' ||
      input.serviceType === 'whitening'
    ) {
      resolvedPractitionerId = 'doc-rami-003';
      resolvedPractitionerName = 'د. رامي عبيدات';
    } else {
      resolvedPractitionerId = 'doc-qasim-001';
      resolvedPractitionerName = 'د. قاسم نشمي';
    }
  }

  if (input.chairNumber && !input.chairId) {
    resolvedChairNumber = input.chairNumber;
    resolvedChairId = `chair-00${input.chairNumber}`;
  } else if (input.chairId && !input.chairNumber) {
    resolvedChairId = input.chairId;
    resolvedChairNumber = parseInt(input.chairId.replace(/\D/g, ''), 10) || 1;
  } else if (!resolvedChairId) {
    if (resolvedPractitionerId === 'doc-dima-002' || input.serviceType === 'orthodontics_check') {
      resolvedChairId = 'chair-002';
      resolvedChairNumber = 2;
    } else if (
      resolvedPractitionerId === 'doc-rami-003' ||
      input.serviceType === 'cleaning' ||
      input.serviceType === 'restoration' ||
      input.serviceType === 'whitening'
    ) {
      resolvedChairId = 'chair-003';
      resolvedChairNumber = 3;
    } else {
      resolvedChairId = 'chair-001';
      resolvedChairNumber = 1;
    }
  }

  // 2. Conflict Check with Multi-Chair & Multi-Practitioner Awareness
  const check = await checkSlotAvailability(clinicId, startDate, sterilizationEndDate, {
    practitionerId: resolvedPractitionerId,
    practitionerName: resolvedPractitionerName,
    chairId: resolvedChairId,
    chairNumber: resolvedChairNumber,
    serviceType: input.serviceType,
  });

  if (!check.available) {
    return {
      success: false,
      message: check.conflictReason || 'الوقت المطلوب غير متوفر حالياً.',
      conflictDetails: check.conflictReason,
    };
  }

  // 3. Family Profile Handling: Find or Create distinct patient record
  const { patient } = await findOrCreatePatient({
    clinicId,
    phone: input.phone,
    fullName: input.patientName,
    nationalId: input.nationalId,
    familyRelation: input.familyRelation || 'self',
    primaryContactPhone: input.phone,
  });

  // Ensure PDPL consent is recorded as patient is actively booking
  await recordPdplConsent(patient.id, clinicId, true);

  // 4. Push to Google Calendar (Service Account)
  let googleCalendarEventId: string | undefined;
  // Dynamic per-tenant Google Calendar ID from clinics table / store
  let calendarId: string | undefined;
  try {
    const { data: clinicData } = await supabase
      .from('clinics')
      .select('google_calendar_id')
      .eq('id', clinicId)
      .maybeSingle();
    calendarId = clinicData?.google_calendar_id;
  } catch (err) {
    console.warn('[Calendar] Failed to fetch clinic google_calendar_id from DB:', err);
  }
  if (!calendarId) {
    const cachedClinic = tenantStore.clinics.find((c) => c.id === clinicId);
    calendarId = cachedClinic?.google_calendar_id;
  }
  if (!calendarId) {
    calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  }

  const calendar = getCalendarClient();
  if (calendar) {
    try {
      const summaryText = `[نظام ترتيب] ${service.nameAr} - ${input.patientName}`;
      const descriptionText = `حجز موعد عيادة عبر نظام ترتيب لإدارة العيادات (المساعد نشمي)
المريض: ${input.patientName} (${input.familyRelation === 'self' ? 'صاحب الرقم' : `أحد أفراد العائلة: ${input.familyRelation}`})
رقم الهاتف: ${input.phone}
الخدمة: ${service.nameAr} (${service.durationMinutes} دقيقة)
فترة التعقيم الإلزامية: 15 دقيقة إضافية
الحالة: مؤكد 100%`;

      const insertPromise = calendar.events.insert({
        calendarId,
        requestBody: {
          summary: summaryText,
          description: descriptionText,
          start: {
            dateTime: startDate.toISOString(),
            timeZone: CLINIC_CONFIG.timezone,
          },
          end: {
            dateTime: sterilizationEndDate.toISOString(), // Reserve the slot including sterilization buffer
            timeZone: CLINIC_CONFIG.timezone,
          },
          location: CLINIC_CONFIG.address,
        },
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Google Calendar insertion timed out')), 3500)
      );

      const response: any = await Promise.race([insertPromise, timeoutPromise]);
      googleCalendarEventId = response?.data?.id || undefined;
      console.log(`[Google Calendar] Successfully created event ID: ${googleCalendarEventId}`);
    } catch (err) {
      console.warn('[Google Calendar] Could not push to remote calendar, stored in resilient tenant store:', err);
    }
  }

  // 5. Create Appointment in Supabase / Tenant Store (Atomic Double-Booking Guard)
  try {
    const appointment = await createAppointment({
      clinicId,
      patientId: patient.id,
      patientName: input.patientName,
      patientPhone: input.phone,
      serviceType: input.serviceType,
      practitionerId: resolvedPractitionerId,
      practitionerName: resolvedPractitionerName,
      chairId: resolvedChairId,
      chairNumber: resolvedChairNumber,
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      sterilizationEndTime: sterilizationEndDate.toISOString(),
      googleCalendarEventId,
      notes: input.notes,
      isEmergency: input.isEmergency,
    });

    const formattedDate = startDate.toLocaleDateString('ar-JO', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const formattedTime = startDate.toLocaleTimeString('ar-JO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const docLine = appointment.practitioner_name ? `\nالطبيب المعالج: ${appointment.practitioner_name}` : '';
    const chairLine = appointment.chair_number ? `\nالعيادة / الكرسي: كرسي رقم ${appointment.chair_number}` : '';

    return {
      success: true,
      appointment,
      googleCalendarEventId,
      message: `يا هلا بك، تم تثبيت موعدك تمام، بانتظارك وتنورنا!
اليوم: ${formattedDate}
الساعة: ${formattedTime}
الخدمة: ${service.nameAr}${docLine}${chairLine}
المركز: ${CLINIC_CONFIG.name} (${CLINIC_CONFIG.address})`,
    };
  } catch (err: any) {
    if (err?.code === 'DOUBLE_BOOKING_CONFLICT' || err?.message?.includes('DOUBLE_BOOKING_CONFLICT')) {
      return {
        success: false,
        message: `عذراً، يبدو أن هذا الموعد تم حجزه للتو أو يتعارض مع فترة التعقيم الإلزامية (15 دقيقة). هل يناسبك وقت بديل مثل 14:00 أو 16:30؟`,
        conflictDetails: err.message,
      };
    }
    throw err;
  }
}

/**
 * Delete a Calendar Event from Google Calendar (Reverse Sync-Back)
 * Purges cancelled or rescheduled appointments to prevent phantom calendar clutter.
 */
export async function deleteCalendarEvent(
  eventId: string,
  clinicId?: string,
  calendarId?: string
): Promise<{ success: boolean; error?: string }> {
  if (!eventId) {
    return { success: false, error: 'No eventId provided' };
  }

  let resolvedCalendarId = calendarId;
  if (!resolvedCalendarId && clinicId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('clinics')
        .select('google_calendar_id')
        .eq('id', clinicId)
        .maybeSingle();

      if (!error && data?.google_calendar_id) {
        resolvedCalendarId = data.google_calendar_id;
      }
    } catch (dbErr) {
      console.warn('[Google Calendar] Clinic calendar lookup error, using default:', dbErr);
    }
  }

  if (!resolvedCalendarId) {
    resolvedCalendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  }

  const calendar = getCalendarClient();
  if (!calendar) {
    console.log(`[Google Calendar - Simulated Mode] Event ${eventId} marked deleted from calendar ${resolvedCalendarId}`);
    return { success: true };
  }

  try {
    const deletePromise = calendar.events.delete({
      calendarId: resolvedCalendarId,
      eventId,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Google Calendar event deletion timed out')), 3500)
    );

    await Promise.race([deletePromise, timeoutPromise]);
    console.log(`[Google Calendar] Successfully deleted event ${eventId} from calendar ${resolvedCalendarId}`);
    return { success: true };
  } catch (err: any) {
    console.warn(`[Google Calendar] Failed to delete event ${eventId}:`, err?.message || err);
    return { success: false, error: err?.message || 'Deletion failed' };
  }
}


