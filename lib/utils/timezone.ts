// NashmiOps Enterprise (MVP Edition) - Jordanian Timezone Utilities
// Standardized on Asia/Amman using date-fns-tz for resilient Vercel Serverless UTC handling

import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';
export { toZonedTime, fromZonedTime, format };

export const AMMAN_TIMEZONE = 'Asia/Amman';

/**
 * Get current timestamp mapped to Asia/Amman timezone
 */
export function getAmmanNow(): Date {
  return toZonedTime(new Date(), AMMAN_TIMEZONE);
}

/**
 * Format a Date or ISO string into Amman YYYY-MM-DD
 */
export function formatAmmanDate(date: Date | string | number, formatPattern = 'yyyy-MM-dd'): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return format(toZonedTime(d, AMMAN_TIMEZONE), formatPattern, { timeZone: AMMAN_TIMEZONE });
}

/**
 * Format a Date or ISO string into Amman HH:mm
 */
export function formatAmmanTime(date: Date | string | number, formatPattern = 'HH:mm'): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return format(toZonedTime(d, AMMAN_TIMEZONE), formatPattern, { timeZone: AMMAN_TIMEZONE });
}

/**
 * Parse date string (YYYY-MM-DD) and time string (HH:mm) directly in Asia/Amman
 * Returns exact UTC Date object representing that local Amman time
 */
export function parseAmmanDateTime(dateStr: string, timeStr: string): Date {
  const cleanTime = timeStr.trim().length === 5 ? `${timeStr.trim()}:00` : timeStr.trim();
  const isoString = `${dateStr.trim()}T${cleanTime}`;
  return fromZonedTime(isoString, AMMAN_TIMEZONE);
}

/**
 * Format date for friendly Jordanian Arabic display (e.g. "11:30 ص" or "2026/10/05")
 */
export function formatAmmanFriendly(date: Date | string | number): {
  dateAr: string;
  timeAr: string;
  fullAr: string;
} {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const zoned = toZonedTime(d, AMMAN_TIMEZONE);
  const dateAr = format(zoned, 'yyyy/MM/dd', { timeZone: AMMAN_TIMEZONE });
  const timeAr = d.toLocaleTimeString('ar-JO', {
    timeZone: AMMAN_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return {
    dateAr,
    timeAr,
    fullAr: `${dateAr} ${timeAr}`,
  };
}
