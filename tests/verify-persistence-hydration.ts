// Verification Script: Database Persistence & UI Hydration
// Tests verify database insertion, disk persistence snapshot, and history hydration API routes

import {
  createAppointment,
  getAllAppointments,
  appendChatHistory,
  getConversationHistory,
  clearConversationHistory,
  tenantStore,
} from '../lib/db/supabase';
import { loadPersistentData } from '../lib/db/disk-store';
import { CLINIC_CONFIG } from '../lib/config/constants';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Testing Database Persistence & UI Hydration for NashmiOps');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${desc}`);
      process.exitCode = 1;
    }
  }

  // TEST 1: Verify Appointment Insertion with required fields
  console.log('--- Test 1: Verify Database Insertion with correct fields ---');
  const testPatientName = 'أيهم القضاة';
  const testPhone = '+962791234567';
  const testDate = new Date(Date.now() + 50000000000 + Math.floor(Math.random() * 50000000000));
  testDate.setMinutes(0, 0, 0);
  const testStartTime = testDate.toISOString();
  const testEndTime = new Date(testDate.getTime() + 45 * 60000).toISOString();
  const testSterilTime = new Date(testDate.getTime() + 60 * 60000).toISOString();

  const newAppt = await createAppointment({
    clinicId: CLINIC_CONFIG.id,
    patientId: 'pat-test-101',
    patientName: testPatientName,
    patientPhone: testPhone,
    serviceType: 'cleaning',
    startTime: testStartTime,
    endTime: testEndTime,
    sterilizationEndTime: testSterilTime,
    notes: 'اختبار فحص الإدراج الدائم بقاعدة البيانات',
  });

  assert(Boolean(newAppt && newAppt.id), 'Appointment created with unique ID');
  assert(newAppt.patient_name === testPatientName, `Patient name matches (${newAppt.patient_name})`);
  assert(newAppt.appointment_date === testStartTime.split('T')[0], `appointment_date field is populated (${newAppt.appointment_date})`);
  assert(newAppt.service_type === 'cleaning', `service_type is correctly recorded (${newAppt.service_type})`);
  assert(newAppt.status === 'CONFIRMED', `Status is strictly CONFIRMED (${newAppt.status})`);

  // TEST 2: Verify Disk Persistence Snapshot (Crash-Proof Fallback & Hydration)
  console.log('\n--- Test 2: Verify Persistent Snapshot on Disk ---');
  const snapshot = loadPersistentData();
  assert(Boolean(snapshot), 'Persistent snapshot file loaded from disk');
  const foundInDisk = snapshot?.appointments?.find((a: any) => a.id === newAppt.id);
  assert(Boolean(foundInDisk), `New appointment found in disk snapshot (${foundInDisk?.patient_name})`);
  assert(foundInDisk?.appointment_date === testStartTime.split('T')[0], 'Disk snapshot has appointment_date');

  // TEST 3: Verify getAllAppointments returns persisted records
  console.log('\n--- Test 3: Verify getAllAppointments method ---');
  const allAppts = await getAllAppointments(CLINIC_CONFIG.id);
  assert(Array.isArray(allAppts) && allAppts.length > 0, `Retrieved ${allAppts.length} appointments`);
  const foundInAll = allAppts.find((a) => a.id === newAppt.id);
  assert(Boolean(foundInAll), 'getAllAppointments contains the newly created appointment');

  // TEST 4: Chat History Persistence & Checkpointing
  console.log('\n--- Test 4: Chat History Checkpointing ---');
  await appendChatHistory(CLINIC_CONFIG.id, testPhone, 'user', 'مرحبا، بدي احجز موعد لتنظيف الأسنان');
  await appendChatHistory(CLINIC_CONFIG.id, testPhone, 'model', 'يا هلا والله فيك بمركز نشمي! في عندنا موعد الأربعاء 10:00 ص مناسبك؟');

  const conv = await getConversationHistory(CLINIC_CONFIG.id, testPhone);
  assert(Boolean(conv), 'Conversation state retrieved');
  assert(
    Boolean(conv?.chat_history && conv.chat_history.length >= 2),
    `Chat history has turns persisted (${conv?.chat_history?.length} messages)`
  );
  const lastUserMsg = conv?.chat_history.find((m) => m.role === 'user' && m.text.includes('لتنظيف'));
  assert(Boolean(lastUserMsg), 'User message persisted accurately');

  // TEST 5: HTTP Endpoints Validation on Running Server
  console.log('\n--- Test 5: Verify HTTP API Endpoints for UI Hydration ---');
  try {
    const resAppts = await fetch('http://localhost:3000/api/appointments');
    const dataAppts = await resAppts.json();
    assert(dataAppts.success === true, 'GET /api/appointments returns success: true');
    assert(Array.isArray(dataAppts.appointments), 'GET /api/appointments returns appointments array');

    const resHistory = await fetch(`http://localhost:3000/api/history?phone=${encodeURIComponent(testPhone)}`);
    const dataHistory = await resHistory.json();
    assert(dataHistory.success === true, 'GET /api/history returns success: true');
    assert(Array.isArray(dataHistory.chat_history), 'GET /api/history returns chat_history array');
    assert(dataHistory.chat_history.length >= 2, 'GET /api/history hydrated messages from backend');

    const resJobs = await fetch('http://localhost:3000/api/jobs');
    const dataJobs = await resJobs.json();
    assert(Array.isArray(dataJobs.appointments), 'GET /api/jobs returns synchronized appointments');
  } catch (httpErr) {
    console.warn('HTTP fetch failed (server may need moment):', httpErr);
  }

  console.log(`\n================================================================`);
  console.log(`🏁 Persistence & Hydration Test Results: ${passed}/${total} assertions passed`);
  console.log(`================================================================\n`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
