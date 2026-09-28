// NashmiOps Enterprise (MVP Edition) - Operational Jobs API Endpoint
// ====================================================================
// External Cron Execution Guide (e.g., cron-job.org / Cloudflare Cron):
// Endpoint: GET https://<your-domain>/api/jobs?action=cron_batch
// Schedule: Every 15 minutes (*/15 * * * *)
// Security Header: Authorization: Bearer <CRON_SECRET> or x-cron-secret: <CRON_SECRET>
// Runs:
//  - 24h & 2h Smart Reminders with Amman Google Maps Pin
//  - 1h No-Show Autonomous Re-engagement & Waitlist Recovery
//  - Webhook Message Deduplication Table TTL Cleanup (48 hours)
//  - Outbound WhatsApp and JoFotara DB Retry Queues (SKIP LOCKED)
// ====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { tenantStore, getAllAppointments, cleanupOldProcessedMessages, getLatestInvoiceHash } from '@/lib/db/supabase';
import { CLINIC_CONFIG } from '@/lib/config/constants';
import { triggerWaitlistSniper } from '@/lib/jobs/waitlist-sniper';
import { processNoShowRecovery } from '@/lib/jobs/no-show-recovery';
import { processSmartReminders } from '@/lib/jobs/smart-reminders';
import { compileJoFotaraXML } from '@/lib/jofotara/xml-compiler';
import { processJoFotaraRetryQueue } from '@/lib/jofotara/client';
import { processWhatsAppRetryQueue, whatsappRetryQueue } from '@/lib/whatsapp/retry-queue';
import { verifyApiAuthorization } from '@/lib/auth/api-guard';
import { captureException, captureMessage, getRecentAPMEvents } from '@/lib/monitoring/apm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = verifyApiAuthorization(req);
  if (!auth.authorized) {
    return auth.response!;
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'get_apm_events') {
    const events = getRecentAPMEvents(50);
    return NextResponse.json({ success: true, count: events.length, events });
  }

  // Vercel Cron & External GET automated scheduler support
  if (action === 'trigger_smart_reminders') {
    const result = await processSmartReminders();
    return NextResponse.json({ success: true, cron: true, action, result });
  }

  if (action === 'trigger_no_show_recovery') {
    const result = await processNoShowRecovery();
    return NextResponse.json({ success: true, cron: true, action, result });
  }

  if (action === 'cleanup_messages' || action === 'trigger_cleanup_messages') {
    const cleanup = await cleanupOldProcessedMessages(48);
    return NextResponse.json({ success: true, cron: true, action: 'cleanup_messages', cleanup });
  }

  if (action === 'retry_whatsapp') {
    const retries = await processWhatsAppRetryQueue();
    return NextResponse.json({ success: true, action: 'retry_whatsapp', retries });
  }

  if (action === 'retry_jofotara') {
    const retries = await processJoFotaraRetryQueue();
    return NextResponse.json({ success: true, action: 'retry_jofotara', retries });
  }

  if (action === 'cron_batch' || action === 'all') {
    const reminders = await processSmartReminders();
    const recovery = await processNoShowRecovery();
    const cleanup = await cleanupOldProcessedMessages(48); // Automatic TTL cleanup of old webhook messages
    const whatsappRetries = await processWhatsAppRetryQueue();
    const jofotaraRetries = await processJoFotaraRetryQueue();
    return NextResponse.json({
      success: true,
      cron: true,
      action: 'cron_batch',
      results: { reminders, recovery, cleanup, whatsappRetries, jofotaraRetries },
    });
  }

  // Synchronize appointments from Supabase / persistent store
  await getAllAppointments();

  return NextResponse.json({
    clinics: tenantStore.clinics,
    patients: tenantStore.patients.filter((p) => !p.is_deleted),
    appointments: tenantStore.appointments,
    waitlist: tenantStore.waitlist,
    invoices: tenantStore.invoices,
    practitioners: tenantStore.practitioners,
    dental_chairs: tenantStore.dental_chairs,
    clinical_records: tenantStore.clinical_records,
    receptionist_alerts: tenantStore.receptionist_alerts,
    failed_outbound_messages: tenantStore.failed_outbound_messages,
    apm_events: getRecentAPMEvents(30),
  });
}

export async function POST(req: NextRequest) {
  const auth = verifyApiAuthorization(req);
  if (!auth.authorized) {
    return auth.response!;
  }

  try {
    const { action, payload } = await req.json();

    switch (action) {
      case 'trigger_waitlist_sniper': {
        const targetAppt =
          tenantStore.appointments.find((a) => a.id === payload?.appointmentId) ||
          tenantStore.appointments[0];

        if (!targetAppt) {
          return NextResponse.json({ error: 'No appointments available to cancel' }, { status: 400 });
        }

        targetAppt.status = 'CANCELLED';
        const result = await triggerWaitlistSniper(targetAppt);
        return NextResponse.json({ success: true, action, result });
      }

      case 'trigger_no_show_recovery': {
        // Mark first appt as NO_SHOW if none exists
        let noShowAppt = tenantStore.appointments.find((a) => a.status === 'NO_SHOW');
        if (!noShowAppt && tenantStore.appointments.length > 0) {
          tenantStore.appointments[0].status = 'NO_SHOW';
          tenantStore.appointments[0].start_time = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago
        }

        const result = await processNoShowRecovery();
        return NextResponse.json({ success: true, action, result });
      }

      case 'trigger_smart_reminders': {
        const result = await processSmartReminders();
        return NextResponse.json({ success: true, action, result });
      }

      case 'cleanup_messages': {
        const cleanup = await cleanupOldProcessedMessages(payload?.maxAgeHours || 48);
        return NextResponse.json({ success: true, action, cleanup });
      }

      case 'test_jofotara': {
        const isB2B = payload?.invoiceType === 'B2B_STANDARD';
        const clinicId = payload?.clinicId || CLINIC_CONFIG.id;
        const previousInvoiceHash = await getLatestInvoiceHash(clinicId);
        const compileRes = compileJoFotaraXML({
          invoiceNumber: `INV-${Date.now().toString().slice(-4)}`,
          invoiceType: isB2B ? 'B2B_STANDARD' : 'B2C_SIMPLIFIED',
          buyerName: payload?.buyerName || (isB2B ? 'شركة النماء الطبية' : 'مريض نقدي'),
          buyerTaxId: isB2B ? (payload?.buyerTaxId || '109283746') : undefined,
          buyerNationalId: payload?.buyerNationalId,
          previousInvoiceHash,
          items: payload?.items || (isB2B
            ? [
                {
                  name: 'خدمات طب وجراحة أسنان لمنتسبي الشركة',
                  quantity: 2,
                  unitPrice: 125.0,
                  taxRate: 0.16,
                  total: 290.0,
                },
              ]
            : [
                {
                  name: 'كشف واستشارة طبية شاملة مع تنظيف وتلميع أسنان',
                  quantity: 1,
                  unitPrice: 35.0,
                  taxRate: 0.16,
                  total: 40.6,
                },
              ]),
        });
        return NextResponse.json({ success: true, compileRes });
      }

      case 'trigger_test_apm': {
        const warnEvent = captureMessage('اختبار مراقبة APM: فحص تشخيصي دوري للأنظمة التشغيلية', 'WARNING', {
          route: '/api/jobs',
          endpoint: 'trigger_test_apm',
        });
        return NextResponse.json({ success: true, event: warnEvent });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    captureException(err, { route: '/api/jobs', endpoint: 'POST' });
    return NextResponse.json({ error: err?.message || 'Execution error' }, { status: 500 });
  }
}
