// NashmiOps Enterprise (MVP Edition) - Smart Reminders Worker

import { Appointment } from '@/types';
import { tenantStore } from '@/lib/db/supabase';
import { CLINIC_CONFIG, CLINICAL_SERVICES } from '@/lib/config/constants';
import { sendWhatsAppTextMessage } from '@/lib/whatsapp/client';

export interface ReminderNotification {
  type: '24H_PRE_REMINDER' | '2H_PRE_LOCATION_PIN';
  appointmentId: string;
  patientName: string;
  patientPhone: string;
  scheduledTime: string;
  messageText: string;
  sentAt: string;
}

/**
 * Smart Reminders Worker:
 * 1. 24-hour reminder before appointment.
 * 2. 2-hour pre-appointment reminder containing native Amman Google Maps location link.
 */
export async function processSmartReminders(): Promise<{
  remindersSent: ReminderNotification[];
}> {
  const now = Date.now();
  const remindersSent: ReminderNotification[] = [];

  const confirmedAppts = tenantStore.appointments.filter(
    (a) => a.status === 'CONFIRMED'
  );

  for (const appt of confirmedAppts) {
    const apptTime = new Date(appt.start_time).getTime();
    const diffHours = (apptTime - now) / (1000 * 60 * 60);

    const formattedTime = new Date(appt.start_time).toLocaleTimeString('ar-JO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const formattedDate = appt.start_time.split('T')[0];
    const serviceName =
      CLINICAL_SERVICES[appt.service_type]?.nameAr || 'كشف واستشارة';

    // 2-hour reminder window (between 1.5 and 2.5 hours before appointment)
    if (diffHours > 0 && diffHours <= 2.5 && diffHours >= 1.5) {
      const messageText = `مرحباً ${appt.patient_name} يا هلا فيك،
تذكير: موعدك لـ (${serviceName}) في مركز نشمي لطب وجراحة الأسنان اليوم الساعة ${formattedTime} (خلال ساعتين).
📍 موقع العيادة المباشر على خرائط جوجل:
${CLINIC_CONFIG.googleMapsUrl}
(عمان - الدوار السابع - مجمع النشامى الطبي - الطابق الثالث)
نتشرف بزيارتك ونتمنى لك دوام الصحة والعافية! 🦷`;

      remindersSent.push({
        type: '2H_PRE_LOCATION_PIN',
        appointmentId: appt.id,
        patientName: appt.patient_name,
        patientPhone: appt.patient_phone,
        scheduledTime: appt.start_time,
        messageText,
        sentAt: new Date().toISOString(),
      });

      // Send real WhatsApp message
      try {
        await sendWhatsAppTextMessage(appt.patient_phone, messageText);
      } catch (err) {
        console.warn(`[Smart Reminders] Failed to send 2H reminder to ${appt.patient_phone}:`, err);
      }
    }
    // 24-hour reminder window (between 23 and 25 hours before appointment)
    else if (diffHours > 23 && diffHours <= 25) {
      const messageText = `مرحباً ${appt.patient_name}،
تذكير بموعدك القادم غداً ${formattedDate} الساعة ${formattedTime} لدى مركز نشمي لطب الأسنان بعمان.
إذا كان كل شيء مناسب، موعدك مؤكد 100% ولا تحتاج لأي تأكيد إضافي. تفضل بإعلامنا إذا رغبت بتعديل الموعد. يا هلا فيك! 🦷`;

      remindersSent.push({
        type: '24H_PRE_REMINDER',
        appointmentId: appt.id,
        patientName: appt.patient_name,
        patientPhone: appt.patient_phone,
        scheduledTime: appt.start_time,
        messageText,
        sentAt: new Date().toISOString(),
      });

      // Send real WhatsApp message
      try {
        await sendWhatsAppTextMessage(appt.patient_phone, messageText);
      } catch (err) {
        console.warn(`[Smart Reminders] Failed to send 24H reminder to ${appt.patient_phone}:`, err);
      }
    }
  }

  return { remindersSent };
}
