// NashmiOps Enterprise (MVP Edition) - Comprehensive Production Features Verification Suite

import { sendWhatsAppTextMessage, fetchWhatsAppAudioMedia } from '../lib/whatsapp/client';
import { triggerWaitlistSniper } from '../lib/jobs/waitlist-sniper';
import { processSmartReminders } from '../lib/jobs/smart-reminders';
import { processNoShowRecovery } from '../lib/jobs/no-show-recovery';
import { createAppointment, tenantStore } from '../lib/db/supabase';
import { bookFrictionlessAppointment } from '../lib/calendar/scheduler';
import { verifyApiAuthorization } from '../lib/auth/api-guard';
import { NextRequest } from 'next/server';

async function runTests() {
  console.log('===============================================================');
  console.log('🚀 NASHMIOPS LIVE PRODUCTION FEATURES VERIFICATION SUITE');
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

  // TEST 1: Outbound Meta WhatsApp Client
  console.log('\n--- 1. Testing Outbound WhatsApp Client ---');
  const res1 = await sendWhatsAppTextMessage('+962791234567', 'مرحباً، هذه رسالة تجريبية من نشمي');
  assert(res1.success === true, 'sendWhatsAppTextMessage dispatches successfully (or simulates cleanly)');
  assert(res1.simulated === true || !!res1.messageId, 'sendWhatsAppTextMessage records simulated or real messageId');

  // TEST 2: Background Jobs WhatsApp Dispatch
  console.log('\n--- 2. Testing Background Jobs Outbound Dispatch ---');
  // Waitlist Sniper
  const mockCancelledAppt: any = {
    id: `appt-test-${Date.now()}`,
    clinic_id: 'amman-main-001',
    start_time: new Date(Date.now() + 86400000).toISOString(),
    service_type: 'consultation',
  };
  const sniperRes = await triggerWaitlistSniper(mockCancelledAppt);
  assert(sniperRes.triggered === true, 'triggerWaitlistSniper runs and attempts outbound dispatch');

  // Smart Reminders
  const remindersRes = await processSmartReminders();
  assert(Array.isArray(remindersRes.remindersSent), 'processSmartReminders runs and processes notifications');

  // No-Show Recovery
  const recoveryRes = await processNoShowRecovery();
  assert(typeof recoveryRes.processedCount === 'number', 'processNoShowRecovery runs and processes no-shows');

  // TEST 3: Race Conditions & Double-Booking Guard with 15-min Sterilization Buffer
  console.log('\n--- 3. Testing Race Conditions & Double-Booking Guard ---');
  // Use a unique future date to guarantee idempotency across multiple test runs
  const randomDayOffset = 100 + Math.floor(Math.random() * 500);
  let targetDate = new Date(Date.now() + randomDayOffset * 86400000);
  if (targetDate.getDay() === 5) {
    targetDate = new Date(targetDate.getTime() + 86400000); // Shift from Friday to Saturday
  }
  const testDateStr = targetDate.toISOString().split('T')[0];

  // Create initial appointment via bookFrictionlessAppointment
  const initialBooking = await bookFrictionlessAppointment({
    clinicId: 'amman-main-001',
    phone: '+962791111111',
    patientName: 'عمر التميمي',
    serviceType: 'consultation',
    dateStr: testDateStr,
    timeStr: '14:00',
  });
  assert(initialBooking.success === true, 'Initial appointment created successfully');

  // Attempt overlapping appointment inside the sterilization buffer via direct createAppointment
  const appt1Start = new Date(initialBooking.appointment!.start_time);
  const conflictStartTime = new Date(appt1Start.getTime() + 30 * 60000).toISOString(); // 30 mins in (overlaps)
  const conflictEndTime = new Date(appt1Start.getTime() + 75 * 60000).toISOString();

  let conflictCaught = false;
  try {
    await createAppointment({
      clinicId: 'amman-main-001',
      patientId: 'pat-test-2',
      patientName: 'سامر قاسم',
      patientPhone: '+962792222222',
      serviceType: 'consultation',
      startTime: conflictStartTime,
      endTime: conflictEndTime,
      sterilizationEndTime: new Date(new Date(conflictEndTime).getTime() + 15 * 60000).toISOString(),
    });
  } catch (err: any) {
    if (err?.code === 'DOUBLE_BOOKING_CONFLICT' || err?.message?.includes('DOUBLE_BOOKING_CONFLICT')) {
      conflictCaught = true;
    }
  }
  assert(conflictCaught === true, 'Direct createAppointment strictly blocks double-booking with DOUBLE_BOOKING_CONFLICT');

  // Attempt booking via scheduler on exact same slot
  const schedulerConflict = await bookFrictionlessAppointment({
    clinicId: 'amman-main-001',
    phone: '+962792222222',
    patientName: 'سامر قاسم',
    serviceType: 'consultation',
    dateStr: testDateStr,
    timeStr: '14:00',
  });
  assert(schedulerConflict.success === false, 'bookFrictionlessAppointment cleanly rejects conflict');
  assert(schedulerConflict.message.includes('تعارض') || schedulerConflict.message.includes('غير متوفر') || schedulerConflict.message.includes('محجوز'), 'bookFrictionlessAppointment returns friendly conflict message');

  // TEST 4: PDPL Law No. 24 of 2023 & API Guard
  console.log('\n--- 4. Testing API Route Protection & PDPL Guard ---');
  
  // Unauthorized request from external caller
  const unauthorizedReq = new NextRequest('https://api.nashmiops.jo/api/history?phone=+962791234567', {
    headers: {
      host: 'api.nashmiops.jo',
      origin: 'https://malicious-external-site.com',
    },
  });
  const unauthRes = verifyApiAuthorization(unauthorizedReq);
  assert(unauthRes.authorized === false, 'Unauthorized external request is rejected by PDPL guard');
  assert(unauthRes.response?.status === 401, 'PDPL guard returns HTTP 401 Unauthorized');

  // Authorized request with API_SECRET_KEY
  const authorizedApiKeyReq = new NextRequest('https://api.nashmiops.jo/api/jobs', {
    headers: {
      host: 'api.nashmiops.jo',
      'x-api-key': process.env.API_SECRET_KEY || 'tarteeb_secure_api_secret_key_2026',
    },
  });
  const authApiKeyRes = verifyApiAuthorization(authorizedApiKeyReq);
  assert(authApiKeyRes.authorized === true, 'Request with valid x-api-key is authorized');

  // Authorized request with Bearer CRON_SECRET
  const authorizedCronReq = new NextRequest('https://api.nashmiops.jo/api/jobs', {
    headers: {
      host: 'api.nashmiops.jo',
      authorization: `Bearer ${process.env.CRON_SECRET || 'tarteeb_cron_secret_token_2026'}`,
    },
  });
  const authCronRes = verifyApiAuthorization(authorizedCronReq);
  assert(authCronRes.authorized === true, 'Request with Bearer CRON_SECRET is authorized');

  // Local sandbox simulation bypass
  const sandboxSimReq = new NextRequest('http://localhost:3000/api/history?phone=+962791234567', {
    headers: {
      host: 'localhost:3000',
      'sec-fetch-site': 'same-origin',
    },
  });
  const sandboxRes = verifyApiAuthorization(sandboxSimReq);
  assert(sandboxRes.authorized === true, 'Local / Sandbox UI same-origin calls are permitted without friction');

  // TEST 5: WhatsApp Audio Media Fetching
  console.log('\n--- 5. Testing WhatsApp Audio Media Fetching ---');
  const audioFetchResult = await fetchWhatsAppAudioMedia('mock_audio_media_123');
  assert(audioFetchResult !== null && typeof audioFetchResult.base64 === 'string', 'fetchWhatsAppAudioMedia handles mock/real media IDs safely');

  console.log('\n===============================================================');
  console.log(`🎉 ALL TESTS PASSED! (${passed}/${total})`);
  console.log('===============================================================');
}

runTests().catch((e) => {
  console.error('Test suite failed:', e);
  process.exit(1);
});
