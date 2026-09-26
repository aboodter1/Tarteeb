// Verification script for the 3 master rules:
// 1. Mandatory Patient Name & Multi-Person Rule
// 2. Strict Tool-Calling Enforcement
// 3. Fallback & Timeout Handling

import { processConversationalMessage } from '../lib/ai/gemini-mvp';
import { tenantStore } from '../lib/db/supabase';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING MASTER VERIFICATION: 3 RULES');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  // Ensure test idempotency by clearing appointments for test phone numbers
  tenantStore.appointments = tenantStore.appointments.filter(
    (a) =>
      a.patient_phone !== '+962791112233' &&
      a.patient_phone !== '+962795556677' &&
      a.patient_phone !== '+962798889900'
  );

  // -------------------------------------------------------------
  // Test 1: Booking with Time ONLY (No Name provided)
  // Expected: Ask for name, NO tool call, NO appointment created
  // -------------------------------------------------------------
  total++;
  console.log('Test 1: Booking with Time ONLY (No Name)');
  const initialApptCount = tenantStore.appointments.length;
  const res1 = await processConversationalMessage({
    userMessage: 'بناسبني موعد بكرا الساعة 11:30 الصبح',
    patientPhone: '+962791112233',
    chatHistory: [],
  });

  const apptCountAfter1 = tenantStore.appointments.length;
  console.log('  Reply:', res1.replyText);
  console.log('  Tool Calls:', res1.toolCallsExecuted.length);
  console.log('  Appointments created:', apptCountAfter1 - initialApptCount);

  const bookingCalls1 = res1.toolCallsExecuted.filter(
    (c) => c.name === 'create_appointment' || c.name === 'book_appointment'
  );

  if (
    bookingCalls1.length === 0 &&
    apptCountAfter1 === initialApptCount &&
    (res1.replyText.includes('اسم') || res1.replyText.includes('الكريم')) &&
    !res1.replyText.includes('تم تثبيت')
  ) {
    console.log('  ✅ PASSED: Correctly asked for name without tool execution or DB insertion.\n');
    passed++;
  } else {
    console.error('  ❌ FAILED: Premature confirmation or tool executed without name!\n');
  }

  // -------------------------------------------------------------
  // Test 2: Multi-Person Booking with No Names ("إلي ولقريبي")
  // Expected: Ask for both names, NO tool call, NO appointment created
  // -------------------------------------------------------------
  total++;
  console.log('Test 2: Multi-Person Booking with No Names ("إلي ولقريبي 11:30")');
  const res2 = await processConversationalMessage({
    userMessage: 'بدي احجز موعد إلي ولقريبي بكرا الساعة 11:30',
    patientPhone: '+962791112233',
    chatHistory: [],
  });

  const apptCountAfter2 = tenantStore.appointments.length;
  console.log('  Reply:', res2.replyText);
  console.log('  Tool Calls:', res2.toolCallsExecuted.length);

  const bookingCalls2 = res2.toolCallsExecuted.filter(
    (c) => c.name === 'create_appointment' || c.name === 'book_appointment'
  );

  if (
    bookingCalls2.length === 0 &&
    apptCountAfter2 === initialApptCount &&
    res2.replyText.includes('اسم') &&
    (res2.replyText.includes('قريب') || res2.replyText.includes('المرافق') || res2.replyText.includes('أثبتلكم'))
  ) {
    console.log('  ✅ PASSED: Correctly requested explicit names for both persons.\n');
    passed++;
  } else {
    console.error('  ❌ FAILED: Did not enforce multi-person names!\n');
  }

  // -------------------------------------------------------------
  // Test 3: Multi-Person Booking WITH Explicit Real Names
  // Expected: Tool call executed, TWO consecutive appointments saved in database!
  // -------------------------------------------------------------
  total++;
  console.log('Test 3: Multi-Person Booking WITH Explicit Real Names ("أحمد وقريبي خالد")');
  const res3 = await processConversationalMessage({
    userMessage: 'أنا أحمد ومعي قريبي خالد وبدنا موعد بكرا الساعة 11:30',
    patientPhone: '+962795556677',
    chatHistory: [],
  });

  const apptCountAfter3 = tenantStore.appointments.length;
  console.log('  Reply:', res3.replyText);
  console.log('  Tool Calls:', res3.toolCallsExecuted.length);
  console.log('  New Appointments:', apptCountAfter3 - apptCountAfter2);

  const newAppts = tenantStore.appointments.slice(apptCountAfter2);
  console.log('  Saved in DB:', newAppts.map(a => `${a.patient_name} at ${a.start_time}`));

  if (
    res3.toolCallsExecuted.length > 0 &&
    newAppts.length === 2 &&
    newAppts.some(a => a.patient_name.includes('أحمد')) &&
    newAppts.some(a => a.patient_name.includes('خالد'))
  ) {
    console.log('  ✅ PASSED: Both distinct patients booked consecutively in database.\n');
    passed++;
  } else {
    console.error('  ❌ FAILED: Failed to create consecutive multi-person appointments!\n');
  }

  // -------------------------------------------------------------
  // Test 4: Single Booking with Explicit Real Name & Time (Strict Tool-Calling)
  // Expected: Tool executed IMMEDIATELY in same turn, appointment saved
  // -------------------------------------------------------------
  total++;
  console.log('Test 4: Strict Tool-Calling Enforcement ("أنا طارق وبناسبني 16:30")');
  const countBefore4 = tenantStore.appointments.length;
  const res4 = await processConversationalMessage({
    userMessage: 'أنا طارق وبناسبني موعد بكرا 16:30',
    patientPhone: '+962798889900',
    chatHistory: [],
  });

  const countAfter4 = tenantStore.appointments.length;
  console.log('  Reply:', res4.replyText);
  console.log('  Tool Calls:', res4.toolCallsExecuted.length);

  const tarekAppt = tenantStore.appointments.find(a => a.patient_name.includes('طارق'));

  if (
    res4.toolCallsExecuted.length > 0 &&
    countAfter4 === countBefore4 + 1 &&
    tarekAppt &&
    !res4.replyText.includes('عربون') &&
    !res4.replyText.includes('كليك') &&
    !res4.replyText.includes('ألف مبروك')
  ) {
    console.log('  ✅ PASSED: Tool executed immediately, written to database with clean confirmation.\n');
    passed++;
  } else {
    console.error('  ❌ FAILED: Tool was not executed or appointment not saved!\n');
  }

  console.log('================================================================');
  console.log(`SUMMARY: ${passed} / ${total} TESTS PASSED`);
  console.log('================================================================');

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
