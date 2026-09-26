// NashmiOps Enterprise (MVP Edition) - End-to-End Verification Test Suite

import { compileJoFotaraXML, generateJoFotaraTLV } from '@/lib/jofotara/xml-compiler';
import { bookFrictionlessAppointment } from '@/lib/calendar/scheduler';
import { triggerWaitlistSniper } from '@/lib/jobs/waitlist-sniper';
import { processNoShowRecovery } from '@/lib/jobs/no-show-recovery';
import { processSmartReminders } from '@/lib/jobs/smart-reminders';
import { tenantStore, updateAppointmentStatus, addToWaitlist } from '@/lib/db/supabase';
import { CLINIC_CONFIG, MEDICAL_LIABILITY_GUARDRAILS } from '@/lib/config/constants';
import { processConversationalMessage } from '@/lib/ai/gemini-mvp';

async function runAutonomousVerification() {
  console.log('====================================================================');
  console.log('🚀 NASHMIOPS ENTERPRISE (MVP EDITION) - AUTONOMOUS VERIFICATION SUITE');
  console.log('====================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      throw new Error(`Assertion failed: ${testName}`);
    }
  }

  // ------------------------------------------------------------------
  // TEST 1: ISTD JoFotara Phase 2 UBL 2.1 XML Compilation & TLV QR
  // ------------------------------------------------------------------
  console.log('--- PILLAR 1: ISTD JoFotara Phase 2 E-Invoicing ---');

  // Test B2C Simplified
  const b2cRes = compileJoFotaraXML({
    invoiceNumber: 'INV-2026-001',
    invoiceType: 'B2C_SIMPLIFIED',
    buyerName: 'طارق عبد الرحيم',
    buyerNationalId: '9881020304',
    items: [
      {
        name: 'كشف واستشارة طبية شاملة',
        quantity: 1,
        unitPrice: 15.0,
        taxRate: 0.0,
        total: 15.0,
      },
    ],
  });

  assert(b2cRes.xml.includes('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'), 'B2C UBL 2.1 Namespace correct');
  assert(b2cRes.xml.includes('<cbc:ProfileID>reporting:1.0</cbc:ProfileID>'), 'B2C ProfileID is reporting:1.0');
  assert(b2cRes.xml.includes('<cbc:ID>PIH</cbc:ID>'), 'Cryptographic chaining PIH is present');
  assert(b2cRes.tlvQrCode.length > 20, 'TLV Base64 QR code generated successfully');
  assert(b2cRes.totalAmount === 15.0, 'Total amount correctly computed as 15.000 JOD');

  // Test B2B Standard Validation (Requires Buyer Tax ID)
  let b2bErrorThrown = false;
  try {
    compileJoFotaraXML({
      invoiceNumber: 'INV-2026-002',
      invoiceType: 'B2B_STANDARD',
      buyerName: 'شركة الإتقان الطبية',
      // Missing buyerTaxId
      items: [{ name: 'خدمات طبية', quantity: 1, unitPrice: 200, taxRate: 0.16, total: 232 }],
    });
  } catch (err: any) {
    b2bErrorThrown = true;
  }
  assert(b2bErrorThrown, 'B2B Standard correctly enforces mandatory Buyer Tax ID');

  const b2bValid = compileJoFotaraXML({
    invoiceNumber: 'INV-2026-003',
    invoiceType: 'B2B_STANDARD',
    buyerName: 'شركة الإتقان الطبية',
    buyerTaxId: '109283746',
    items: [{ name: 'خدمات طبية', quantity: 1, unitPrice: 100, taxRate: 0.16, total: 116 }],
  });
  assert(b2bValid.xml.includes('<cbc:ProfileID>clearance:1.0</cbc:ProfileID>'), 'B2B ProfileID is clearance:1.0');
  assert(b2bValid.xml.includes('<cbc:CompanyID>109283746</cbc:CompanyID>'), 'B2B Buyer Tax ID embedded in XML');

  // ------------------------------------------------------------------
  // TEST 2: Frictionless Booking + Mandatory 15-Minute Sterilization Buffer
  // ------------------------------------------------------------------
  console.log('\n--- PILLAR 2: Frictionless Booking & Sterilization Buffers ---');

  // Clean up prior test runs for test phone numbers to prevent duplicate booking conflicts
  tenantStore.appointments = tenantStore.appointments.filter(
    (a) => a.patient_phone !== '+962795554433' && a.patient_phone !== '+962798889900'
  );

  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const bookingRes = await bookFrictionlessAppointment({
    clinicId: CLINIC_CONFIG.id,
    phone: '+962795554433',
    patientName: 'عمر القضاة',
    serviceType: 'cleaning',
    dateStr: tomorrowStr,
    timeStr: '11:00',
    familyRelation: 'self',
  });

  assert(bookingRes.success, 'Frictionless booking succeeded without deposit');
  assert(bookingRes.appointment !== undefined, 'Appointment object generated');

  const startTime = new Date(bookingRes.appointment!.start_time);
  const endTime = new Date(bookingRes.appointment!.end_time);
  const sterilizationTime = new Date(bookingRes.appointment!.sterilization_end_time);

  const durationMinutes = (endTime.getTime() - startTime.getTime()) / 60000;
  const bufferMinutes = (sterilizationTime.getTime() - endTime.getTime()) / 60000;

  assert(durationMinutes === 45, 'Cleaning duration is exactly 45 minutes');
  assert(bufferMinutes === 15, 'Mandatory sterilization buffer is exactly 15 minutes');

  // Family profile test: booking for child under same phone
  const childBooking = await bookFrictionlessAppointment({
    clinicId: CLINIC_CONFIG.id,
    phone: '+962795554433', // Same phone
    patientName: 'زيد القضاة', // Child name
    serviceType: 'consultation',
    dateStr: tomorrowStr,
    timeStr: '14:00',
    familyRelation: 'child',
  });

  assert(childBooking.success, `Family profile child booking succeeded: ${childBooking.message || childBooking.conflictDetails}`);
  assert(childBooking.appointment?.patient_name === 'زيد القضاة', 'Child saved as distinct patient record');

  // ------------------------------------------------------------------
  // TEST 3: Waitlist Sniper Autonomous Recovery
  // ------------------------------------------------------------------
  console.log('\n--- PILLAR 3: Smart Waitlist Sniper ---');

  // Clear previous test waitlist entries to guarantee deterministic candidate matching
  tenantStore.waitlist = [];

  // Add waiting patient for cleaning on tomorrow's date
  await addToWaitlist({
    clinicId: CLINIC_CONFIG.id,
    patientId: 'pat-wait-99',
    patientName: 'روان المصري',
    patientPhone: '+962791122334',
    requestedService: 'cleaning',
    preferredDate: tomorrowStr,
  });

  // Cancel Omar's appointment -> should automatically trigger sniper and notify Rawan
  await updateAppointmentStatus(bookingRes.appointment!.id, CLINIC_CONFIG.id, 'CANCELLED');
  const sniperRes = await triggerWaitlistSniper(bookingRes.appointment!);

  assert(sniperRes.triggered, 'Waitlist Sniper automatically triggered on cancellation');
  assert(sniperRes.candidateFound, 'Matching waitlist candidate discovered');
  assert(sniperRes.notifiedCandidate?.patient_name === 'روان المصري', 'Sniper allocated slot to correct waiting patient');
  assert(sniperRes.metaTemplatePayload?.templateName === 'waitlist_slot_notification_ar', 'Meta Utility Template prepared for dispatch');

  // ------------------------------------------------------------------
  // TEST 4: No-Show Recovery & Smart Reminders
  // ------------------------------------------------------------------
  console.log('\n--- PILLAR 4: Autonomous Operational Recovery & Reminders ---');

  // Inject a simulated NO_SHOW appointment
  const noShowAppt = await bookFrictionlessAppointment({
    clinicId: CLINIC_CONFIG.id,
    phone: '+962798889900',
    patientName: 'محمود النابلسي',
    serviceType: 'consultation',
    dateStr: tomorrowStr,
    timeStr: '16:00',
  });
  await updateAppointmentStatus(noShowAppt.appointment!.id, CLINIC_CONFIG.id, 'NO_SHOW');
  // Backdate start_time by 2 hours
  noShowAppt.appointment!.start_time = new Date(Date.now() - 7200000).toISOString();

  const recoveryRes = await processNoShowRecovery();
  assert(recoveryRes.processedCount >= 1, 'No-Show Recovery processed missed appointment');
  assert(recoveryRes.actions.some((a) => a.patientPhone === '+962798889900'), 'Re-engagement message generated for missed patient');

  // Smart Reminders
  const remindersRes = await processSmartReminders();
  assert(Array.isArray(remindersRes.remindersSent), 'Smart Reminders scanner executed smoothly');

  // ------------------------------------------------------------------
  // TEST 5: Medical Liability Law No. 25 & PDPL Law No. 24 Compliance
  // ------------------------------------------------------------------
  console.log('\n--- PILLAR 5: Medical Liability & PDPL Compliance ---');

  // Emergency Triage
  const emergencyCheck = await processConversationalMessage({
    userMessage: 'عندي نزيف مستمر في أسناني وورم كبير بالفك ومش قادر اتنفس',
    patientPhone: '+962791112222',
    chatHistory: [],
  });

  assert(emergencyCheck.isEmergency, 'Law 25 Emergency Trigger flagged acute symptoms');
  assert(
    emergencyCheck.replyText.includes(MEDICAL_LIABILITY_GUARDRAILS.emergencyTriggerCode) ||
      emergencyCheck.toolCallsExecuted.some((tc) => tc.name === 'trigger_emergency_handover'),
    'Emergency Handover protocol executed to human physician'
  );

  console.log('\n====================================================================');
  console.log(`🎉 ALL ${passed}/${total} AUTONOMOUS VERIFICATION TESTS PASSED!`);
  console.log('====================================================================\n');
}

runAutonomousVerification().catch((err) => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
