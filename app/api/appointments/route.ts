// NashmiOps Enterprise (MVP Edition) - Appointments API Endpoint
// Fetches persisted appointments from Supabase & durable store on page load

import { NextRequest, NextResponse } from 'next/server';
import { getAllAppointments, createAppointment, tenantStore } from '@/lib/db/supabase';
import { CLINIC_CONFIG } from '@/lib/config/constants';
import { verifyApiAuthorization } from '@/lib/auth/api-guard';
import { captureException } from '@/lib/monitoring/apm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = verifyApiAuthorization(req);
  if (!auth.authorized) {
    return auth.response!;
  }

  try {
    const { searchParams } = new URL(req.url);
    const clinicId = searchParams.get('clinicId') || CLINIC_CONFIG.id;
    const appointments = await getAllAppointments(clinicId);

    return NextResponse.json({
      success: true,
      count: appointments?.length || 0,
      appointments: appointments || [],
      practitioners: tenantStore.practitioners,
      dental_chairs: tenantStore.dental_chairs,
      receptionist_alerts: tenantStore.receptionist_alerts,
    });
  } catch (err: any) {
    captureException(err, { route: '/api/appointments', endpoint: 'GET' });
    console.error('[API Appointments GET] Error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Failed to fetch appointments',
        appointments: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = verifyApiAuthorization(req);
  if (!auth.authorized) {
    return auth.response!;
  }

  try {
    const body = await req.json();
    const {
      patientId,
      patientName,
      patientPhone,
      serviceType,
      startTime,
      endTime,
      sterilizationEndTime,
      practitionerId,
      practitionerName,
      chairId,
      chairNumber,
      notes,
    } = body;

    if (!patientName || !startTime) {
      return NextResponse.json({ success: false, error: 'patientName and startTime are required' }, { status: 400 });
    }

    const appt = await createAppointment({
      clinicId: body.clinicId || CLINIC_CONFIG.id,
      patientId: patientId || `pat-${Date.now()}`,
      patientName,
      patientPhone: patientPhone || '+962791234567',
      serviceType: serviceType || 'consultation',
      startTime,
      endTime: endTime || new Date(new Date(startTime).getTime() + 45 * 60000).toISOString(),
      sterilizationEndTime: sterilizationEndTime || new Date(new Date(startTime).getTime() + 60 * 60000).toISOString(),
      practitionerId,
      practitionerName,
      chairId,
      chairNumber,
      notes,
    });

    return NextResponse.json({
      success: true,
      appointment: appt,
    });
  } catch (err: any) {
    if (err?.code === 'DOUBLE_BOOKING_CONFLICT' || err?.message?.includes('DOUBLE_BOOKING_CONFLICT')) {
      return NextResponse.json({ success: false, conflict: true, error: err.message }, { status: 409 });
    }
    captureException(err, { route: '/api/appointments', endpoint: 'POST' });
    console.error('[API Appointments POST] Error:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Failed to create appointment' }, { status: 500 });
  }
}
