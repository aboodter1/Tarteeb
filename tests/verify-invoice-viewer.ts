// Verification test for Visual Invoice Viewer & JoFotara E-Invoicing

import QRCode from 'qrcode';
import { compileJoFotaraXML } from '../lib/jofotara/xml-compiler';

async function testInvoiceViewerLogic() {
  console.log('================================================================');
  console.log('🧪 TESTING VISUAL INVOICE VIEWER & JOFOTARA PRINT LOGIC');
  console.log('================================================================\n');

  // 1. Test B2C Simplified Invoice Generation
  console.log('--- Test 1: B2C Simplified Tax Invoice ---');
  const b2cRes = compileJoFotaraXML({
    invoiceNumber: 'INV-2026-0042',
    invoiceType: 'B2C_SIMPLIFIED',
    buyerName: 'طارق زياد',
    items: [
      {
        name: 'كشف واستشارة طبية شاملة مع تنظيف وتلميع أسنان',
        quantity: 1,
        unitPrice: 35.0,
        taxRate: 0.16,
        total: 40.6,
      },
    ],
  });

  if (
    b2cRes.invoiceNumber === 'INV-2026-0042' &&
    b2cRes.totalAmount === 40.6 &&
    b2cRes.taxAmount === 5.6 &&
    b2cRes.subtotal === 35.0
  ) {
    console.log('✅ [PASS] B2C Invoice totals calculated accurately (35.000 + 5.600 = 40.600 JOD)');
  } else {
    throw new Error('B2C calculation mismatch');
  }

  // 2. Test B2B Standard Invoice Generation
  console.log('\n--- Test 2: B2B Standard Tax Invoice with Buyer Tax ID ---');
  const b2bRes = compileJoFotaraXML({
    invoiceNumber: 'INV-2026-0099',
    invoiceType: 'B2B_STANDARD',
    buyerName: 'شركة النماء الطبية',
    buyerTaxId: '109283746',
    items: [
      {
        name: 'خدمات طب وجراحة أسنان لمنتسبي الشركة',
        quantity: 2,
        unitPrice: 125.0,
        taxRate: 0.16,
        total: 290.0,
      },
    ],
  });

  if (
    b2bRes.buyerTaxId === '109283746' &&
    b2bRes.totalAmount === 290.0 &&
    b2bRes.subtotal === 250.0 &&
    b2bRes.taxAmount === 40.0
  ) {
    console.log('✅ [PASS] B2B Invoice totals & Buyer Tax ID valid (250.000 + 40.000 = 290.000 JOD)');
  } else {
    throw new Error('B2B calculation mismatch');
  }

  // 3. Test QR Code Data URL Generation from TLV Base64
  console.log('\n--- Test 3: QR Code Data URL Generation ---');
  const qrDataUrl = await QRCode.toDataURL(b2cRes.tlvQrCode, {
    width: 170,
    margin: 1,
  });

  if (qrDataUrl.startsWith('data:image/png;base64,')) {
    console.log('✅ [PASS] QR Code PNG Data URL generated successfully from TLV Base64 string');
  } else {
    throw new Error('QR Code data URL generation failed');
  }

  // 4. Test XML Tag Extraction
  console.log('\n--- Test 4: UBL 2.1 XML Tag Extraction ---');
  const xml = b2cRes.xml;
  const idMatch = xml.match(/<cbc:ID>(INV-[^<]+)<\/cbc:ID>/)?.[1];
  const qrMatch = xml.match(
    /<cac:AdditionalDocumentReference>[\s\S]*?<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cac:Attachment>[\s\S]*?<cac:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<\/cac:EmbeddedDocumentBinaryObject>/
  )?.[1];

  if (idMatch === 'INV-2026-0042' && qrMatch === b2cRes.tlvQrCode) {
    console.log('✅ [PASS] Regex extraction matched cbc:ID and Embedded QR Object perfectly');
  } else {
    throw new Error('XML Tag extraction mismatch');
  }

  console.log('\n================================================================');
  console.log('🚀 ALL VISUAL INVOICE VIEWER & PRINT TESTS PASSED 100%!');
  console.log('================================================================');
}

testInvoiceViewerLogic().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
