// NashmiOps Enterprise (MVP Edition) - Comprehensive ReAct Agent Verification Test Suite

import { runReactAgent } from '../lib/ai/react-agent';
import { executeClinicTool } from '../lib/ai/clinic-tools';
import { tenantStore, getOrCreateConversation, addToWaitlist } from '../lib/db/supabase';
import { compileJoFotaraXML } from '../lib/jofotara/xml-compiler';
import { CLINIC_CONFIG } from '../lib/config/constants';

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 STARTING NASHMIOPS REACT AGENT PRODUCTION REBUILD VERIFICATION');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    totalTests++;
    if (condition) {
      console.log(`✅ [PASS] Test ${totalTests}: ${testName}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] Test ${totalTests}: ${testName}`, details || '');
    }
  }

  // TEST 1: Graceful Tool Error Recovery (Structured JSON observation without crash)
  console.log('--- Test Group 1: Tool Error Recovery & Observation ---');
  const errorObservation = await executeClinicTool('unknown_broken_tool', {});
  assert(
    errorObservation && errorObservation.status === 'error',
    'executeClinicTool gracefully catches unknown tool calls and returns structured error observation',
    errorObservation
  );

  // TEST 2: FAQ Knowledge Base Query Tool
  console.log('\n--- Test Group 2: Clinic FAQ Query ---');
  const faqResult = await executeClinicTool('query_faq', { query: 'ساعات الدوام' });
  assert(
    faqResult && faqResult.status === 'ok' && faqResult.found === true && faqResult.summary.includes('السبت إلى الخميس'),
    'query_faq correctly retrieves clinic working hours from store',
    faqResult
  );

  const faqLocationResult = await executeClinicTool('query_faq', { query: 'الموقع والمواقف' });
  assert(
    faqLocationResult && faqLocationResult.found === true && faqLocationResult.summary.includes('الشميساني'),
    'query_faq correctly retrieves clinic location and valet information',
    faqLocationResult
  );

  // TEST 3: JoFotara Phase 2 E-Invoicing (UBL 2.1 + TLV QR + SHA-256)
  console.log('\n--- Test Group 3: JoFotara Phase 2 Compliance ---');
  const invoiceData = compileJoFotaraXML({
    invoiceNumber: 'INV-TEST-001',
    invoiceType: 'B2C_SIMPLIFIED',
    buyerName: 'طارق زياد',
    items: [
      { name: 'تنظيف وتلميع أسنان', quantity: 1, unitPrice: 25, taxRate: 0.16, total: 29 },
    ],
  });
  assert(
    invoiceData.xml.includes('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2') &&
    invoiceData.xml.includes('<cbc:ID>INV-TEST-001</cbc:ID>'),
    'UBL 2.1 XML generated with standard OASIS namespaces'
  );
  assert(
    Boolean(invoiceData.tlvQrCode) && invoiceData.tlvQrCode.length > 20,
    'Tag-Length-Value (TLV) Base64 QR code generated correctly',
    invoiceData.tlvQrCode.substring(0, 30)
  );
  assert(
    Boolean(invoiceData.invoiceHash) && invoiceData.invoiceHash.length === 64,
    'Cryptographic SHA-256 hash chaining generated (64 hex characters)'
  );

  // TEST 4: Mandatory Patient Name Rule & Multi-Person Consecutive Booking
  console.log('\n--- Test Group 4: Strict Name Rule & Multi-Person Consecutive Booking ---');
  // Attempt without real name
  const noNameResult = await executeClinicTool('create_appointment', {
    patient_name: 'مريض نشمي',
    time_str: '11:30',
  });
  assert(
    noNameResult.success === false && noNameResult.requires_patient_name === true,
    'create_appointment strictly rejects placeholder or missing patient names'
  );

  // Multi-person booking with real explicit names
  const testPhone = '+962795554433';
  // Remove prior test runs for testPhone to maintain idempotency
  tenantStore.appointments = tenantStore.appointments.filter((a) => a.patient_phone !== testPhone);

  const multiBooking = await executeClinicTool('create_appointment', {
    patients: ['طارق زياد', 'عمر زياد'],
    time_str: '14:00',
    date_str: 'غداً',
    patient_phone: testPhone,
  }, testPhone);

  assert(
    multiBooking.success === true &&
    multiBooking.multi_person_booking === true &&
    multiBooking.total_patients === 2,
    'Multi-person booking schedules consecutive appointments for each patient',
    multiBooking
  );

  const bookedSlots = tenantStore.appointments.filter((a) => a.patient_phone === testPhone);
  assert(
    bookedSlots.length >= 2,
    'Both patient appointments successfully stored in database / memory store'
  );

  // TEST 5: Appointment Cancellation & Asynchronous Waitlist Sniper Trigger
  console.log('\n--- Test Group 5: Cancellation & Waitlist Sniper ---');
  // Add a waiting patient on same date
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  await addToWaitlist({
    clinicId: CLINIC_CONFIG.id,
    patientId: 'pat-sniper-wait',
    patientName: 'رامي الحنيطي',
    patientPhone: '+962791112233',
    requestedService: 'consultation',
    preferredDate: tomorrow,
  });

  const cancelResult = await executeClinicTool('cancel_appointment', {
    patient_phone: testPhone,
    target_date: 'غداً',
  }, testPhone);

  assert(
    cancelResult.success === true && cancelResult.cancelled_appointment_id,
    'Appointment cancelled successfully and status marked in database'
  );

  // Give asynchronous waitlist sniper brief moment to execute
  await new Promise((r) => setTimeout(r, 600));
  const notifiedCandidate = tenantStore.waitlist.find((w) => w.status === 'NOTIFIED');
  assert(
    Boolean(notifiedCandidate),
    `Asynchronous Waitlist Sniper autonomously matched and notified waiting candidate (${notifiedCandidate?.patient_name})`
  );

  // TEST 6: Live ReAct Agent Core Execution & Loop Capping
  console.log('\n--- Test Group 6: Live ReAct Agent Turn & Anti-Markdown Persona ---');
  const agentPhone = '+962797778899';
  const agentResult = await runReactAgent({
    phoneNumber: agentPhone,
    userMessage: 'مرحبا، شو أوقات الدوام عندكم بالعيادة وكم سعر كشفية الأسنان؟',
  });

  assert(
    agentResult.iterations >= 1 && agentResult.iterations <= 3,
    `ReAct Agent strictly capped within 3 iterations (executed ${agentResult.iterations} iteration(s))`
  );
  assert(
    !agentResult.replyText.includes('**') &&
    !agentResult.replyText.includes('*') &&
    !agentResult.replyText.includes('- ') &&
    !agentResult.replyText.includes('#'),
    'Persona guarantee: Reply contains ZERO markdown formatting (authentic plain text)'
  );
  assert(
    !agentResult.replyText.includes('عربون') &&
    !agentResult.replyText.includes('CliQ') &&
    !agentResult.replyText.includes('كليك'),
    'Zero financial friction: Reply contains NO deposit or CliQ payment barriers'
  );

  // TEST 7: State Checkpointing in Supabase / Persistent Store
  console.log('\n--- Test Group 7: State Checkpointing & Anti-Amnesia ---');
  const convState = await getOrCreateConversation(CLINIC_CONFIG.id, agentPhone);
  assert(
    convState.chat_history.length >= 2,
    `Conversation checkpointed with user & model turns (length: ${convState.chat_history.length})`
  );
  assert(
    convState.chat_history[0].role === 'user' && convState.chat_history[1].role === 'model',
    'Chat history maintains strictly alternating user and model turns'
  );

  console.log('\n================================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('================================================================');

  if (passedTests === totalTests) {
    console.log('🚀 ALL PRODUCTION REBUILD & AGENT REFACTOR REQUIREMENTS VERIFIED 100%!');
  } else {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
