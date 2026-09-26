// NashmiOps Enterprise (Phase 2) - Real-Time APM & Error Tracking Engine
// Centralized exception capturing, critical alerting, and audit logging for API routes & Webhooks

import { APMEvent, APMSeverity, APMContext } from '@/types';
import fs from 'fs';
import path from 'path';

const APM_LOG_DIR = path.join(process.cwd(), 'data');
const APM_LOG_FILE = path.join(APM_LOG_DIR, 'apm_events.json');

class APMManager {
  private events: APMEvent[] = [];
  private maxInMemoryEvents = 200;

  constructor() {
    this.hydrateFromDisk();
  }

  private hydrateFromDisk() {
    try {
      if (fs.existsSync(APM_LOG_FILE)) {
        const raw = fs.readFileSync(APM_LOG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.events = parsed;
        }
      }
    } catch (err) {
      console.warn('[APM] Could not hydrate existing events from disk:', err);
    }
  }

  private persistToDisk() {
    try {
      if (!fs.existsSync(APM_LOG_DIR)) {
        fs.mkdirSync(APM_LOG_DIR, { recursive: true });
      }
      fs.writeFileSync(APM_LOG_FILE, JSON.stringify(this.events.slice(-this.maxInMemoryEvents), null, 2), 'utf-8');
    } catch (err) {
      console.warn('[APM] Could not persist events to disk:', err);
    }
  }

  /**
   * Capture an unhandled exception or critical error
   */
  public captureException(error: Error | any, context?: APMContext): APMEvent {
    const errorName = error?.name || 'Error';
    const errorMessage = error?.message || String(error);
    const stackTrace = error?.stack || undefined;

    const event: APMEvent = {
      id: `apm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      severity: 'ERROR',
      message: errorMessage,
      error_name: errorName,
      stack_trace: stackTrace,
      context,
    };

    this.recordEvent(event);
    this.dispatchExternalAlert(event);
    return event;
  }

  /**
   * Capture a diagnostic, warning, or critical operational message
   */
  public captureMessage(
    message: string,
    severity: APMSeverity = 'INFO',
    context?: APMContext
  ): APMEvent {
    const event: APMEvent = {
      id: `apm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      severity,
      message,
      context,
    };

    this.recordEvent(event);
    if (severity === 'CRITICAL' || severity === 'ERROR') {
      this.dispatchExternalAlert(event);
    }
    return event;
  }

  private recordEvent(event: APMEvent) {
    this.events.push(event);
    if (this.events.length > this.maxInMemoryEvents) {
      this.events = this.events.slice(-this.maxInMemoryEvents);
    }
    this.persistToDisk();

    const prefix = `[APM ${event.severity}]`;
    if (event.severity === 'CRITICAL' || event.severity === 'ERROR') {
      console.error(`${prefix} ${event.message}`, event.context || '');
    } else if (event.severity === 'WARNING') {
      console.warn(`${prefix} ${event.message}`, event.context || '');
    } else {
      console.log(`${prefix} ${event.message}`);
    }
  }

  /**
   * Dispatch alert to Sentry / Ops Webhook if configured in environment
   */
  private async dispatchExternalAlert(event: APMEvent) {
    const webhookUrl = process.env.APM_ALERT_WEBHOOK_URL || process.env.SLACK_ALERT_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'NashmiOps APM Engine',
          severity: event.severity,
          message: event.message,
          timestamp: event.timestamp,
          route: event.context?.route,
          endpoint: event.context?.endpoint,
          patientPhone: event.context?.patientPhone,
        }),
      });
    } catch (dispatchErr) {
      console.warn('[APM] Failed to dispatch webhook alert:', dispatchErr);
    }
  }

  public getEvents(limit = 50): APMEvent[] {
    return this.events.slice(-limit).reverse();
  }

  public clearEvents(): void {
    this.events = [];
    this.persistToDisk();
  }
}

export const apm = new APMManager();

export function captureException(error: Error | any, context?: APMContext): APMEvent {
  return apm.captureException(error, context);
}

export function captureMessage(
  message: string,
  severity?: APMSeverity,
  context?: APMContext
): APMEvent {
  return apm.captureMessage(message, severity, context);
}

export function getRecentAPMEvents(limit?: number): APMEvent[] {
  return apm.getEvents(limit);
}
