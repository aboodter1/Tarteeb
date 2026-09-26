import { supabase } from '../lib/db/supabase';
import { CLINIC_CONFIG } from '../lib/config/constants';

async function check() {
  console.log('Testing Supabase Connection & Schema...');
  try {
    const { data: clinics, error: cErr } = await supabase.from('clinics').select('*');
    console.log('Clinics:', clinics, 'Error:', cErr);

    const { data: patients, error: pErr } = await supabase.from('patients').select('*');
    console.log('Patients count:', patients?.length, 'Error:', pErr);

    const { data: appts, error: aErr } = await supabase.from('appointments').select('*');
    console.log('Appointments count:', appts?.length, 'Error:', aErr);

    const { data: convs, error: convErr } = await supabase.from('conversations').select('*');
    console.log('Conversations count:', convs?.length, 'Error:', convErr);

    // If clinic doesn't exist, insert it!
    if (!clinics || clinics.length === 0) {
      console.log('Seeding clinic into Supabase...');
      const insertRes = await supabase.from('clinics').upsert({
        id: CLINIC_CONFIG.id,
        name: CLINIC_CONFIG.name,
        phone: CLINIC_CONFIG.phone,
        address: CLINIC_CONFIG.address,
        license_number: CLINIC_CONFIG.licenseNumber,
        tax_number: CLINIC_CONFIG.taxNumber,
        google_calendar_id: process.env.GOOGLE_CALENDAR_ID,
      });
      console.log('Clinic seed result:', insertRes);
    }
  } catch (err) {
    console.error('Check failed:', err);
  }
}

check();
