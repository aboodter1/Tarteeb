// Verification Script: Architectural Refactoring of NashmiOps
// Tests all 5 Pillars: Security, Unified Engine, Fallback/Greetings, Supabase SSOT, Data Validation

import fs from 'fs';
import path from 'path';
import { runReactAgent, isGreetingMessage, processConversationalMessage } from '../lib/ai/react-agent';
import { validateJordanianPhone, executeClinicTool } from '../lib/ai/clinic-tools';
import { checkSlotAvailability } from '../lib/calendar/scheduler';
import { createAppointment, getAllAppointments, tenantStore } from '../lib/db/supabase';
import { CLINIC_CONFIG } from '../lib/config/constants';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 VERIFYING ARCHITECTURAL REFACTORING: 5 PILLARS');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string, detail?: any) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${desc}`, detail || '');
      process.exitCode = 1;
    }
  }

  // -------------------------------------------------------------
  // PILLAR 1: Security & Secrets Isolation
  // -------------------------------------------------------------
  console.log('--- Pillar 1: Security & Secrets Isolation ---');
  const filesToScan = [
    'lib/ai/gemini-mvp.ts',
    'lib/ai/react-agent.ts',
    'lib/db/supabase.ts',
    'lib/db/supabase-browser.ts',
  ];

  for (const relPath of filesToScan) {
    const fullPath = path.join(process.cwd(), relPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const hasHardcodedGemini = content.includes('AQ.Ab8RN6LZVuHF6vLqPnL5S2Lx');
    const hasHardcodedSupabaseKey = content.includes('sb_publishable_U0n-84iuyCwmqhe5tBSM1w');
    const hasHardcodedSupabaseUrl = content.includes('damyfubyjdrrrgggncja.supabase.co');

    assert(!hasHardcodedGemini, `No hardcoded Gemini API key in ${relPath}`);
    assert(!hasHardcodedSupabaseKey, `No hardcoded Supabase Key in ${relPath}`);
    assert(!hasHardcodedSupabaseUrl, `No hardcoded Supabase URL in ${relPath}`);
  }

  // -------------------------------------------------------------
  // PILLAR 2 & 3: Unified Engine & Natural Greetings (No False Apologies)
  // -------------------------------------------------------------
  console.log('\n--- Pillar 2 & 3: Unified Engine & Natural Greetings Fast Path ---');
  assert(isGreetingMessage('السلام عليكم'), 'isGreetingMessage detects "السلام عليكم"');
  assert(isGreetingMessage('صباح الخير يا نشمي'), 'isGreetingMessage detects "صباح الخير"');
  assert(!isGreetingMessage('بدي احجز موعد كشفية'), 'isGreetingMessage rejects appointment request');

  const greetingRes = await runReactAgent({
    phoneNumber: '+962799990001',
    userMessage: 'السلام عليكم ورحمة الله',
  });

  assert(
    greetingRes.replyText.includes('وعليكم السلام') || greetingRes.replyText.includes('يا هلا'),
    'Greeting receives authentic welcoming receptionist greeting',
    greetingRes.replyText
  );
  assert(
    !greetingRes.replyText.includes('خطأ بسيط') && !greetingRes.replyText.includes('عذراً'),
    'Greeting NEVER triggers a system apology message'
  );

  // -------------------------------------------------------------
  // PILLAR 2: Strict Patient Name Guard via Unified ReAct Agent
  // -------------------------------------------------------------
  console.log('\n--- Pillar 2: Strict Patient Name Guard in ReAct Engine ---');
  const noNameRes = await runReactAgent({
    phoneNumber: '+962799990002',
    userMessage: 'بناسبني موعد بكرا الساعة 11:30 الصبح',
  });

  assert(
    noNameRes.toolCallsExecuted.length === 0,
    'No booking tool executed when name is missing'
  );
  assert(
    noNameRes.replyText.includes('اسمك الكريم'),
    'Strictly asks for patient name when time provided without name',
    noNameRes.replyText
  );

  // -------------------------------------------------------------
  // PILLAR 4: Supabase as Single Source of Truth
  // -------------------------------------------------------------
  console.log('\n--- Pillar 4: Supabase Slot Availability & Persistence ---');
  const daysAhead = 10 + Math.floor(Math.random() * 300);
  const testSlotStart = new Date(Date.now() + 86400000 * daysAhead);
  if (testSlotStart.getDay() === 5) {
    testSlotStart.setDate(testSlotStart.getDate() + 1);
  }
  testSlotStart.setHours(10, 0, 0, 0);
  const testSlotEnd = new Date(testSlotStart.getTime() + 60 * 60000); // 45m + 15m sterilization

  const slotCheck = await checkSlotAvailability(CLINIC_CONFIG.id, testSlotStart, testSlotEnd);
  assert(slotCheck.available === true, 'Future unoccupied slot confirmed available via Supabase check');

  const directAppt = await createAppointment({
    clinicId: CLINIC_CONFIG.id,
    patientId: 'pat-ssot-001',
    patientName: 'عصام العبداللات',
    patientPhone: '+962795551122',
    serviceType: 'consultation',
    startTime: testSlotStart.toISOString(),
    endTime: new Date(testSlotStart.getTime() + 45 * 60000).toISOString(),
    sterilizationEndTime: testSlotEnd.toISOString(),
    notes: 'اختبار فحص مصدر الحقيقة الموحد',
  });

  assert(Boolean(directAppt && directAppt.id), 'Appointment created directly with ID');
  assert(directAppt.status === 'CONFIRMED', 'Status is CONFIRMED');
  assert(directAppt.appointment_date === testSlotStart.toISOString().split('T')[0], 'appointment_date recorded');

  // Verify slot availability check now detects conflict on this slot
  const slotConflictCheck = await checkSlotAvailability(CLINIC_CONFIG.id, testSlotStart, testSlotEnd, {
    practitionerId: directAppt.practitioner_id,
  });
  assert(
    slotConflictCheck.available === false,
    'Slot availability correctly detects conflict with occupied slot (including 15m sterilization buffer)'
  );

  // -------------------------------------------------------------
  // PILLAR 5: Data Validation (Jordanian Phone & Multi-Person Slots)
  // -------------------------------------------------------------
  console.log('\n--- Pillar 5: Data Validation (Phones & Multi-Person Pre-check) ---');
  const validZain = validateJordanianPhone('0795551234');
  assert(validZain.isValid && validZain.normalizedPhone === '+962795551234', 'Validates Zain Jordan number (079)');

  const validOrange = validateJordanianPhone('+962771234567');
  assert(validOrange.isValid && validOrange.normalizedPhone === '+962771234567', 'Validates Orange Jordan number (+96277)');

  const validUmniah = validateJordanianPhone('0788889900');
  assert(validUmniah.isValid && validUmniah.normalizedPhone === '+962788889900', 'Validates Umniah Jordan number (078)');

  const invalidPhone = validateJordanianPhone('123456', false);
  assert(!invalidPhone.isValid, 'Rejects invalid phone numbers with helpful message');

  // Test multi-person booking pre-check:
  const testPhoneMulti = '+962797771122';
  const targetDateStr = testSlotStart.toISOString().split('T')[0];
  // Ensure test phone and test slot date are clean of prior test runs
  tenantStore.appointments = tenantStore.appointments.filter(
    (a) => a.patient_phone !== testPhoneMulti && a.appointment_date !== targetDateStr
  );

  const multiBooking = await executeClinicTool('create_appointment', {
    patients: ['هيثم المناصير', 'زيد المناصير'],
    date_str: targetDateStr,
    time_str: '14:00', // 2:00 PM (free slot)
    patient_phone: testPhoneMulti,
  }, testPhoneMulti);

  assert(
    multiBooking.success === true && multiBooking.total_patients === 2,
    'Multi-person booking pre-validates consecutive slots and schedules both patients',
    multiBooking
  );

  console.log(`\n================================================================`);
  console.log(`🏁 REFACTORING VERIFICATION SUMMARY: ${passed} / ${total} ASSERTIONS PASSED`);
  console.log(`================================================================\n`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
