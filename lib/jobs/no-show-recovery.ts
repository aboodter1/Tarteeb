// NashmiOps Enterprise (MVP Edition) - No-Show Recovery Background Job

import { Appointment } from '@/types';
import { tenantStore, supabaseAdmin, isPlaceholderConfig } from '@/lib/db/supabase';
import { sendWhatsAppTextMessage } from '@/lib/whatsapp/client';

export interface RecoveryAction {
  appointmentId: string;
  patientName: string;
  patientPhone: string;
  missedTime: string;
  reengagementMessage: string;
  sentAt: string;
}

/**
 * Scan for appointments with status NO_SHOW.
 * Dispatch a polite re-engagement WhatsApp message 1 hour post missed slot.
 */
export async function processNoShowRecovery(): Promise<{
  processedCount: number;
  actions: RecoveryAction[];
}> {
  const now = Date.now();
  const oneHourMs = 3600000;
  const actions: RecoveryAction[] = [];

  let noShows: Appointment[] = [];
  if (!isPlaceholderConfig) {
    try {
      const { data, error } = await supabaseAdmin
        .from('appointments')
        .select('*')
        .eq('status', 'NO_SHOW');

      if (error) {
        console.error('[No-Show Recovery] Supabase query error on appointments:', error.message || error);
        noShows = tenantStore.appointments.filter((appt) => {
          if (appt.status !== 'NO_SHOW') return false;
          const apptTime = new Date(appt.start_time).getTime();
          return now >= apptTime + oneHourMs;
        });
      } else if (Array.isArray(data) && data.length > 0) {
        noShows = (data as Appointment[]).filter((appt) => {
          const apptTime = new Date(appt.start_time).getTime();
          return now >= apptTime + oneHourMs;
        });
      } else {
        noShows = tenantStore.appointments.filter((appt) => {
          if (appt.status !== 'NO_SHOW') return false;
          const apptTime = new Date(appt.start_time).getTime();
          return now >= apptTime + oneHourMs;
        });
      }
    } catch (err) {
      console.warn('[No-Show Recovery] Exception querying appointments from Supabase:', err);
      noShows = tenantStore.appointments.filter((appt) => {
        if (appt.status !== 'NO_SHOW') return false;
        const apptTime = new Date(appt.start_time).getTime();
        return now >= apptTime + oneHourMs;
      });
    }
  } else {
    noShows = tenantStore.appointments.filter((appt) => {
      if (appt.status !== 'NO_SHOW') return false;
      const apptTime = new Date(appt.start_time).getTime();
      return now >= apptTime + oneHourMs;
    });
  }

  for (const appt of noShows) {
    const formattedTime = new Date(appt.start_time).toLocaleTimeString('ar-JO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const reengagementMessage = `مرحباً ${appt.patient_name} يا هلا فيك،
لاحظنا أنك ما قدرت تحضر موعدك اليوم الساعة ${formattedTime} في مركز نشمي لطب وجراحة الأسنان بعمان.
سلامتك وأسنانك تهمنا كثير! ولا تشيل هم، بنقدر نحدد لك موعد بديل ومجاني في الوقت اللي بناسبك.
شو رأيك نجدول لك موعد جديد بكرة أو أي يوم ثاني هالأسبوع؟ تفضل بالرد وسأساعدك فوراً. 🦷`;

    actions.push({
      appointmentId: appt.id,
      patientName: appt.patient_name,
      patientPhone: appt.patient_phone,
      missedTime: appt.start_time,
      reengagementMessage,
      sentAt: new Date().toISOString(),
    });

    console.log(`[No-Show Recovery] Dispatched re-engagement message to ${appt.patient_phone}`);

    // Send real WhatsApp message
    try {
      await sendWhatsAppTextMessage(appt.patient_phone, reengagementMessage);
    } catch (err) {
      console.warn(`[No-Show Recovery] Failed to send recovery message to ${appt.patient_phone}:`, err);
    }
  }

  return {
    processedCount: actions.length,
    actions,
  };
}
