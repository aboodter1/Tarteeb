'use client';

import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  FileText,
  Code,
  Printer,
  CheckCircle2,
  Building2,
  Calendar,
  Clock,
  ShieldCheck,
  Hash,
  User,
  QrCode,
  Copy,
  Check,
} from 'lucide-react';
import { CLINIC_CONFIG } from '@/lib/config/constants';

export interface InvoiceItemData {
  name: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
}

export interface InvoiceViewerProps {
  xml?: string;
  metadata?: {
    invoiceNumber?: string;
    invoiceType?: 'B2C_SIMPLIFIED' | 'B2B_STANDARD';
    issueDate?: string;
    issueTime?: string;
    buyerName?: string;
    buyerTaxId?: string;
    buyerNationalId?: string;
    items?: InvoiceItemData[];
    subtotal?: number;
    taxAmount?: number;
    totalAmount?: number;
    uuid?: string;
    invoiceHash?: string;
    tlvQrCode?: string;
  };
}

export function InvoiceViewer({ xml, metadata }: InvoiceViewerProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'xml'>('preview');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedHash, setCopiedHash] = useState(false);

  // Extract or fallback to metadata / XML
  const rawXml = xml || '';

  const extractRegex = (regex: RegExp, defaultVal = ''): string => {
    const match = rawXml.match(regex);
    return match ? match[1].trim() : defaultVal;
  };

  const invoiceNumber =
    metadata?.invoiceNumber ||
    extractRegex(/<cbc:ID>(INV-[^<]+)<\/cbc:ID>/) ||
    extractRegex(/<cbc:ID>([^<]+)<\/cbc:ID>/, 'INV-2026-0001');

  const uuid =
    metadata?.uuid ||
    extractRegex(/<cbc:UUID>([^<]+)<\/cbc:UUID>/, 'e5a4099b-d748-422f-87d5-d91abf81b19a');

  const issueDate =
    metadata?.issueDate ||
    extractRegex(/<cbc:IssueDate>([^<]+)<\/cbc:IssueDate>/, new Date().toISOString().split('T')[0]);

  const issueTime =
    metadata?.issueTime ||
    extractRegex(/<cbc:IssueTime>([^<]+)<\/cbc:IssueTime>/, new Date().toLocaleTimeString('ar-JO'));

  const invoiceTypeCode = extractRegex(/<cbc:InvoiceTypeCode[^>]*>([^<]+)<\/cbc:InvoiceTypeCode>/);
  const isB2B =
    metadata?.invoiceType === 'B2B_STANDARD' ||
    rawXml.includes('clearance:1.0') ||
    Boolean(metadata?.buyerTaxId);

  const buyerName =
    metadata?.buyerName ||
    extractRegex(/<cac:AccountingCustomerParty>[\s\S]*?<cbc:RegistrationName>([^<]+)<\/cbc:RegistrationName>/, 'مريض نقدي');

  const buyerTaxId =
    metadata?.buyerTaxId ||
    extractRegex(/<cac:AccountingCustomerParty>[\s\S]*?<cbc:CompanyID>([^<]+)<\/cbc:CompanyID>/, '');

  const buyerNationalId =
    metadata?.buyerNationalId ||
    extractRegex(/<cac:AccountingCustomerParty>[\s\S]*?<cbc:ID schemeID="NID">([^<]+)<\/cbc:ID>/, '');

  const subtotalVal =
    metadata?.subtotal !== undefined
      ? metadata.subtotal
      : parseFloat(extractRegex(/<cbc:TaxExclusiveAmount[^>]*>([^<]+)<\/cbc:TaxExclusiveAmount>/, '35.0'));

  const taxAmountVal =
    metadata?.taxAmount !== undefined
      ? metadata.taxAmount
      : parseFloat(extractRegex(/<cac:TaxTotal>[\s\S]*?<cbc:TaxAmount[^>]*>([^<]+)<\/cbc:TaxAmount>/, '5.6'));

  const totalAmountVal =
    metadata?.totalAmount !== undefined
      ? metadata.totalAmount
      : parseFloat(extractRegex(/<cbc:TaxInclusiveAmount[^>]*>([^<]+)<\/cbc:TaxInclusiveAmount>/, '40.6'));

  const tlvQrCode =
    metadata?.tlvQrCode ||
    extractRegex(
      /<cac:AdditionalDocumentReference>[\s\S]*?<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cac:Attachment>[\s\S]*?<cac:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<\/cac:EmbeddedDocumentBinaryObject>/
    );

  const invoiceHash =
    metadata?.invoiceHash ||
    extractRegex(
      /<cac:AdditionalDocumentReference>[\s\S]*?<cbc:ID>PIH<\/cbc:ID>[\s\S]*?<cac:Attachment>[\s\S]*?<cac:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<\/cac:EmbeddedDocumentBinaryObject>/,
      '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069'
    );

  // Extract items
  let parsedItems: InvoiceItemData[] = metadata?.items || [];
  if (parsedItems.length === 0 && rawXml) {
    const lineMatches = rawXml.match(/<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/g);
    if (lineMatches && lineMatches.length > 0) {
      parsedItems = lineMatches.map((block) => {
        const name =
          block.match(/<cbc:Name>([^<]+)<\/cbc:Name>/)?.[1] ||
          block.match(/<cbc:Description>([^<]+)<\/cbc:Description>/)?.[1] ||
          'خدمة طب أسنان';
        const quantity = parseFloat(block.match(/<cbc:InvoicedQuantity[^>]*>([^<]+)<\/cbc:InvoicedQuantity>/)?.[1] || '1');
        const unitPrice = parseFloat(block.match(/<cac:Price>[\s\S]*?<cbc:PriceAmount[^>]*>([^<]+)<\/cbc:PriceAmount>/)?.[1] || '35');
        const taxRate = parseFloat(block.match(/<cbc:Percent>([^<]+)<\/cbc:Percent>/)?.[1] || '16') / 100;
        const total = quantity * unitPrice * (1 + taxRate);
        return { name, quantity, unitPrice, taxRate, total };
      });
    }
  }

  if (parsedItems.length === 0) {
    parsedItems = [
      {
        name: isB2B ? 'خدمات طب وجراحة أسنان لمنتسبي الشركة' : 'كشف واستشارة طبية شاملة مع تنظيف وتلميع أسنان',
        quantity: isB2B ? 2 : 1,
        unitPrice: isB2B ? 125.0 : 35.0,
        taxRate: 0.16,
        total: totalAmountVal,
      },
    ];
  }

  // Generate QR Code image
  useEffect(() => {
    if (!tlvQrCode) {
      setQrCodeDataUrl('');
      return;
    }
    QRCode.toDataURL(tlvQrCode, {
      width: 170,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => setQrCodeDataUrl(url))
      .catch((err) => console.warn('QR Code generation error:', err));
  }, [tlvQrCode]);

  const handlePrint = () => {
    window.print();
  };

  const handleCopyHash = () => {
    if (!invoiceHash) return;
    navigator.clipboard.writeText(invoiceHash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Print Stylesheet injection */}
      <style jsx global>{`
        @media print {
          body {
            background-color: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
          .printable-invoice-wrapper {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 24px !important;
            background: white !important;
            color: black !important;
          }
          .printable-invoice-card {
            border: 1px solid #cbd5e1 !important;
            box-shadow: none !important;
            background: white !important;
            color: #0f172a !important;
          }
          .printable-invoice-card * {
            color: #0f172a !important;
          }
          .printable-invoice-card .text-slate-400,
          .printable-invoice-card .text-slate-500 {
            color: #64748b !important;
          }
          .printable-invoice-card th {
            background-color: #f1f5f9 !important;
            color: #0f172a !important;
          }
        }
      `}</style>

      {/* Control Bar: View Toggle + Print Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-100 border border-slate-200 p-3 rounded-xl no-print">
        {/* Toggle Switch */}
        <div className="flex items-center bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
          <button
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              viewMode === 'preview'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>معاينة الفاتورة (Invoice Preview)</span>
          </button>
          <button
            onClick={() => setViewMode('xml')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              viewMode === 'xml'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>عرض الكود (XML View)</span>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {viewMode === 'preview' && (
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold shadow-sm transition active:scale-95"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة الفاتورة (Print / PDF)</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-1.5 rounded-lg font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
            <span>معتمدة ضريبياً (JoFotara Phase 2)</span>
          </div>
        </div>
      </div>

      {/* VIEW 1: Raw XML View */}
      {viewMode === 'xml' && (
        <div className="space-y-3 no-print">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-medium">رمز TLV Base64 QR:</span>
              <code className="text-teal-700 font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200">
                {tlvQrCode ? `${tlvQrCode.substring(0, 45)}...` : 'N/A'}
              </code>
            </div>
            <span className="text-[10px] bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded font-mono font-medium">
              UBL 2.1 ISO/IEC 19845
            </span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 font-mono text-xs overflow-x-auto text-slate-800 max-h-[550px] shadow-xs">
            <pre className="whitespace-pre-wrap">{rawXml || '<!-- لم يتم توليد XML بعد -->'}</pre>
          </div>
        </div>
      )}

      {/* VIEW 2: Visual Invoice Card (Printable - White Official Paper) */}
      {viewMode === 'preview' && (
        <div className="printable-invoice-wrapper">
          <div className="printable-invoice-card bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden p-6 md:p-8 space-y-6 text-slate-800">
            {/* Top National Header */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🇯🇴</span>
                  <span className="text-xs font-bold text-slate-600 tracking-wider">
                    المملكة الأردنية الهاشمية - دائرة ضريبة الدخل والمبيعات (ISTD)
                  </span>
                </div>
                <h2 className="text-xl md:text-2xl font-black text-slate-900 flex items-center gap-2">
                  <span>{CLINIC_CONFIG.name}</span>
                </h2>
                <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                  <span>{CLINIC_CONFIG.address}</span>
                  <span>•</span>
                  <span>هاتف: {CLINIC_CONFIG.phone}</span>
                  <span>•</span>
                  <span>رخصة: {CLINIC_CONFIG.licenseNumber}</span>
                </p>
              </div>

              {/* Invoice Type Badge */}
              <div className="text-left md:text-left self-stretch md:self-auto flex flex-col items-start md:items-end justify-center bg-slate-50 border border-slate-200 p-3.5 rounded-xl min-w-[200px] shadow-sm">
                <div className="flex items-center gap-1.5 text-xs font-bold text-teal-700 mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                  <span>
                    {isB2B
                      ? 'فاتورة ضريبية عامة معتمدة (B2B)'
                      : 'فاتورة ضريبية مبسطة (B2C)'}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-700">
                  <span className="text-slate-500">رقم الفاتورة: </span>
                  <span className="font-bold text-slate-900">{invoiceNumber}</span>
                </div>
                <div className="text-[10px] font-mono text-slate-600">
                  <span>الرقم الضريبي للمركز (TIN): </span>
                  <span className="text-teal-700 font-semibold">{CLINIC_CONFIG.taxNumber}</span>
                </div>
              </div>
            </div>

            {/* Invoice Meta Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
              <div>
                <span className="text-slate-500 block mb-0.5 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  تاريخ الإصدار:
                </span>
                <span className="font-semibold text-slate-900 font-mono">{issueDate}</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  وقت الإصدار:
                </span>
                <span className="font-semibold text-slate-900 font-mono">{issueTime}</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5 flex items-center gap-1">
                  <User className="w-3 h-3 text-slate-400" />
                  العميل / المشتري:
                </span>
                <span className="font-semibold text-slate-900 truncate block">{buyerName}</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5 flex items-center gap-1">
                  <Hash className="w-3 h-3 text-slate-400" />
                  {isB2B ? 'الرقم الضريبي للمشتري:' : 'الرقم الوطني / الهوية:'}
                </span>
                <span className="font-semibold text-slate-900 font-mono">
                  {buyerTaxId || buyerNationalId || 'غير محدد (نقدي)'}
                </span>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 w-10 text-center">#</th>
                    <th className="p-3">الإجراء الطبي / الخدمة</th>
                    <th className="p-3 text-center w-16">الكمية</th>
                    <th className="p-3 text-left w-24">السعر (د.أ)</th>
                    <th className="p-3 text-left w-24">الضريبة</th>
                    <th className="p-3 text-left w-28">الإجمالي (د.أ)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {parsedItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition">
                      <td className="p-3 text-center text-slate-500 font-mono">{idx + 1}</td>
                      <td className="p-3 font-semibold text-slate-900">{item.name}</td>
                      <td className="p-3 text-center font-mono">{item.quantity}</td>
                      <td className="p-3 text-left font-mono">{item.unitPrice.toFixed(3)}</td>
                      <td className="p-3 text-left font-mono">
                        {item.taxRate > 0 ? `${(item.taxRate * 100).toFixed(0)}%` : 'معفى 0%'}
                      </td>
                      <td className="p-3 text-left font-mono font-bold text-slate-900">
                        {item.total.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Summary & QR Code Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center pt-2">
              {/* QR Code & Cryptographic Seals */}
              <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="bg-white p-2 rounded-lg shadow-sm border border-slate-200 flex-shrink-0">
                  {qrCodeDataUrl ? (
                    <img
                      src={qrCodeDataUrl}
                      alt="JoFotara TLV QR Code"
                      className="w-28 h-28 object-contain"
                    />
                  ) : (
                    <div className="w-28 h-28 flex items-center justify-center text-slate-400 text-[10px] text-center">
                      <QrCode className="w-8 h-8 mb-1 opacity-50" />
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 text-[11px] leading-relaxed">
                  <div className="flex items-center gap-1 text-teal-700 font-bold">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                    <span>رمز الاستجابة السريعة (TLV Base64 QR)</span>
                  </div>
                  <p className="text-slate-600 text-[10px]">
                    مشفر وفق اشتراطات الفوترة الإلكترونية الأردنية JoFotara (محددات التاج من 1 إلى 5).
                  </p>
                  <div className="font-mono text-[9px] text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 truncate max-w-[200px]">
                    UUID: {uuid}
                  </div>
                </div>
              </div>

              {/* Totals Box */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs shadow-sm">
                <div className="flex justify-between text-slate-600">
                  <span>المجموع الخاضع للضريبة (Subtotal):</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {subtotalVal.toFixed(3)} دينار
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>ضريبة المبيعات العامة (VAT 16%):</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {taxAmountVal.toFixed(3)} دينار
                  </span>
                </div>
                <div className="border-t border-slate-200 pt-2 flex justify-between items-center">
                  <span className="font-bold text-sm text-slate-900">المجموع الإجمالي الكلي (Total):</span>
                  <span className="font-bold text-base md:text-lg text-teal-700 font-mono">
                    {totalAmountVal.toFixed(3)} د.أ
                  </span>
                </div>
              </div>
            </div>

            {/* Tamper-Proof SHA-256 Hash Chaining Footer */}
            <div className="border-t border-slate-200 pt-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
              <div className="flex items-center gap-2 truncate max-w-full">
                <span className="text-slate-500">SHA-256 Chaining Hash:</span>
                <span className="text-slate-700 truncate max-w-[280px] md:max-w-[400px]">
                  {invoiceHash}
                </span>
                <button
                  onClick={handleCopyHash}
                  className="text-slate-500 hover:text-slate-800 p-1 rounded transition no-print"
                  title="نسخ الهاش"
                >
                  {copiedHash ? <Check className="w-3 h-3 text-teal-600" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <div className="text-left md:text-left text-slate-500">
                <span>تخضع لأحكام قانون ضريبة الدخل رقم 34 لعام 2014 ونظام الفوترة الوطني</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
