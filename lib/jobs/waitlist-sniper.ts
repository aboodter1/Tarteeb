// NashmiOps Enterprise (MVP Edition) - Waitlist Sniper

import { Appointment, WaitlistEntry } from '@/types';
import { tenantStore } from '@/lib/db/supabase';
import { CLINIC_CONFIG, CLINICAL_SERVICES } from '@/lib/config/constants';
import { sendWhatsAppTextMessage } from '@/lib/whatsapp/client';

import { formatAmmanDate, formatAmmanTime } from '@/lib/utils/timezone';

export interface SniperResult {
  triggered: boolean;
  cancelledAppointmentId: string;
  candidateFound: boolean;
  notifiedCandidate?: WaitlistEntry;
  metaTemplatePayload?: {
    to: string;
    templateName: string;
    language: string;
    messageText: string;
  };
}

/**
 * Waitlist Sniper: Autonomously triggered when an appointment is cancelled.
 * It immediately matches waiting patients by service duration compatibility and sends a Meta WhatsApp Utility Template.
 */
export async function triggerWaitlistSniper(
  cancelledAppt: Appointment
): Promise<SniperResult> {
  const cancelledStartDate = new Date(cancelledAppt.start_time);
  const cancelledEndDate = new Date(cancelledAppt.end_time);
  const apptDate = formatAmmanDate(cancelledStartDate);
  const apptTime = formatAmmanTime(cancelledStartDate);

  // Calculate available slot duration in minutes
  const slotDurationMinutes = Math.max(
    15,
    Math.round((cancelledEndDate.getTime() - cancelledStartDate.getTime()) / (60 * 1000))
  );

  // Find next waiting patient for this clinic, matching service duration and date
  const candidate = tenantStore.waitlist.find((w) => {
    if (w.clinic_id !== cancelledAppt.clinic_id) return false;
    if (w.status !== 'WAITING') return false;
    if (w.preferred_date > apptDate) return false;

    // Check that waiting patient's service duration fits within available vacancy
    const candidateService = CLINICAL_SERVICES[w.requested_service];
    const candidateDuration = candidateService?.durationMinutes || 30;
    if (candidateDuration > slotDurationMinutes) {
      console.log(`[Waitlist Sniper] Candidate ${w.patient_name} requires ${candidateDuration}m which exceeds vacant slot of ${slotDurationMinutes}m.`);
      return false;
    }

    return true;
  });

  if (!candidate) {
    return {
      triggered: true,
      cancelledAppointmentId: cancelledAppt.id,
      candidateFound: false,
    };
  }

  // Update candidate status
  candidate.status = 'NOTIFIED';
  candidate.notified_at = new Date().toISOString();

  const serviceName =
    CLINICAL_SERVICES[cancelledAppt.service_type]?.nameAr || 'كشف واستشارة';

  // Meta WhatsApp Utility Template Format (Jordanian Arabic)
  const messageText = `مرحباً ${candidate.patient_name} يا هلا فيك،
توفر موعد شاغر مبكر في مركز نشمي لطب وجراحة الأسنان بعمان!
🗓️ التاريخ: ${apptDate}
⏰ الوقت: ${apptTime}
🩺 الخدمة: ${serviceName}

إذا بتحب تأكد الموعد الآن، بس رد بـ "نعم أكد الموعد" وراح نسجله لك فوراً! 🦷`;

  const metaTemplatePayload = {
    to: candidate.patient_phone,
    templateName: 'waitlist_slot_notification_ar',
    language: 'ar',
    messageText,
  };

  console.log(`[Waitlist Sniper] Dispatched slot offer to ${candidate.patient_phone} for slot ${apptDate} ${apptTime}`);

  // Send real outbound WhatsApp message to candidate patient
  try {
    await sendWhatsAppTextMessage(candidate.patient_phone, messageText);
  } catch (outboundErr) {
    console.warn('[Waitlist Sniper] Failed to send outbound WhatsApp message:', outboundErr);
  }

  return {
    triggered: true,
    cancelledAppointmentId: cancelledAppt.id,
    candidateFound: true,
    notifiedCandidate: candidate,
    metaTemplatePayload,
  };
}
