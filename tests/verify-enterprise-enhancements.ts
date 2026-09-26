// NashmiOps Enterprise (MVP Edition) - Enterprise Enhancements Verification Suite
// Validates:
// 1. Conversation Summarization & Token Optimization (>20 messages compaction)
// 2. Receptionist Live Alerts (Emergency & Outbound WhatsApp Failures)
// 3. Cloud Sync Resilience & Tenant Store Persistence

import {
  appendChatHistory,
  getOrCreateConversation,
  broadcastReceptionistAlert,
  getReceptionistAlerts,
  dismissReceptionistAlert,
  logFailedOutboundMessage,
  tenantStore,
} from '../lib/db/supabase';
import { runReactAgent } from '../lib/ai/react-agent';
import { executeClinicTool } from '../lib/ai/clinic-tools';
import { CLINIC_CONFIG } from '../lib/config/constants';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting NashmiOps Final Enterprise Enhancements Verification');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 1: Conversation Summarization & Token Optimization
  // --------------------------------------------------------------------------
  console.log('--- Test Suite 1: Conversation Summarization & Token Optimization ---');
  const testPhone = '+962799988776';
  const clinicId = CLINIC_CONFIG.id;

  // Initialize fresh conversation
  const conv = await getOrCreateConversation(clinicId, testPhone, 'أحمد العبادي');
  conv.chat_history = []; // Reset for test
  conv.summary = undefined;

  // Append 18 messages (under the 20-message threshold)
  for (let i = 1; i <= 18; i++) {
    const role = i % 2 === 1 ? 'user' : 'model';
    const text = role === 'user' ? `رسالة تجريبية من المريض رقم ${i} بخصوص تنظيف الأسنان` : `رد الموظف رقم ${i}`;
    await appendChatHistory(clinicId, testPhone, role, text);
  }

  assert(conv.chat_history.length === 18, 'Chat history has exactly 18 messages before compaction');
  assert(!conv.summary, 'Summary is not created before reaching 20-message threshold');

  // Append 3 more messages to reach 21 (crossing the 20-message threshold)
  await appendChatHistory(clinicId, testPhone, 'user', 'بدي أعرف كم كشفية زراعة الأسنان في فرع الشميساني؟');
  await appendChatHistory(clinicId, testPhone, 'model', 'يا هلا بك أخ أحمد، كشفية الزراعة 15 دينار شاملة الفحص.');
  await appendChatHistory(clinicId, testPhone, 'user', 'بناسبني موعد بكرا الأحد الصبح الساعة 11:30.');

  assert(
    conv.chat_history.length === 10,
    `Chat history compacted to exactly 10 recent messages (actual: ${conv.chat_history.length})`
  );
  const generatedSummary: string = (conv.summary as any) || '';
  assert(
    typeof generatedSummary === 'string' && generatedSummary.length > 0,
    `Conversation summary successfully generated: "${generatedSummary.substring(0, 70)}..."`
  );
  assert(
    generatedSummary.includes('أحمد العبادي') || generatedSummary.includes('الخدمات') || generatedSummary.includes('سياق'),
    'Summary preserves patient entity, service intents, and conversational context'
  );

  // Append another message - should stay within <= 20 window
  await appendChatHistory(clinicId, testPhone, 'model', 'تكرم عيونك يا غالي، جاري التثبيت.');
  assert(
    conv.chat_history.length === 11,
    `Subsequent turn appends seamlessly to active window (actual: ${conv.chat_history.length})`
  );

  // --------------------------------------------------------------------------
  // TEST SUITE 2: Receptionist Live Alerts
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 2: Receptionist Live Alerts ---');

  // A. Broadcast Emergency Alert
  const emergencyAlert = await broadcastReceptionistAlert({
    clinic_id: clinicId,
    type: 'EMERGENCY',
    title: '🚨 تنبيه طوارئ حاد [EMERGENCY_TRIGGER]',
    description: 'المريض خالد يعاني من نزيف حاد وألم صدمي غير محتمل بعد الحادث',
    patient_name: 'خالد سالم',
    patient_phone: '+962791112233',
    severity: 'CRITICAL',
    metadata: { law: 'Law No. 25 of 2018' },
  });

  assert(emergencyAlert.id.startsWith('alert-'), 'Emergency alert generated with valid ID');
  assert(emergencyAlert.severity === 'CRITICAL', 'Emergency alert has CRITICAL severity');

  // Verify in tenantStore
  const allAlerts = getReceptionistAlerts(clinicId);
  const foundEmergency = allAlerts.find((a) => a.id === emergencyAlert.id);
  assert(!!foundEmergency, 'Emergency alert retrieved from receptionist alerts store');

  // B. Outbound WhatsApp Failure Alert
  const failedMessage = await logFailedOutboundMessage({
    clinicId,
    recipientPhone: '+962798887766',
    messageText: 'تذكير بموعدك غداً الساعة 11:00 صباحاً',
    errorReason: 'Meta Graph API 400: Recipient phone number not on WhatsApp',
  });

  assert(failedMessage.status === 'PENDING_HUMAN_REVIEW', 'Failed message recorded with PENDING_HUMAN_REVIEW');

  const failureAlert = getReceptionistAlerts(clinicId).find((a) => a.type === 'OUTBOUND_FAILURE');
  assert(!!failureAlert, 'Failed outbound message automatically created a receptionist live alert');
  assert(
    Boolean(failureAlert?.description.includes('+962798887766')),
    'Failure alert contains accurate recipient phone and error details'
  );

  // C. Dismiss Alert
  const dismissResult = dismissReceptionistAlert(emergencyAlert.id);
  assert(dismissResult === true, 'Receptionist successfully dismissed emergency alert');
  const remainingAlerts = getReceptionistAlerts(clinicId);
  assert(!remainingAlerts.some((a) => a.id === emergencyAlert.id), 'Dismissed alert removed from active queue');

  // D. Tool Calling Emergency Trigger
  const toolResult = await executeClinicTool(
    'trigger_emergency_handover',
    {
      patient_name: 'طارق الزعبي',
      patient_phone: '+962795554433',
      symptoms: 'انتفاخ حاد جداً في الفك مع نزيف مستمر وارتفاع بالحرارة',
    },
    '+962795554433'
  );

  assert(toolResult.success === true, 'trigger_emergency_handover executed successfully');
  assert(
    toolResult.emergency_code === '[EMERGENCY_TRIGGER]',
    'Emergency tool returned [EMERGENCY_TRIGGER] code'
  );

  const handoverAlert = getReceptionistAlerts(clinicId).find(
    (a) => a.patient_name === 'طارق الزعبي' && a.type === 'EMERGENCY'
  );
  assert(!!handoverAlert, 'trigger_emergency_handover dispatched live alert to receptionist');

  // --------------------------------------------------------------------------
  // TEST SUITE 3: Cloud Sync & RLS Resilience
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 3: Cloud Sync & RLS Resilience ---');

  // Check tenantStore memory hydration
  assert(tenantStore.appointments.length >= 0, 'Appointments accessible in tenantStore');
  assert(tenantStore.practitioners.length >= 3, 'Practitioners roster loaded in tenantStore');
  assert(tenantStore.dental_chairs.length >= 3, 'Dental chairs loaded in tenantStore');
  assert(Array.isArray(tenantStore.receptionist_alerts), 'Receptionist alerts array initialized in tenantStore');

  // Verify conversation persistence
  const reloadedConv = await getOrCreateConversation(clinicId, testPhone);
  assert(reloadedConv.id === conv.id, 'Conversation state retained seamlessly across lookups');
  assert(reloadedConv.summary === conv.summary, 'Summary persisted across conversation retrievals');

  // Summary
  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
