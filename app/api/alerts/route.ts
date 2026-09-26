// NashmiOps Enterprise (MVP Edition) - Receptionist Live Alerts API
// Real-time synchronization and management of clinical emergency & outbound dispatch failures

import { NextRequest, NextResponse } from 'next/server';
import {
  getReceptionistAlerts,
  broadcastReceptionistAlert,
  dismissReceptionistAlert,
} from '@/lib/db/supabase';
import { CLINIC_CONFIG } from '@/lib/config/constants';
import { captureException } from '@/lib/monitoring/apm';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const clinicId = searchParams.get('clinicId') || CLINIC_CONFIG.id;
    const alerts = getReceptionistAlerts(clinicId);

    return NextResponse.json({
      success: true,
      count: alerts.length,
      alerts,
    });
  } catch (err: any) {
    captureException(err, { route: '/api/alerts', endpoint: 'GET' });
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch receptionist alerts' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, alertId, alert } = body;

    if (action === 'dismiss' && alertId) {
      const dismissed = dismissReceptionistAlert(alertId);
      return NextResponse.json({ success: true, dismissed });
    }

    if (alert) {
      const created = await broadcastReceptionistAlert(alert);
      return NextResponse.json({ success: true, alert: created });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid alert action or payload' },
      { status: 400 }
    );
  } catch (err: any) {
    captureException(err, { route: '/api/alerts', endpoint: 'POST' });
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to handle alert request' },
      { status: 500 }
    );
  }
}
