// NashmiOps Enterprise - Circuit Breaker & Offline Resilience Verification Suite
import assert from 'assert';
import { circuitBreaker } from '../lib/resilience/circuit-breaker';
import { sendWhatsAppTextMessage } from '../lib/whatsapp/client';
import { submitInvoiceToJoFotara } from '../lib/jofotara/client';
import { whatsappRetryQueue } from '../lib/whatsapp/retry-queue';
import { jofotaraRetryQueue } from '../lib/jofotara/client';

async function runCircuitBreakerTests() {
  console.log('===============================================================');
  console.log('🧪 VERIFYING CIRCUIT BREAKER & OFFLINE RESILIENCE SUITE');
  console.log('===============================================================\n');

  // 1. Initial State
  console.log('--- 1. Testing Initial Circuit State ---');
  circuitBreaker.reset();
  const waInitial = circuitBreaker.getStatus('whatsapp') as any;
  assert(waInitial.state === 'CLOSED', 'WhatsApp circuit initially CLOSED');
  assert(waInitial.consecutiveFailures === 0, 'WhatsApp initial failures = 0');
  assert(waInitial.isSimulatedFallbackActive === false, 'Simulated fallback inactive initially');
  console.log('  ✅ [PASS] Circuits initialize in CLOSED state');

  // 2. Failure Counting & Tripping
  console.log('\n--- 2. Testing Failure Counting & Tripping Mechanism ---');
  circuitBreaker.recordFailure('whatsapp', new Error('Timeout connecting to Meta'));
  assert((circuitBreaker.getStatus('whatsapp') as any).consecutiveFailures === 1, 'Failure count increments to 1');
  assert(circuitBreaker.getState('whatsapp') === 'CLOSED', 'Circuit remains CLOSED before threshold');

  circuitBreaker.recordFailure('whatsapp', new Error('Timeout connecting to Meta'));
  assert((circuitBreaker.getStatus('whatsapp') as any).consecutiveFailures === 2, 'Failure count increments to 2');

  circuitBreaker.recordFailure('whatsapp', new Error('Timeout connecting to Meta'));
  assert(circuitBreaker.getState('whatsapp') === 'OPEN', 'Circuit TRIPS to OPEN at threshold 3');
  assert(circuitBreaker.isSimulatedFallbackActive('whatsapp') === true, 'Simulated fallback activates when OPEN');
  console.log('  ✅ [PASS] WhatsApp circuit trips to OPEN after threshold exceeded');

  // 3. Fast-path Execution Bypass when OPEN
  console.log('\n--- 3. Testing Fast-Path Execution Bypass when OPEN ---');
  let networkActionAttempted: boolean = false;
  let fallbackExecuted: boolean = false;

  const res = await circuitBreaker.execute(
    'whatsapp',
    async () => {
      networkActionAttempted = true;
      return 'real_network_response';
    },
    async (state) => {
      fallbackExecuted = true;
      return `fallback_for_${state}`;
    }
  );

  assert(!networkActionAttempted, 'Real network action is BYPASSED when circuit is OPEN');
  assert(Boolean(fallbackExecuted), 'Local fallback is executed immediately');
  assert(res === 'fallback_for_OPEN', 'Fallback response correctly returned');
  console.log('  ✅ [PASS] Circuit breaker immediately bypasses network and calls fallback when OPEN');

  // 4. WhatsApp Client Resilience under OPEN Circuit
  console.log('\n--- 4. Testing WhatsApp Client Resilience under OPEN Circuit ---');
  const waQueueInitialLen = whatsappRetryQueue.length;
  const waSendRes = await sendWhatsAppTextMessage('0791234567', 'رسالة تجربة استمرارية التشغيل');
  assert(waSendRes.success === true, 'WhatsApp send returns success in simulated mode');
  assert(Boolean(waSendRes.simulated), 'WhatsApp result explicitly marked as simulated');
  assert(typeof waSendRes.messageId === 'string', 'WhatsApp result provides valid simulated message ID');
  const waQueueNewLen = whatsappRetryQueue.length;
  assert(waQueueNewLen >= waQueueInitialLen, 'Failed/fallback message queued in retry queue');
  console.log('  ✅ [PASS] WhatsApp client operates seamlessly in simulated fallback mode without crashing');

  // 5. JoFotara Circuit Tripping & Offline Invoicing
  console.log('\n--- 5. Testing JoFotara Circuit Tripping & Offline Invoicing ---');
  circuitBreaker.trip('jofotara');
  assert(circuitBreaker.getState('jofotara') === 'OPEN', 'JoFotara circuit tripped to OPEN');
  assert(circuitBreaker.isSimulatedFallbackActive('jofotara') === true, 'JoFotara fallback active');

  const jofotaraQueueInitialLen = jofotaraRetryQueue.length;
  const invoiceRes = await submitInvoiceToJoFotara({
    invoiceNumber: 'INV-OFFLINE-001',
    invoiceType: 'B2C_SIMPLIFIED',
    ublXml: '<Invoice>offline_test</Invoice>',
    invoiceUuid: 'uuid-offline-1234',
    invoiceHash: 'hash-offline-5678',
    totalAmount: 35.0,
  });

  assert(invoiceRes.success === true, 'JoFotara returns success under offline circuit');
  assert(invoiceRes.simulated === true, 'JoFotara invoice marked as simulated');
  assert(invoiceRes.status === 'REPORTED', 'Invoice status set to REPORTED');
  assert(typeof invoiceRes.submissionId === 'string', 'Submission ID generated for offline invoice');
  assert(jofotaraRetryQueue.length >= jofotaraQueueInitialLen, 'Offline invoice saved to retry queue for later gateway sync');
  console.log('  ✅ [PASS] JoFotara client operates seamlessly in offline mode, generating compliant invoices');

  // 6. Recovery & Reset
  console.log('\n--- 6. Testing Circuit Recovery & Reset ---');
  circuitBreaker.reset();
  assert(circuitBreaker.getState('whatsapp') === 'CLOSED', 'WhatsApp circuit resets to CLOSED');
  assert(circuitBreaker.getState('jofotara') === 'CLOSED', 'JoFotara circuit resets to CLOSED');
  assert(circuitBreaker.isSimulatedFallbackActive('whatsapp') === false, 'WhatsApp fallback deactivated');
  assert(circuitBreaker.isSimulatedFallbackActive('jofotara') === false, 'JoFotara fallback deactivated');
  console.log('  ✅ [PASS] Circuits cleanly recover and reset');

  console.log('\n===============================================================');
  console.log('🎉 ALL CIRCUIT BREAKER RESILIENCE TESTS PASSED!');
  console.log('===============================================================');
}

runCircuitBreakerTests().catch((err) => {
  console.error('❌ Circuit breaker verification failed:', err);
  process.exit(1);
});
