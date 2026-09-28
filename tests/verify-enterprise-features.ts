// NashmiOps Enterprise (MVP Edition) - Enterprise Live Operations Verification Suite

import fs from 'fs';
import path from 'path';
import { isAndMarkWebhookMessageProcessed, createAppointment } from '../lib/db/supabase';
import { GET as jobsGetHandler, POST as jobsPostHandler } from '../app/api/jobs/route';
import { POST as webhookPostHandler } from '../app/api/webhook/whatsapp/route';
import { NextRequest } from 'next/server';

async function runEnterpriseTests() {
  console.log('===============================================================');
  console.log('🏛️ NASHMIOPS ENTERPRISE LIVE PRODUCTION VERIFICATION SUITE');
  console.log('===============================================================');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${desc}`);
      throw new Error(`Assertion failed: ${desc}`);
    }
  }

  // 1. Webhook Deduplication via Supabase
  console.log('\n--- 1. Testing Database-Level Webhook Deduplication ---');
  const testMessageId = `wamid.test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  
  // First arrival: should be marked as new (false)
  const isDup1 = await isAndMarkWebhookMessageProcessed({
    messageId: testMessageId,
    senderPhone: '+962791234567',
    messageType: 'text',
  });
  assert(isDup1 === false, 'First arrival of messageId is accepted as new');

  // Second arrival (Meta retry): should be detected as duplicate (true)
  const isDup2 = await isAndMarkWebhookMessageProcessed({
    messageId: testMessageId,
    senderPhone: '+962791234567',
    messageType: 'text',
  });
  assert(isDup2 === true, 'Duplicate arrival of messageId is strictly identified and rejected');

  // Test full Webhook route POST deduplication
  const mockWebhookReq = new NextRequest('http://localhost:3000/api/webhook/whatsapp', {
    method: 'POST',
    body: JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: testMessageId, // Already processed
                    from: '962791234567',
                    text: { body: 'رسالة مكررة' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  });
  const webhookRes = await webhookPostHandler(mockWebhookReq);
  const webhookJson = await webhookRes.json();
  assert(webhookJson.status === 'duplicate_skipped', 'Webhook handler returns duplicate_skipped on duplicate message');

  // 2. Automated Cron Job Setup & Vercel.json
  console.log('\n--- 2. Testing Automated Cron Job Setup & Execution ---');
  const vercelJsonPath = path.join(process.cwd(), 'vercel.json');
  assert(fs.existsSync(vercelJsonPath), 'vercel.json exists in root directory');
  const vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf-8'));
  assert(
    !vercelConfig.crons || vercelConfig.crons.length === 0,
    'Conflicting limited daily midnight Vercel crons removed in favor of external cron-job.org 15m runner'
  );

  // Test Cron Execution via GET /api/jobs with Authorization: Bearer ${CRON_SECRET}
  const cronSecret = process.env.CRON_SECRET || 'nashmi_cron_secret_token_2026';
  
  // Smart Reminders Cron
  const smartRemindersReq = new NextRequest('https://api.nashmiops.jo/api/jobs?action=trigger_smart_reminders', {
    headers: {
      host: 'api.nashmiops.jo',
      authorization: `Bearer ${cronSecret}`,
    },
  });
  const smartRemindersRes = await jobsGetHandler(smartRemindersReq);
  const smartRemindersJson = await smartRemindersRes.json();
  assert(smartRemindersJson.success === true && smartRemindersJson.cron === true, 'Smart reminders triggered via GET Cron');

  // No-Show Recovery Cron
  const noShowReq = new NextRequest('https://api.nashmiops.jo/api/jobs?action=trigger_no_show_recovery', {
    headers: {
      host: 'api.nashmiops.jo',
      authorization: `Bearer ${cronSecret}`,
    },
  });
  const noShowRes = await jobsGetHandler(noShowReq);
  const noShowJson = await noShowRes.json();
  assert(noShowJson.success === true && noShowJson.cron === true, 'No-show recovery triggered via GET Cron');

  // Cron Batch execution
  const batchCronReq = new NextRequest('https://api.nashmiops.jo/api/jobs?action=cron_batch', {
    headers: {
      host: 'api.nashmiops.jo',
      authorization: `Bearer ${cronSecret}`,
    },
  });
  const batchCronRes = await jobsGetHandler(batchCronReq);
  const batchCronJson = await batchCronRes.json();
  assert(batchCronJson.success === true && batchCronJson.action === 'cron_batch', 'Cron batch runs both smart reminders and no-show recovery');

  // 3. Database-Level Conflict Exclusion & Atomic Booking SQL Migration
  console.log('\n--- 3. Testing Database-Level Conflict Exclusion & Atomic Booking ---');
  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261001_appointment_exclusion_constraint.sql');
  assert(fs.existsSync(migrationPath), 'SQL Exclusion constraint migration file exists');
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
  assert(migrationSql.includes('btree_gist'), 'Migration enables btree_gist extension');
  assert(migrationSql.includes('EXCLUDE USING gist'), 'Migration defines EXCLUDE USING gist constraint');
  assert(migrationSql.includes('tstzrange(start_time, sterilization_end_time)'), 'Constraint covers start_time through sterilization_end_time buffer');
  assert(migrationSql.includes('processed_webhook_messages'), 'Migration creates processed_webhook_messages table');

  const atomicMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261005_atomic_appointment_booking.sql');
  assert(fs.existsSync(atomicMigrationPath), 'Atomic booking migration file exists');
  const atomicSql = fs.readFileSync(atomicMigrationPath, 'utf-8');
  assert(atomicSql.includes('book_appointment_atomic'), 'Migration defines book_appointment_atomic RPC function');
  assert(atomicSql.includes('DOUBLE_BOOKING_CONFLICT'), 'Migration defines DOUBLE_BOOKING_CONFLICT exception');
  assert(atomicSql.includes('23P01'), 'Migration binds PostgreSQL exclusion violation code 23P01');

  const { createAppointmentAtomic, subscribeToClinicTableChanges, subscribeToAppointments } = await import('../lib/db/supabase');
  assert(typeof createAppointmentAtomic === 'function', 'createAppointmentAtomic is exported as a function');
  assert(typeof subscribeToClinicTableChanges === 'function', 'subscribeToClinicTableChanges is exported');
  assert(typeof subscribeToAppointments === 'function', 'subscribeToAppointments is exported');

  // Verify Persistent Retry Queues SQL Migrations
  const waRetryMigPath = path.join(process.cwd(), 'supabase', 'migrations', '20261006_whatsapp_retry_queue.sql');
  assert(fs.existsSync(waRetryMigPath), 'WhatsApp retry queue SQL migration file exists');
  const waRetrySql = fs.readFileSync(waRetryMigPath, 'utf-8');
  assert(waRetrySql.includes('whatsapp_message_retries'), 'Migration creates whatsapp_message_retries table');

  const jofotaraRetryMigPath = path.join(process.cwd(), 'supabase', 'migrations', '20261007_jofotara_retry_queue.sql');
  assert(fs.existsSync(jofotaraRetryMigPath), 'JoFotara retry queue SQL migration file exists');
  const jofotaraRetrySql = fs.readFileSync(jofotaraRetryMigPath, 'utf-8');
  assert(jofotaraRetrySql.includes('jofotara_invoice_retries'), 'Migration creates jofotara_invoice_retries table');

  const queueLocksMigPath = path.join(process.cwd(), 'supabase', 'migrations', '20261008_queue_row_level_locks_skip_locked.sql');
  assert(fs.existsSync(queueLocksMigPath), 'Row-level queue locking SQL migration file exists');
  const queueLocksSql = fs.readFileSync(queueLocksMigPath, 'utf-8');
  assert(queueLocksSql.includes('claim_pending_whatsapp_retries'), 'Migration defines claim_pending_whatsapp_retries RPC');
  assert(queueLocksSql.includes('claim_pending_jofotara_retries'), 'Migration defines claim_pending_jofotara_retries RPC');
  assert(queueLocksSql.includes('FOR UPDATE SKIP LOCKED'), 'Migration implements FOR UPDATE SKIP LOCKED clause');

  // 4. Edge/Serverless Execution Safeguards & Preemptive Timeout Guard
  console.log('\n--- 4. Testing Edge/Serverless Execution Safeguards ---');
  const webhookCode = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'webhook', 'whatsapp', 'route.ts'), 'utf-8');
  assert(webhookCode.includes("import { waitUntil } from '@vercel/functions'"), 'Webhook route imports waitUntil from @vercel/functions');
  assert(webhookCode.includes('waitUntil(backgroundTask)'), 'Webhook route executes background ReAct agent inside waitUntil safeguard');
  assert(webhookCode.includes('PREEMPTIVE_TIMEOUT_MS = 8500'), 'Webhook route enforces 8.5s Preemptive Timeout Guard');
  assert(webhookCode.includes('generateLocalFallbackResponse'), 'Webhook route intercepts timeout with local fallback response');

  // 5. Working Hours & Friday Closure Guard
  console.log('\n--- 5. Testing Clinic Working Hours & Friday Closure Guard ---');
  const { validateClinicWorkingHours, bookFrictionlessAppointment } = await import('../lib/calendar/scheduler');
  const { executeClinicTool } = await import('../lib/ai/clinic-tools');
  const { verifyApiAuthorization } = await import('../lib/auth/api-guard');

  // Test Friday Closure (Day 5)
  // Let's create a date that is definitely a Friday
  const testFriday = new Date('2026-10-02T11:00:00'); // Oct 2, 2026 is Friday (getDay() === 5)
  const testFridayEnd = new Date('2026-10-02T12:00:00');
  const fridayCheck = validateClinicWorkingHours(testFriday, testFridayEnd);
  assert(fridayCheck.valid === false, 'Friday booking is rejected as weekly holiday');
  assert(fridayCheck.reason?.includes('عطلة أسبوعية') === true, 'Friday rejection returns weekly closure explanation and suggestions');

  // Test Before Working Hours (< 09:00)
  const testEarlySunday = new Date('2026-10-04T08:00:00'); // Oct 4, 2026 is Sunday (getDay() === 0)
  const testEarlySundayEnd = new Date('2026-10-04T08:45:00');
  const earlyCheck = validateClinicWorkingHours(testEarlySunday, testEarlySundayEnd);
  assert(earlyCheck.valid === false, 'Booking before 09:00 is rejected');
  assert(earlyCheck.reason?.includes('قبل بدء ساعات العمل') === true, 'Early booking rejection mentions working hours start at 09:00');

  // Test After Working Hours (> 20:00 or end buffer > 20:00)
  const testLateSunday = new Date('2026-10-04T19:30:00'); // Ends at 20:15 + 15m buffer = 20:30
  const testLateSundayEnd = new Date('2026-10-04T20:30:00');
  const lateCheck = validateClinicWorkingHours(testLateSunday, testLateSundayEnd);
  assert(lateCheck.valid === false, 'Booking exceeding 20:00 with sterilization buffer is rejected');
  assert(lateCheck.reason?.includes('إغلاق العيادة') === true, 'Late booking rejection mentions 20:00 closure');

  // Test Valid Time within 09:00 - 20:00 (Sunday)
  const testValidSunday = new Date('2026-10-04T11:00:00');
  const testValidSundayEnd = new Date('2026-10-04T12:00:00');
  const validCheck = validateClinicWorkingHours(testValidSunday, testValidSundayEnd);
  assert(validCheck.valid === true, 'Booking within official hours (11:00 Sunday) is valid');

  // Test AI Tool check_calendar handling Friday
  const aiFridayCheck = await executeClinicTool('check_calendar', { preferred_date: 'يوم الجمعة' });
  assert(aiFridayCheck.is_friday_closed === true, 'AI check_calendar detects Friday closure directly');
  assert(aiFridayCheck.available_slots.length === 0, 'AI check_calendar returns 0 slots for Friday');

  // Test Frictionless Booking rejection on Friday
  const fridayBookingRes = await bookFrictionlessAppointment({
    phone: '+962791112233',
    patientName: 'عمر الجمعة',
    serviceType: 'consultation',
    dateStr: '2026-10-02', // Friday
    timeStr: '11:00',
  });
  assert(fridayBookingRes.success === false, 'bookFrictionlessAppointment rejects Friday booking');
  assert(fridayBookingRes.message.includes('الجمعة عطلة'), 'bookFrictionlessAppointment message cites Friday holiday');

  // 6. Vercel Cron Header Compatibility & Security
  console.log('\n--- 6. Testing Vercel Cron Header Compatibility ---');
  const vercelCronReq = new NextRequest('https://api.nashmiops.jo/api/jobs?action=trigger_smart_reminders', {
    headers: {
      host: 'api.nashmiops.jo',
      'x-vercel-cron': '1',
      authorization: `Bearer ${cronSecret}`,
    },
  });
  const vercelCronAuth = verifyApiAuthorization(vercelCronReq);
  assert(vercelCronAuth.authorized === true, 'Vercel Cron header (x-vercel-cron: "1") is successfully authorized');
  const vercelCronExecRes = await jobsGetHandler(vercelCronReq);
  const vercelCronExecJson = await vercelCronExecRes.json();
  assert(vercelCronExecJson.success === true, 'Vercel cron request executes /api/jobs handler successfully');

  // Verify Strict Production Security Guard
  const origNodeEnv = process.env.NODE_ENV;
  try {
    (process.env as any).NODE_ENV = 'production';
    const unauthReq = new NextRequest('https://api.nashmiops.jo/api/jobs', {
      headers: { host: 'api.nashmiops.jo' },
    });
    const unauthCheck = verifyApiAuthorization(unauthReq);
    assert(unauthCheck.authorized === false, 'Production strictly rejects unauthenticated API request');

    const spoofReq = new NextRequest('https://api.nashmiops.jo/api/jobs', {
      headers: { host: 'api.nashmiops.jo', 'x-sandbox-simulation': 'true' },
    });
    const spoofCheck = verifyApiAuthorization(spoofReq);
    assert(spoofCheck.authorized === false, 'Production strictly rejects spoofed simulation headers');
  } finally {
    (process.env as any).NODE_ENV = origNodeEnv;
  }

  // 7. Supabase RLS Migration Fallback
  console.log('\n--- 7. Testing Supabase RLS Migration Policy ---');
  const rlsMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260926000000_nashmi_mvp.sql');
  const rlsSql = fs.readFileSync(rlsMigrationPath, 'utf-8');
  assert(rlsSql.includes("COALESCE(NULLIF(current_setting('app.current_clinic_id', true), ''), 'clinic-amman-nashmi-001')"), 'RLS policy allows default clinic fallback for client requests without app.current_clinic_id');

  // 8. ISTD JoFotara Network API Client & Submission
  console.log('\n--- 8. Testing ISTD JoFotara Network API Client & Transmission ---');
  const { submitInvoiceToJoFotara, getJoFotaraConfig } = await import('../lib/jofotara/client');
  const joConfig = getJoFotaraConfig();
  assert(typeof joConfig.isSimulated === 'boolean', 'getJoFotaraConfig properly resolves simulated mode flag');

  // Test B2C Reporting Submission
  const b2cSub = await submitInvoiceToJoFotara({
    invoiceNumber: 'INV-TEST-B2C-001',
    invoiceType: 'B2C_SIMPLIFIED',
    ublXml: '<Invoice>Test UBL 2.1 B2C XML</Invoice>',
    invoiceUuid: 'uuid-test-b2c-1234',
    invoiceHash: 'hash-test-b2c-1234',
  });
  assert(b2cSub.success === true, 'B2C Reporting submission succeeds');
  assert(b2cSub.status === 'REPORTED', 'B2C invoice receives REPORTED status');
  assert(b2cSub.submissionId?.startsWith('istd-sim-') === true, 'B2C submission returns assigned ISTD submissionId');

  // Test B2B Clearance Submission
  const b2bSub = await submitInvoiceToJoFotara({
    invoiceNumber: 'INV-TEST-B2B-001',
    invoiceType: 'B2B_STANDARD',
    ublXml: '<Invoice>Test UBL 2.1 B2B XML</Invoice>',
    invoiceUuid: 'uuid-test-b2b-5678',
    invoiceHash: 'hash-test-b2b-5678',
    buyerTaxId: '109283746',
  });
  assert(b2bSub.success === true, 'B2B Clearance submission succeeds');
  assert(b2bSub.status === 'CLEARED', 'B2B invoice receives CLEARED status');

  // Test AI Tool generate_jofotara_invoice with submission
  const aiInvoiceRes = await executeClinicTool('generate_jofotara_invoice', {
    patient_name: 'عمر التميمي',
    invoice_type: 'B2C_SIMPLIFIED',
    service_name: 'كشف واستشارة طبية',
    amount_jod: 25,
  });
  assert(aiInvoiceRes.success === true, 'generate_jofotara_invoice tool executes successfully');
  assert(aiInvoiceRes.istd_status === 'REPORTED', 'Tool registers REPORTED status for B2C invoice');
  assert(Boolean(aiInvoiceRes.istd_submission_id), 'Tool returns istd_submission_id');

  // 9. Dead-Letter Outbound Message Handling & Migration
  console.log('\n--- 9. Testing Dead-Letter Outbound Message Handling ---');
  const { logFailedOutboundMessage } = await import('../lib/db/supabase');
  const failedMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261002_failed_outbound_messages.sql');
  assert(fs.existsSync(failedMigrationPath), 'Migration file for failed_outbound_messages exists');
  const failedMigrationSql = fs.readFileSync(failedMigrationPath, 'utf-8');
  assert(failedMigrationSql.includes('failed_outbound_messages'), 'Migration creates failed_outbound_messages table');
  assert(failedMigrationSql.includes('clinic_isolation_failed_outbound'), 'Migration applies RLS policy for failed outbound messages');

  const deadLetterEntry = await logFailedOutboundMessage({
    recipientPhone: '+962799990000',
    messageText: 'تذكير بموعدك غداً الساعة 10:00 صباحاً',
    errorReason: 'Meta API HTTP 400: (#131047) Re-engagement message: 24h window closed',
  });
  assert(deadLetterEntry.id.startsWith('fail-'), 'Dead-letter log entry generated with unique ID');
  assert(deadLetterEntry.status === 'PENDING_HUMAN_REVIEW', 'Dead-letter log defaults to PENDING_HUMAN_REVIEW for receptionist');

  // 10. Deduplication Table TTL Cleanup
  console.log('\n--- 10. Testing Deduplication Table TTL Cleanup ---');
  const { cleanupOldProcessedMessages, tenantStore } = await import('../lib/db/supabase');
  
  // Inject an expired message (50 hours old) and a recent message (now)
  const expiredMsgId = `wamid.expired_${Date.now()}`;
  const recentMsgId = `wamid.recent_${Date.now()}`;
  tenantStore.processed_messages.push({
    message_id: expiredMsgId,
    processed_at: new Date(Date.now() - 50 * 3600 * 1000).toISOString(),
  });
  tenantStore.processed_messages.push({
    message_id: recentMsgId,
    processed_at: new Date().toISOString(),
  });

  const cleanupRes = await cleanupOldProcessedMessages(48);
  assert(cleanupRes.deletedCount >= 1, 'cleanupOldProcessedMessages deletes at least 1 expired record');
  assert(!tenantStore.processed_messages.some(m => m.message_id === expiredMsgId), 'Expired message removed from store');
  assert(tenantStore.processed_messages.some(m => m.message_id === recentMsgId), 'Recent message retained in store');

  // Test cron_batch executes cleanup
  const cronBatchCleanupReq = new NextRequest('https://api.nashmiops.jo/api/jobs?action=cron_batch', {
    headers: {
      host: 'api.nashmiops.jo',
      authorization: `Bearer ${cronSecret}`,
    },
  });
  const cronBatchCleanupRes = await jobsGetHandler(cronBatchCleanupReq);
  const cronBatchCleanupJson = await cronBatchCleanupRes.json();
  assert(cronBatchCleanupJson.results?.cleanup !== undefined, 'cron_batch includes cleanup output in results');

  // 11. Multi-Practitioner & Multi-Chair Roster
  console.log('\n--- 11. Testing Multi-Practitioner & Multi-Chair Roster ---');
  const { getPractitioners, getDentalChairs } = await import('../lib/db/supabase');
  const doctors = await getPractitioners();
  assert(doctors.length >= 3, 'Roster has at least 3 active practitioners');
  assert(doctors.some(d => d.name_ar.includes('قاسم')), 'Dr. Qasim Nashmi present in practitioners');
  assert(doctors.some(d => d.name_ar.includes('ديما')), 'Dr. Dima Tamimi present in practitioners');

  const chairs = await getDentalChairs();
  assert(chairs.length >= 3, 'Clinic has at least 3 dental chairs');

  // Multi-Doctor Concurrency Test:
  // Ensure idempotent state by resetting any test appointments from prior test runs on 2026-10-11
  tenantStore.appointments = tenantStore.appointments.filter(
    (a) => !a.start_time.startsWith('2026-10-11')
  );

  // Book Dr. Qasim for Sunday 2026-10-11 at 10:00
  const docBooking1 = await bookFrictionlessAppointment({
    phone: '+962791110001',
    patientName: 'مريض د. قاسم',
    serviceType: 'consultation',
    dateStr: '2026-10-11',
    timeStr: '10:00',
    practitionerId: 'doc-qasim-001',
    practitionerName: 'د. قاسم نشمي',
  });
  assert(docBooking1.success === true, 'Booking with Dr. Qasim succeeds');
  assert(docBooking1.appointment?.practitioner_name?.includes('قاسم') === true, 'Appointment records Dr. Qasim as practitioner');

  // Attempting another booking with Dr. Qasim at the exact same slot should conflict
  const docBookingConflict = await bookFrictionlessAppointment({
    phone: '+962791110002',
    patientName: 'مريض ثان مع د. قاسم',
    serviceType: 'consultation',
    dateStr: '2026-10-11',
    timeStr: '10:00',
    practitionerId: 'doc-qasim-001',
    practitionerName: 'د. قاسم نشمي',
  });
  assert(docBookingConflict.success === false, 'Duplicate booking with Dr. Qasim at same slot is rejected with conflict');

  // Booking with Dr. Dima at the exact same slot SHOULD SUCCEED (Multi-doctor concurrency)
  const docBooking2 = await bookFrictionlessAppointment({
    phone: '+962791110003',
    patientName: 'مريض دكتورة ديما',
    serviceType: 'orthodontics_check',
    dateStr: '2026-10-11',
    timeStr: '10:00',
    practitionerId: 'doc-dima-002',
    practitionerName: 'د. ديما التميمي',
  });
  assert(docBooking2.success === true, 'Simultaneous booking with Dr. Dima on Chair 2 succeeds');

  // 12. Clinical EHR & Dental Charting (Law No. 25 of 2018)
  console.log('\n--- 12. Testing Clinical EHR & Dental Charting Schema ---');
  const ehrMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261003_clinical_ehr_and_roster.sql');
  assert(fs.existsSync(ehrMigrationPath), 'Phase 2 EHR & Roster SQL migration file exists');
  const ehrSql = fs.readFileSync(ehrMigrationPath, 'utf-8');
  assert(ehrSql.includes('clinical_records'), 'Migration defines clinical_records table');
  assert(ehrSql.includes('odontogram'), 'Migration includes odontogram JSON column');
  assert(ehrSql.includes('informed_consent_signed'), 'Migration includes informed_consent_signed per Law No. 25');

  // Test AI Tool record_clinical_procedure
  const recordProcRes = await executeClinicTool('record_clinical_procedure', {
    patient_name: 'أحمد التميمي',
    chief_complaint: 'تسوس في الضرس العلوي الأيمن',
    diagnosis: 'تسوس سطح الإطباق (Occlusal Caries) بالضرس 16',
    treatment_rendered: 'حشوة كمبوزيت تجميلية',
    tooth_number: 16,
    tooth_status: 'FILLED',
  });
  assert(recordProcRes.success === true, 'record_clinical_procedure tool saves clinical record');
  assert(recordProcRes.ehr_id?.startsWith('ehr-') === true, 'Record generated with ehr ID');

  // Test AI Tool query_patient_medical_history
  const ehrHistoryRes = await executeClinicTool('query_patient_medical_history', {
    patient_name: 'أحمد التميمي',
    patient_phone: '+962791234567',
  });
  assert(ehrHistoryRes.success === true, 'query_patient_medical_history tool succeeds');
  assert(ehrHistoryRes.found === true, 'Existing patient clinical history is retrieved');
  assert(ehrHistoryRes.records?.length >= 1, 'Patient has at least 1 recorded clinical entry');

  // 13. Real-Time APM & Error Tracking
  console.log('\n--- 13. Testing Real-Time APM & Error Tracking ---');
  const { captureException, captureMessage, getRecentAPMEvents } = await import('../lib/monitoring/apm');
  const apmMsg = captureMessage('Test operational diagnostic warning', 'WARNING', { route: '/tests' });
  assert(apmMsg.id.startsWith('apm-'), 'captureMessage creates APM event with unique ID');
  assert(apmMsg.severity === 'WARNING', 'captureMessage records correct severity');

  const testErr = new Error('Test unhandled runtime exception for APM verification');
  const apmErr = captureException(testErr, { route: '/api/test', patientPhone: '+962790000000' });
  assert(apmErr.severity === 'ERROR', 'captureException sets ERROR severity');
  assert(apmErr.message.includes('Test unhandled runtime exception'), 'captureException captures error message');

  const recentEvents = getRecentAPMEvents(10);
  assert(recentEvents.length >= 2, 'getRecentAPMEvents returns recorded APM events');
  assert(recentEvents.some(e => e.id === apmErr.id), 'Recent events buffer contains captured exception');

  console.log('\n===============================================================');
  console.log(`🎉 ALL ENTERPRISE TESTS PASSED! (${passed}/${total})`);
  console.log('===============================================================');
}

runEnterpriseTests().catch((e) => {
  console.error('Enterprise test suite failed:', e);
  process.exit(1);
});
