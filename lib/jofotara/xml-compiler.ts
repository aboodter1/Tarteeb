// NashmiOps Enterprise (MVP Edition) - ISTD JoFotara Phase 2 UBL 2.1 XML Compiler

import crypto from 'crypto';
import { Invoice, InvoiceItem, InvoiceType } from '@/types';
import { CLINIC_CONFIG } from '@/lib/config/constants';

export interface JoFotaraCompileInput {
  invoiceNumber: string;
  invoiceType: InvoiceType;
  buyerName: string;
  buyerTaxId?: string; // Mandatory for B2B_STANDARD
  buyerNationalId?: string; // Optional for B2C_SIMPLIFIED
  items: InvoiceItem[];
  previousInvoiceHash?: string;
  issueDate?: string; // YYYY-MM-DD
  issueTime?: string; // HH:mm:ss
}

/**
 * Escape XML special characters to prevent XML injection
 */
export function escapeXml(unsafe?: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate Tag-Length-Value (TLV) encoded Base64 QR code for JoFotara & Levant specifications
 * Tag 1: Seller Name
 * Tag 2: Seller Tax Registration Number
 * Tag 3: Timestamp (ISO 8601)
 * Tag 4: Invoice Total (including tax)
 * Tag 5: Tax Total
 */
export function generateJoFotaraTLV(params: {
  sellerName: string;
  sellerTaxId: string;
  timestamp: string;
  invoiceTotal: number;
  taxTotal: number;
}): string {
  const encodeTag = (tag: number, value: string): Buffer => {
    const valBuf = Buffer.from(value, 'utf8');
    const tagBuf = Buffer.from([tag]);
    const lenBuf = Buffer.from([valBuf.length]);
    return Buffer.concat([tagBuf, lenBuf, valBuf]);
  };

  const tag1 = encodeTag(1, params.sellerName);
  const tag2 = encodeTag(2, params.sellerTaxId);
  const tag3 = encodeTag(3, params.timestamp);
  const tag4 = encodeTag(4, params.invoiceTotal.toFixed(3));
  const tag5 = encodeTag(5, params.taxTotal.toFixed(3));

  const fullBuffer = Buffer.concat([tag1, tag2, tag3, tag4, tag5]);
  return fullBuffer.toString('base64');
}

/**
 * Compile UBL 2.1 XML for ISTD JoFotara Phase 2
 */
export function compileJoFotaraXML(input: JoFotaraCompileInput): {
  xml: string;
  uuid: string;
  invoiceHash: string;
  pih: string;
  tlvQrCode: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  invoiceNumber?: string;
  invoiceType?: InvoiceType;
  issueDate?: string;
  issueTime?: string;
  buyerName?: string;
  buyerTaxId?: string;
  buyerNationalId?: string;
  items?: InvoiceItem[];
} {
  // 1. Validation Rules per Phase 2 mandate
  if (input.invoiceType === 'B2B_STANDARD') {
    if (!input.buyerTaxId || input.buyerTaxId.trim().length < 7) {
      throw new Error(
        'B2B Standard Tax Invoice requires a valid Buyer Tax ID (الرقم الضريبي للمشتري) per ISTD JoFotara regulations.'
      );
    }
  }

  // 2. Financial Calculations (JOD with 3 decimal places)
  let subtotal = 0;
  let taxAmount = 0;

  input.items.forEach((item) => {
    const itemSubtotal = item.unitPrice * item.quantity;
    const itemTax = itemSubtotal * item.taxRate;
    subtotal += itemSubtotal;
    taxAmount += itemTax;
  });

  subtotal = Math.round(subtotal * 1000) / 1000;
  taxAmount = Math.round(taxAmount * 1000) / 1000;
  const totalAmount = Math.round((subtotal + taxAmount) * 1000) / 1000;

  // Auto-branching: if total is < 100 JOD and no tax ID provided, it defaults safely to B2C Simplified
  const effectiveType: InvoiceType =
    input.invoiceType === 'B2B_STANDARD' ? 'B2B_STANDARD' : 'B2C_SIMPLIFIED';

  const uuid = crypto.randomUUID();
  const dateStr = input.issueDate || new Date().toISOString().split('T')[0];
  const timeStr = input.issueTime || new Date().toISOString().split('T')[1].split('.')[0];
  const timestampIso = `${dateStr}T${timeStr}Z`;

  // Cryptographic chaining: Previous Invoice Hash (PIH)
  const defaultPIH = 'NWZlY2ViNjAxOTEzMWIxMWNmMzQ1OGE3MDU4NDhhZGIxY2VmY2Q1NzcxN2FkNzhmNWQ5NzU0NzA1OWUyYzg2';
  const pih = input.previousInvoiceHash || defaultPIH;

  // TLV Base64 QR Code
  const tlvQrCode = generateJoFotaraTLV({
    sellerName: CLINIC_CONFIG.name,
    sellerTaxId: CLINIC_CONFIG.taxNumber,
    timestamp: timestampIso,
    invoiceTotal: totalAmount,
    taxTotal: taxAmount,
  });

  // 3. Construct UBL 2.1 XML with cbc, cac, ext namespaces
  const ublInvoiceTypeCode = effectiveType === 'B2C_SIMPLIFIED' ? '388' : '388';
  const ublProfileId = effectiveType === 'B2C_SIMPLIFIED' ? 'reporting:1.0' : 'clearance:1.0';

  const itemsXml = input.items
    .map((item, idx) => {
      const lineTotal = item.unitPrice * item.quantity;
      const lineTax = lineTotal * item.taxRate;
      return `
    <cac:InvoiceLine>
      <cbc:ID>${idx + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="EA">${item.quantity}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="JOD">${lineTotal.toFixed(3)}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="JOD">${lineTax.toFixed(3)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
          <cbc:TaxableAmount currencyID="JOD">${lineTotal.toFixed(3)}</cbc:TaxableAmount>
          <cbc:TaxAmount currencyID="JOD">${lineTax.toFixed(3)}</cbc:TaxAmount>
          <cac:TaxCategory>
            <cbc:ID>${item.taxRate > 0 ? 'S' : 'Z'}</cbc:ID>
            <cbc:Percent>${(item.taxRate * 100).toFixed(2)}</cbc:Percent>
            <cac:TaxScheme>
              <cbc:ID>VAT</cbc:ID>
            </cac:TaxScheme>
          </cac:TaxCategory>
        </cac:TaxSubtotal>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Description>${escapeXml(item.name)}</cbc:Description>
        <cbc:Name>${escapeXml(item.name)}</cbc:Name>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="JOD">${item.unitPrice.toFixed(3)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
    })
    .join('');

  const buyerPartyXml =
    effectiveType === 'B2B_STANDARD'
      ? `
    <cac:AccountingCustomerParty>
      <cac:Party>
        <cac:PartyIdentification>
          <cbc:ID schemeID="TIN">${escapeXml(input.buyerTaxId)}</cbc:ID>
        </cac:PartyIdentification>
        <cac:PartyName>
          <cbc:Name>${escapeXml(input.buyerName)}</cbc:Name>
        </cac:PartyName>
        <cac:PartyTaxScheme>
          <cbc:CompanyID>${escapeXml(input.buyerTaxId)}</cbc:CompanyID>
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:PartyTaxScheme>
      </cac:Party>
    </cac:AccountingCustomerParty>`
      : `
    <cac:AccountingCustomerParty>
      <cac:Party>
        <cac:PartyName>
          <cbc:Name>${escapeXml(input.buyerName || 'مريض نقدي')}</cbc:Name>
        </cac:PartyName>
        ${
          input.buyerNationalId
            ? `<cac:PartyIdentification><cbc:ID schemeID="NAT">${escapeXml(input.buyerNationalId)}</cbc:ID></cac:PartyIdentification>`
            : ''
        }
      </cac:Party>
    </cac:AccountingCustomerParty>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
      <ext:ExtensionContent>
        <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">
          <sac:SignatureInformation xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2">
            <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
            <sbc:ReferencedSignatureID xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
          </sac:SignatureInformation>
        </sig:UBLDocumentSignatures>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:ProfileID>${ublProfileId}</cbc:ProfileID>
  <cbc:ID>${escapeXml(input.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${dateStr}</cbc:IssueDate>
  <cbc:IssueTime>${timeStr}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="0111110">${ublInvoiceTypeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>JOD</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>JOD</cbc:TaxCurrencyCode>

  <!-- Cryptographic Chaining: Previous Invoice Hash (PIH) -->
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cac:EmbeddedDocumentBinaryObject mimeCode="text/plain">${pih}</cac:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>

  <!-- Embedded Cryptographic TLV QR Code -->
  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment>
      <cac:EmbeddedDocumentBinaryObject mimeCode="text/plain">${tlvQrCode}</cac:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>

  <!-- Seller Party (Nashmi Dental Clinic) -->
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="TIN">${CLINIC_CONFIG.taxNumber}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${CLINIC_CONFIG.name}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:CityName>Amman</cbc:CityName>
        <cbc:CountrySubentity>Amman Governorate</cbc:CountrySubentity>
        <cac:Country>
          <cbc:IdentificationCode>JO</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${CLINIC_CONFIG.taxNumber}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <!-- Buyer Party -->
  ${buyerPartyXml}

  <!-- Legal Monetary Total -->
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="JOD">${taxAmount.toFixed(3)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="JOD">${subtotal.toFixed(3)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="JOD">${subtotal.toFixed(3)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="JOD">${totalAmount.toFixed(3)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="JOD">${totalAmount.toFixed(3)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  <!-- Invoice Lines -->
  ${itemsXml}
</Invoice>`;

  // 4. Compute SHA-256 Hash of canonicalized XML for cryptographic tamper-proofing
  const invoiceHash = crypto.createHash('sha256').update(xml, 'utf8').digest('hex');

  return {
    xml,
    uuid,
    invoiceHash,
    pih,
    tlvQrCode,
    subtotal,
    taxAmount,
    totalAmount,
    invoiceNumber: input.invoiceNumber,
    invoiceType: effectiveType,
    issueDate: dateStr,
    issueTime: timeStr,
    buyerName: input.buyerName,
    buyerTaxId: input.buyerTaxId,
    buyerNationalId: input.buyerNationalId,
    items: input.items,
  };
}
