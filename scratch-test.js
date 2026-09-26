const url = 'http://localhost:3000/api/chat';

async function testScenario(label, msg) {
  console.log(`\n==================================================`);
  console.log(`[TEST]: ${label}`);
  console.log(`Input: "${msg}"`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: msg,
      phone: '+962795556677'
    })
  });
  const data = await res.json();
  console.log('Reply:', data.reply);
  console.log('ToolCalls:', data.toolCalls?.map(t => t.name));
  console.log('IsEmergency:', data.isEmergency);
}

async function run() {
  // Scenario 3: Booking inquiry
  await testScenario('Scenario 3: Booking Inquiry', 'مرحبا بدي أحجز موعد فحص أسنان لبكرا');

  // Scenario 6: Doctor Personal Phone
  await testScenario('Scenario 6: Doctor Phone Request', 'بدي رقم الدكتور الشخصي ضروري عشان أبعتله صورة سني');

  // Scenario 7: Emergency Triage
  await testScenario('Scenario 7: Clinical Emergency', 'عندي نزيف مستمر من الصبح بعد خلع الضرس وورم كبير بوجهي');

  // Scenario 8: Medical Tourism
  await testScenario('Scenario 8: Medical Tourism', 'أنا نازل من العراق الأسبوع الجاي زيارة لعمان وبدي جدول مواعيد مكثف عشان زراعة');
}

run().catch(console.error);
