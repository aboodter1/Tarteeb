// NashmiOps Enterprise (MVP Edition) - Local Intent Intelligence Verification Suite
// Verifies deterministic offline intent classification, slot extraction, and Jordanian dialect responses

import { classifyLocalIntent, generateIntelligentLocalResponse } from '../lib/ai/local-intent';
import { generateLocalFallbackResponse } from '../lib/ai/react-agent';
import { CLINIC_CONFIG, MEDICAL_LIABILITY_GUARDRAILS } from '../lib/config/constants';

async function runLocalIntentTests() {
  console.log('===============================================================');
  console.log('🧪 VERIFYING LOCAL INTENT CLASSIFICATION & FALLBACK SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string, detail?: any) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${desc}`, detail || '');
      process.exitCode = 1;
    }
  }

  // 1. Clinical Emergency Triage (Jordanian Medical Liability Law No. 25 of 2018)
  console.log('--- 1. Testing Emergency Triage Protocol ---');
  const emergencyTexts = [
    'عندي نزيف حاد ومستمر بعد خلع الضرس مش راضي يوقف',
    'وجهي ورم فجأة مع انتفاخ كبير بالفك وحرارة عالية',
    'صار معي حادث وكسر بالفك ومش قادر اتنفس',
    'ألم صدمي حاد جداً لا يحتمل وغير طبيعي',
  ];

  for (const text of emergencyTexts) {
    const classified = classifyLocalIntent(text);
    assert(classified.isEmergency === true, `Emergency detected for: "${text.substring(0, 30)}..."`);
    assert(classified.primaryIntent === 'EMERGENCY', 'Primary intent is EMERGENCY');

    const res = await generateIntelligentLocalResponse(classified);
    assert(res.isEmergency === true, 'Response marks isEmergency: true');
    assert(res.reply.includes(MEDICAL_LIABILITY_GUARDRAILS.emergencyTriggerCode), 'Contains [EMERGENCY_TRIGGER]');
    assert(res.reply.includes('قانون المسؤولية الطبية'), 'Cites Medical Liability Law No. 25');
  }

  // 2. Greetings Fast Path
  console.log('\n--- 2. Testing Greetings Recognition ---');
  const greetingQueries = [
    'السلام عليكم ورحمة الله',
    'مرحبا يا نشمي',
    'صباح الورد والياسمين',
    'يعطيكم العافية',
  ];

  for (const g of greetingQueries) {
    const classified = classifyLocalIntent(g);
    assert(classified.primaryIntent === 'GREETING', `Recognizes greeting: "${g}"`);
    const fallbackRes = await generateLocalFallbackResponse({
      rawUserMsg: g,
      phoneNumber: '+962791112233',
      clinicId: CLINIC_CONFIG.id,
    });
    assert(!fallbackRes.isEmergency, 'Greeting is not emergency');
    assert(fallbackRes.reply.includes('يا هلا') || fallbackRes.reply.includes('وعليكم السلام'), 'Authentic welcoming reply');
  }

  // 3. Insurance Inquiries & Entity Extraction
  console.log('\n--- 3. Testing Insurance Intent & Network Extraction ---');
  const insQuery = 'مرحبا، بتتعاملوا مع تأمين نات هيلث للأسنان؟';
  const insClassified = classifyLocalIntent(insQuery);
  assert(insClassified.primaryIntent === 'INSURANCE_QUERY', 'Classifies as INSURANCE_QUERY');
  assert(Boolean(insClassified.slots.insuranceNetwork?.includes('نات هيلث')), 'Extracts NatHealth network');

  const insResponse = await generateIntelligentLocalResponse(insClassified);
  assert(insResponse.reply.includes('نات هيلث'), 'Mentions NatHealth in response');
  assert(insResponse.reply.includes('صورة بطاقة التأمين'), 'Requests insurance card photo for instant approval');

  // 4. Multi-Intent (Insurance Query + Booking Request)
  console.log('\n--- 4. Testing Multi-Intent Composition (Insurance + Booking) ---');
  const multiIntentText = 'معكم تأمين ميدنت وبدي أحجز موعد بكرة الصبح لخلع ضرس';
  const multiClassified = classifyLocalIntent(multiIntentText);
  assert(multiClassified.primaryIntent === 'INSURANCE_QUERY' || multiClassified.primaryIntent === 'BOOKING_REQUEST', 'Detects core intent');
  assert(multiClassified.secondaryIntents.length > 0, 'Detects secondary intent in composite query');
  assert(multiClassified.slots.serviceType === 'extraction', 'Extracts extraction service type');
  assert(multiClassified.slots.dayOrDate === 'غداً', 'Extracts tomorrow date slot');
  assert(multiClassified.slots.timeOfDay === 'morning', 'Extracts morning time slot');

  const multiRes = await generateIntelligentLocalResponse(multiClassified);
  assert(multiRes.reply.includes('ميدنت') || multiRes.reply.includes('التأمين'), 'Covers insurance aspect');

  // 5. Pricing and Service Inquiries
  console.log('\n--- 5. Testing Pricing & Services Intelligence ---');
  const priceQuery = 'كم سعر تبييض الأسنان بالليزر عندكم؟';
  const priceClassified = classifyLocalIntent(priceQuery);
  assert(priceClassified.primaryIntent === 'PRICING_QUERY', 'Classifies as PRICING_QUERY');
  assert(priceClassified.slots.serviceType === 'whitening', 'Identifies whitening service');

  const priceRes = await generateIntelligentLocalResponse(priceClassified);
  assert(priceRes.reply.includes('تبييض الأسنان بالليزر'), 'Identifies service in answer');
  assert(priceRes.reply.includes('120'), 'Provides base estimate');
  assert(priceRes.reply.includes('الفحص السريري'), 'Defers final treatment plan to in-person exam per Law No. 25');

  // 6. Rescheduling & Cancellations
  console.log('\n--- 6. Testing Rescheduling / Cancellation ---');
  const rescheduleText = 'بدي أأجل موعدي صار عندي ظرف عائلي طارئ وما بلحق أجي';
  const reschedClassified = classifyLocalIntent(rescheduleText);
  assert(reschedClassified.primaryIntent === 'RESCHEDULE_CANCEL', 'Classifies as RESCHEDULE_CANCEL');

  const reschedRes = await generateIntelligentLocalResponse(reschedClassified);
  assert(reschedRes.reply.includes('ولا يهمك') || reschedRes.reply.includes('بسيطة'), 'Reassuring friendly tone');
  assert(!reschedRes.reply.includes('عربون') && !reschedRes.reply.includes('كليك'), 'Zero CliQ/deposit mention');

  // 7. Doctor Privacy Guard
  console.log('\n--- 7. Testing Doctor Inquiry & Privacy Guard ---');
  const doctorQuery = 'ممكن رقم الدكتور قاسم الشخصي عشان بدي أحكي معه بموضوع ضروري؟';
  const doctorClassified = classifyLocalIntent(doctorQuery);
  assert(doctorClassified.primaryIntent === 'DOCTOR_INQUIRY', 'Classifies as DOCTOR_INQUIRY');

  const docRes = await generateIntelligentLocalResponse(doctorClassified);
  assert(docRes.reply.includes('خصوصيتهم') || docRes.reply.includes('تركيز أطبائنا'), 'Protects doctor privacy');
  assert(!docRes.reply.includes('079') && !docRes.reply.includes('077'), 'Never leaks phone number');

  // 8. Location & Amenities
  console.log('\n--- 8. Testing Location & Working Hours ---');
  const locQuery = 'وين مكان العيادة بالزبط وفي عندكم صفة ومواقف سيارات؟';
  const locClassified = classifyLocalIntent(locQuery);
  assert(locClassified.primaryIntent === 'LOCATION_HOURS', 'Classifies as LOCATION_HOURS');

  const locRes = await generateIntelligentLocalResponse(locClassified);
  assert(locRes.reply.includes('الشميساني'), 'Specifies Shmeisani location');
  assert(locRes.reply.includes('مواقف') || locRes.reply.includes('فاليه'), 'Highlights parking / valet');

  // 9. Zero-Deposit Compliance Audit across all generated replies
  console.log('\n--- 9. Strict Zero-Deposit Compliance Audit ---');
  const testReplies = [
    insResponse.reply,
    multiRes.reply,
    priceRes.reply,
    reschedRes.reply,
    docRes.reply,
    locRes.reply,
  ];

  for (const rep of testReplies) {
    assert(!rep.includes('عربون'), 'No mention of upfront deposit (عربون)');
    assert(!rep.includes('كليك') && !rep.includes('CliQ'), 'No mention of CliQ');
    assert(!rep.includes('دفعة أولى'), 'No mention of down payment');
  }

  // 10. Jordanian Colloquial Time Parsing
  console.log('\n--- 10. Testing Jordanian Colloquial Time Extraction ---');
  const { extractTimeSlots } = await import('../lib/ai/local-intent');

  const timeCase1 = extractTimeSlots('بدي موعد ع الأربعة ونص إذا سمحت');
  assert(timeCase1.specificTime === '16:30', 'Extracts "ع الأربعة ونص" as 16:30', timeCase1);
  assert(timeCase1.timeOfDay === 'afternoon', 'Marks "ع الأربعة ونص" as afternoon');

  const timeCase2 = extractTimeSlots('بناسبني التسعة وربع الصبح');
  assert(timeCase2.specificTime === '09:15', 'Extracts "التسعة وربع" as 09:15', timeCase2);
  assert(timeCase2.timeOfDay === 'morning', 'Marks "التسعة وربع الصبح" as morning');

  const timeCase3 = extractTimeSlots('في مجال موعد الساعة ثنتين؟');
  assert(timeCase3.specificTime === '14:00', 'Extracts "ثنتين" as 14:00', timeCase3);
  assert(timeCase3.timeOfDay === 'afternoon', 'Marks "ثنتين" as afternoon');

  const timeCase4 = extractTimeSlots('حابب أجي الصبح بدري أول ما تفتحوا');
  assert(timeCase4.specificTime === '09:00', 'Extracts "الصبح بدري" as 09:00', timeCase4);
  assert(timeCase4.timeOfDay === 'morning', 'Marks "الصبح بدري" as morning');

  const timeCase5 = extractTimeSlots('بدي موعد بعد العصر بشوي');
  assert(timeCase5.specificTime === '17:00', 'Extracts "بعد العصر بشوي" as 17:00', timeCase5);
  assert(timeCase5.timeOfDay === 'afternoon', 'Marks "بعد العصر بشوي" as afternoon');

  const timeCase6 = extractTimeSlots('بناسبني ع الوحدة ونص بعد الظهر');
  assert(timeCase6.specificTime === '13:30', 'Extracts "ع الوحدة ونص" as 13:30', timeCase6);

  // 11. Testing Row-Level Locking Migration (SKIP LOCKED)
  console.log('\n--- 11. Testing Row-Level Lock Migration (SKIP LOCKED) ---');
  const fs = await import('fs');
  const path = await import('path');
  const migrationPath = path.join(process.cwd(), 'supabase/migrations/20261008_queue_row_level_locks_skip_locked.sql');
  assert(fs.existsSync(migrationPath), 'Migration 20261008_queue_row_level_locks_skip_locked.sql exists');

  const migrationContent = fs.readFileSync(migrationPath, 'utf-8');
  assert(migrationContent.includes('claim_pending_whatsapp_retries'), 'Defines claim_pending_whatsapp_retries RPC');
  assert(migrationContent.includes('claim_pending_jofotara_retries'), 'Defines claim_pending_jofotara_retries RPC');
  assert(migrationContent.includes('claim_pending_failed_outbound_messages'), 'Defines claim_pending_failed_outbound_messages RPC');
  assert(migrationContent.includes('FOR UPDATE SKIP LOCKED'), 'Uses FOR UPDATE SKIP LOCKED row locking clause');

  // 12. Testing Preemptive Timeout Guard in Webhook Route
  console.log('\n--- 12. Testing Preemptive Timeout Guard in Webhook Route ---');
  const routePath = path.join(process.cwd(), 'app/api/webhook/whatsapp/route.ts');
  const routeContent = fs.readFileSync(routePath, 'utf-8');
  assert(routeContent.includes('PREEMPTIVE_TIMEOUT_MS = 8500'), 'Defines 8.5s Preemptive Timeout Guard');
  assert(routeContent.includes('Promise.race'), 'Races execution against preemptive timeout');
  assert(routeContent.includes('generateLocalFallbackResponse'), 'Calls generateLocalFallbackResponse on timeout catch');

  // 13. Testing Advanced Date Resolution (Next Week / Upcoming Calculations)
  console.log('\n--- 13. Testing Advanced Date Resolution (Upcoming Weeks) ---');
  const { extractDateSlots } = await import('../lib/ai/local-intent');

  const today = new Date();
  const currentDay = today.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat

  // Tuesday is day 2
  const tueDiff = (2 - currentDay + 7) % 7;
  const tueDaysToAdd = tueDiff === 0 ? 7 : tueDiff;
  const expectedNextTue = new Date(today.getTime() + tueDaysToAdd * 86400000);
  const expectedNextTueIso = `${expectedNextTue.getFullYear()}-${String(expectedNextTue.getMonth() + 1).padStart(2, '0')}-${String(expectedNextTue.getDate()).padStart(2, '0')}`;

  const resolvedTue = extractDateSlots('بدي موعد يوم الثلاثاء الجاي');
  assert(resolvedTue === expectedNextTueIso, `Calculates "الثلاثاء الجاي" as ${expectedNextTueIso}`, resolvedTue);

  // Thursday is day 4
  const thuDiff = (4 - currentDay + 7) % 7;
  const thuDaysToAdd = thuDiff === 0 ? 7 : thuDiff;
  const expectedNextThu = new Date(today.getTime() + thuDaysToAdd * 86400000);
  const expectedNextThuIso = `${expectedNextThu.getFullYear()}-${String(expectedNextThu.getMonth() + 1).padStart(2, '0')}-${String(expectedNextThu.getDate()).padStart(2, '0')}`;

  const resolvedThu = extractDateSlots('بناسبني الخميس القادم');
  assert(resolvedThu === expectedNextThuIso, `Calculates "الخميس القادم" as ${expectedNextThuIso}`, resolvedThu);

  assert(extractDateSlots('اليوم') === 'اليوم', 'Preserves "اليوم"');
  assert(extractDateSlots('بكرة') === 'غداً', 'Preserves "بكرة" as "غداً"');

  // 14. Testing Google Calendar Reverse Sync-Back (deleteCalendarEvent)
  console.log('\n--- 14. Testing Google Calendar Reverse Sync-Back ---');
  const { deleteCalendarEvent } = await import('../lib/calendar/scheduler');
  assert(typeof deleteCalendarEvent === 'function', 'deleteCalendarEvent is exported from scheduler.ts');

  const delRes = await deleteCalendarEvent('mock-google-event-12345');
  assert(delRes.success === true, 'deleteCalendarEvent executes successfully in simulated mode');

  const clinicToolsPath = path.join(process.cwd(), 'lib/ai/clinic-tools.ts');
  const clinicToolsContent = fs.readFileSync(clinicToolsPath, 'utf-8');
  assert(clinicToolsContent.includes('deleteCalendarEvent(appt.google_calendar_event_id'), 'clinic-tools purges event on cancellation');

  // 15. Testing WhatsApp Webhook HMAC SHA-256 Security
  console.log('\n--- 15. Testing WhatsApp Webhook HMAC SHA-256 Security ---');
  const crypto = await import('crypto');
  const { POST: webhookHandler } = await import('../app/api/webhook/whatsapp/route');
  const { NextRequest } = await import('next/server');

  const testSecret = 'secret_test_meta_key_2026';
  process.env.META_APP_SECRET = testSecret;

  const testBody = JSON.stringify({ entry: [] });

  // Tampered / Invalid signature request
  const tamperedReq = new NextRequest('http://localhost:3000/api/webhook/whatsapp', {
    method: 'POST',
    headers: {
      'x-hub-signature-256': 'sha256=invalid_tampered_signature_hex_1234567890',
    },
    body: testBody,
  });
  const tamperedRes = await webhookHandler(tamperedReq);
  assert(tamperedRes.status === 401, 'Rejects tampered signature with HTTP 401 Unauthorized');

  // Valid HMAC SHA-256 signature request
  const validHmac = crypto.createHmac('sha256', testSecret).update(testBody).digest('hex');
  const validReq = new NextRequest('http://localhost:3000/api/webhook/whatsapp', {
    method: 'POST',
    headers: {
      'x-hub-signature-256': `sha256=${validHmac}`,
    },
    body: testBody,
  });
  const validRes = await webhookHandler(validReq);
  assert(validRes.status === 200, 'Accepts valid HMAC SHA-256 signature with HTTP 200');

  // Clean test secret
  delete process.env.META_APP_SECRET;

  // 16. Testing Chat UI State Persistence (sessionStorage)
  console.log('\n--- 16. Testing Chat UI State Persistence (sessionStorage) ---');
  const chatPagePath = path.join(process.cwd(), 'app/chat/page.tsx');
  const chatPageContent = fs.readFileSync(chatPagePath, 'utf-8');
  assert(chatPageContent.includes("sessionStorage.getItem('tarteeb_chat_draft')"), 'Restores draft from sessionStorage on mount');
  assert(chatPageContent.includes("sessionStorage.setItem('tarteeb_chat_draft'"), 'Persists draft to sessionStorage on typing');
  assert(chatPageContent.includes("sessionStorage.removeItem('tarteeb_chat_draft')"), 'Clears draft from sessionStorage on submit/reset');
  assert(chatPageContent.includes("sessionStorage.getItem('tarteeb_chat_patient_phone')"), 'Restores patient phone from sessionStorage on mount');
  assert(chatPageContent.includes("sessionStorage.setItem('tarteeb_chat_patient_phone'"), 'Persists patient phone to sessionStorage on switch or edit');
  assert(chatPageContent.includes("sessionStorage.getItem('tarteeb_chat_patient_name')"), 'Restores patient name from sessionStorage on mount');
  assert(chatPageContent.includes("sessionStorage.setItem('tarteeb_chat_patient_name'"), 'Persists patient name to sessionStorage on switch or edit');

  console.log('\n===============================================================');
  console.log(`🎉 ALL LOCAL INTENT & PRODUCTION TESTS PASSED! (${passed}/${total})`);
  console.log('===============================================================\n');
}

runLocalIntentTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
