// NashmiOps Enterprise (MVP Edition) - Core Domain Types

export type AppointmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'COMPLETED';

export type WaitlistStatus =
  | 'WAITING'
  | 'NOTIFIED'
  | 'BOOKED'
  | 'EXPIRED';

export type InvoiceType =
  | 'B2C_SIMPLIFIED'
  | 'B2B_STANDARD';

export type ServiceType =
  | 'consultation'
  | 'cleaning'
  | 'restoration'
  | 'extraction'
  | 'emergency'
  | 'whitening'
  | 'orthodontics_check';

export interface ServiceDefinition {
  id: ServiceType;
  nameAr: string;
  nameEn: string;
  durationMinutes: number;
  sterilizationMinutes: number; // Mandatory 15 minutes
  basePriceJOD: number;
  taxRatePercent: number; // Jordan standard 16% or 0% for basic medical
}

export interface Clinic {
  id: string;
  name: string;
  phone: string;
  address: string;
  license_number: string;
  tax_number: string; // ISTD Tax ID
  google_calendar_id?: string;
  created_at: string;
}

export interface Patient {
  id: string;
  clinic_id: string;
  whatsapp_phone: string;
  full_name: string;
  national_id?: string; // Optional for B2C < 100 JOD
  tax_id?: string; // Required for B2B
  is_head_of_family?: boolean;
  family_relation?: 'self' | 'child' | 'spouse' | 'parent' | 'other';
  primary_contact_phone?: string;
  pdpl_consent: boolean; // Law No. 24 of 2023
  pdpl_consent_timestamp?: string;
  medical_notes?: string;
  is_deleted: boolean; // Soft-delete (5-year retention, Law No. 25 of 2018)
  deleted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  clinic_id: string;
  patient_id: string;
  patient_name: string;
  patient_phone: string;
  service_type: ServiceType;
  practitioner_id?: string;
  practitioner_name?: string;
  chair_id?: string;
  chair_number?: number;
  start_time: string; // ISO String
  appointment_date?: string; // ISO String or YYYY-MM-DD
  end_time: string; // ISO String
  sterilization_end_time: string; // ISO String (+15 min buffer)
  status: AppointmentStatus;
  google_calendar_event_id?: string;
  notes?: string;
  is_emergency?: boolean;
  created_at: string;
  updated_at: string;
}

export interface WaitlistEntry {
  id: string;
  clinic_id: string;
  patient_id: string;
  patient_name: string;
  patient_phone: string;
  requested_service: ServiceType;
  preferred_date: string; // YYYY-MM-DD
  preferred_time_range?: 'morning' | 'afternoon' | 'any';
  status: WaitlistStatus;
  notified_at?: string;
  created_at: string;
}

export interface InvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;
  taxRate: number; // 0.16 or 0.00
  total: number;
}

export interface Invoice {
  id: string;
  clinic_id: string;
  appointment_id?: string;
  patient_id?: string;
  invoice_number: string;
  invoice_type: InvoiceType;
  buyer_name: string;
  buyer_tax_id?: string;
  buyer_national_id?: string;
  currency: 'JOD';
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  invoice_uuid: string;
  previous_invoice_hash: string;
  invoice_hash: string;
  qr_code_tlv: string;
  ubl_xml: string;
  status: 'ISSUED' | 'REPORTED' | 'CLEARED' | 'CANCELLED';
  clearance_status?: string;
  istd_submission_id?: string;
  submitted_at?: string;
  created_at: string;
}

export interface FailedOutboundMessage {
  id: string;
  clinic_id: string;
  recipient_phone: string;
  message_text: string;
  error_reason: string;
  status: 'PENDING_HUMAN_REVIEW' | 'RESOLVED' | 'DISCARDED';
  created_at: string;
}

export interface EmergencyHandover {
  id: string;
  clinic_id: string;
  patient_name: string;
  patient_phone: string;
  symptoms: string;
  severity: 'ACUTE' | 'URGENT';
  triggered_at: string;
  acknowledged_by_physician: boolean;
}

export interface ClinicFaq {
  id: string;
  clinic_id: string;
  category: 'hours' | 'location' | 'pricing' | 'insurance' | 'services' | 'general';
  question_ar: string;
  answer_ar: string;
  keywords: string[];
  created_at: string;
}

export interface ChatHistoryMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  toolCalls?: any[];
}

export interface ConversationState {
  id: string;
  clinic_id: string;
  phone_number: string;
  patient_name?: string;
  summary?: string;
  summary_updated_at?: string;
  chat_history: ChatHistoryMessage[];
  updated_at: string;
}

export interface ReceptionistAlert {
  id: string;
  clinic_id: string;
  type: 'EMERGENCY' | 'OUTBOUND_FAILURE';
  title: string;
  description: string;
  patient_name?: string;
  patient_phone: string;
  severity: 'CRITICAL' | 'WARNING';
  timestamp: string;
  metadata?: Record<string, any>;
}

// ====================================================================
// MULTI-PRACTITIONER & MULTI-CHAIR ROSTER (Phase 2)
// ====================================================================
export interface Practitioner {
  id: string;
  clinic_id: string;
  name_ar: string;
  name_en: string;
  specialty: string;
  specialty_ar: string;
  phone?: string;
  license_number?: string;
  color_code?: string;
  is_active: boolean;
  created_at: string;
}

export interface DentalChair {
  id: string;
  clinic_id: string;
  chair_number: number;
  name_ar: string;
  description_ar?: string;
  is_active: boolean;
  created_at: string;
}

// ====================================================================
// CLINICAL EHR & DENTAL CHARTING SCHEMA (Law No. 25 of 2018)
// ====================================================================
export type ToothStatus =
  | 'HEALTHY'
  | 'CARIES'
  | 'FILLED'
  | 'MISSING'
  | 'CROWN'
  | 'ROOT_CANAL'
  | 'IMPLANT'
  | 'IMPACTED';

export interface ToothRecord {
  tooth_number: number; // FDI notation 11..48 (Adults) or 51..85 (Pediatric)
  surface?: string; // M, D, O, B, L (Mesial, Distal, Occlusal, Buccal, Lingual)
  status: ToothStatus;
  notes?: string;
  last_treated_at?: string;
}

export interface PrescriptionItem {
  drug_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  notes?: string;
}

export interface ClinicalEHRRecord {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_id?: string;
  practitioner_id?: string;
  practitioner_name?: string;
  chief_complaint: string;
  diagnosis: string;
  clinical_notes: string;
  treatment_rendered: string;
  prescriptions?: PrescriptionItem[];
  odontogram?: ToothRecord[];
  allergies?: string[];
  chronic_conditions?: string[];
  informed_consent_signed: boolean;
  created_at: string;
  updated_at: string;
}

// ====================================================================
// REAL-TIME APM & ERROR TRACKING
// ====================================================================
export type APMSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface APMContext {
  route?: string;
  endpoint?: string;
  clinicId?: string;
  patientPhone?: string;
  toolName?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

export interface APMEvent {
  id: string;
  timestamp: string;
  severity: APMSeverity;
  message: string;
  error_name?: string;
  stack_trace?: string;
  context?: APMContext;
}
