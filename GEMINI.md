# Tarteeb Medical OS (نظام ترتيب لإدارة العيادات) - Architectural & Regulatory Master Specification

## 1. Overview
**Tarteeb Medical OS (نظام ترتيب)** is a frictionless, multi-tenant B2B Clinic Operating System engineered exclusively for the Jordanian healthcare market, featuring the autonomous AI receptionist assistant **"نشمي (Nashmi)"**. It eliminates all upfront CliQ deposits and focuses on an autonomous operational workflow powered by:
- Conversational Voice & Text AI (Gemini 3.5 Flash) via the "Nashmi" Assistant
- ISTD JoFotara Phase 2 E-Invoicing (UBL 2.1 XML + TLV QR)
- Smart Waitlist Sniper
- Autonomous Reminders & No-Show Recovery
- Strict Jordanian Medical Liability & Data Protection Compliance

---

## 2. Regulatory & Legal Jurisprudence

### A. Jordanian Medical and Health Liability Law No. 25 of 2018 (قانون المسؤولية الطبية والصحية)
- **Administrative Boundary**: The AI operates exclusively within the administrative domain. It is technologically barred from:
  1. Interpreting clinical symptoms.
  2. Diagnosing conditions.
  3. Recommending, prescribing, or suggesting any medications or painkillers (e.g., Panadol, Ibuprofen, Antibiotics).
  4. Evaluating surgical or clinical treatment efficacy.
- **In-Person Deferral**: All medical questions must be gracefully deferred to a licensed physician during an in-person clinical examination.
- **Emergency Triage Protocol**: The AI continuously scans for acute medical distress markers:
  - Severe facial/jaw swelling (انتفاخ حاد بالوجه أو الفك).
  - Acute or uncontrolled hemorrhage/bleeding (نزيف مستمر أو حاد).
  - Unbearable sudden trauma/pain (ألم صدمي حاد غير محتمل).
  - High fever accompanying dental infection.
  - Upon detection, the AI immediately outputs `[EMERGENCY_TRIGGER]`, halts automated booking loops, comforts the patient, and activates urgent human physician triage.
- **Mandatory 5-Year Data Retention**: All patient records and logs must be preserved for at least 5 years. Deletion requests must utilize soft-deletion (`is_deleted = true`, `deleted_at = NOW()`), ensuring auditability under Law No. 25.

### B. Jordanian Personal Data Protection Law No. 24 of 2023 (قانون حماية البيانات الشخصية)
- **Sensitive Personal Data Classification**: Health and medical data are legally categorized as sensitive.
- **Explicit Prior Consent**: First-time interactions must present an explicit digital consent disclaimer. The AI pauses processing personal symptoms or details until the patient responds affirmatively (`CONSENT_GRANTED`).
- **Cryptographic Multi-Tenancy**: PostgreSQL Row Level Security (RLS) guarantees complete data isolation between clinics via `clinic_id`.

---

## 3. UI/UX 100% RTL (Right-to-Left) Requirements
- All user interfaces must render with `dir="rtl"` and `lang="ar"`.
- Primary typography:
  - Heading & Display: `'Tajawal', sans-serif`
  - Body & Numbers: `'IBM Plex Sans Arabic', sans-serif`
- Design token alignment:
  - Margins, paddings, absolute positions, and flex flows must adhere to Jordanian Arabic reading patterns.
  - Currency format: `X.XXX د.أ` (Jordanian Dinar with 3 decimal places).
  - Date & Time format: Amman Timezone (`Asia/Amman`), 12-hour format with صباحاً / مساءً.

---

## 4. Financial Compliance: ISTD JoFotara Phase 2
- **XML Standard**: Universal Business Language (UBL 2.1) utilizing `cbc`, `cac`, and `ext` namespaces.
- **Dynamic Branching**:
  - **B2C Simplified Tax Invoice (< 100 JOD)**: No mandatory National ID from patient; frictionless generation.
  - **B2B Standard Tax Invoice (≥ 100 JOD or Corporate)**: Mandatory Buyer Tax Identification Number (الرقم الضريبي).
- **Cryptographic Chaining**:
  - Each invoice contains a UUID and is linked to the previous invoice via Previous Invoice Hash (PIH) using SHA-256.
- **TLV Base64 QR Code**:
  - Locally encoded Tag-Length-Value structure containing Seller Name, Seller Tax ID, Timestamp, Total with Tax, and Tax Amount.

---

## 5. Autonomous Operational Recovery
1. **Frictionless Zero-Deposit Scheduling**: Instant booking without payment friction.
2. **Smart Waitlist Sniper**: Real-time vacancy filling upon cancellation via automated WhatsApp utility templates.
3. **No-Show Recovery**: Automatic re-engagement 1 hour post-missed appointment.
4. **Smart Reminders**: 24-hour pre-appointment check + 2-hour pre-appointment notification with Amman clinic Google Maps pin.
5. **Google Calendar Sync**: Integrated Service Account with mandatory 15-minute sterilization buffers and Family Profiles.
