// NashmiOps Enterprise (MVP Edition) - In-Memory Ephemeral Store & Serverless Safe Interface
// Replaced synchronous disk writes (fs.writeFileSync) with atomic Supabase persistence to prevent Split-Brain

export interface PersistentSnapshot {
  clinics?: any[];
  patients?: any[];
  appointments?: any[];
  waitlist?: any[];
  invoices?: any[];
  clinic_faqs?: any[];
  conversations?: any[];
  processed_messages?: any[];
  failed_outbound_messages?: any[];
  practitioners?: any[];
  dental_chairs?: any[];
  clinical_records?: any[];
  receptionist_alerts?: any[];
}

let ephemeralSnapshot: PersistentSnapshot | null = null;

/**
 * Serverless Safe Snapshot Loader (Zero disk dependency)
 */
export function loadPersistentData(): PersistentSnapshot | null {
  return ephemeralSnapshot;
}

/**
 * Serverless Safe Snapshot Saver (No-op disk I/O, state delegated atomically to Supabase)
 */
export function savePersistentData(data: PersistentSnapshot): void {
  ephemeralSnapshot = { ...data };
}
