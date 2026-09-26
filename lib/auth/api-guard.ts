// NashmiOps Enterprise (MVP Edition) - API Route Protection & PDPL Guard
// Jordanian Personal Data Protection Law (PDPL No. 24 of 2023)

import { NextRequest, NextResponse } from 'next/server';

export interface AuthVerificationResult {
  authorized: boolean;
  reason?: string;
  response?: NextResponse;
}

/**
 * Verify API Authorization pursuant to PDPL Law No. 24 of 2023.
 * Checks Bearer token or custom headers against CRON_SECRET / API_SECRET_KEY.
 * Allows local sandbox simulations and in-browser Sandbox testing seamlessly.
 */
export function verifyApiAuthorization(req: NextRequest): AuthVerificationResult {
  const envCronSecret = process.env.CRON_SECRET;
  const envApiSecret = process.env.API_SECRET_KEY;

  // If env variables are explicitly defined, use them strictly; otherwise allow default dev secret in non-production
  const cronSecret = envCronSecret || (process.env.NODE_ENV !== 'production' ? 'tarteeb_cron_secret_token_2026' : undefined);
  const apiSecret = envApiSecret || (process.env.NODE_ENV !== 'production' ? 'tarteeb_secure_api_secret_key_2026' : undefined);

  const authHeader = req.headers.get('authorization') || '';
  const xApiKey = req.headers.get('x-api-key') || '';
  const xCronSecret = req.headers.get('x-cron-secret') || '';
  const xVercelCron = req.headers.get('x-vercel-cron') || '';
  const isSimulation =
    req.headers.get('x-sandbox-simulation') === 'true' ||
    req.headers.get('x-client-simulation') === 'true';

  // 1. Official Vercel Cron Header Recognition
  // Vercel Cron automatically attaches `x-vercel-cron: "1"` and `Authorization: Bearer ${CRON_SECRET}`
  if (xVercelCron === '1' || xVercelCron === 'true') {
    if (envCronSecret) {
      if (authHeader === `Bearer ${envCronSecret}`) {
        return { authorized: true, reason: 'VERCEL_CRON_AUTHENTICATED' };
      }
    } else {
      // In dev or unconfigured test environment, valid Vercel Cron header passes
      return { authorized: true, reason: 'VERCEL_CRON_HEADER_RECOGNIZED' };
    }
  }

  // 2. Check Bearer token in Authorization header
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if ((cronSecret && token === cronSecret) || (apiSecret && token === apiSecret)) {
      return { authorized: true, reason: 'BEARER_TOKEN_AUTHENTICATED' };
    }
  }

  // 3. Check direct custom headers
  if ((apiSecret && xApiKey === apiSecret) || (cronSecret && xCronSecret === cronSecret)) {
    return { authorized: true, reason: 'CUSTOM_KEY_AUTHENTICATED' };
  }

  // 4. Strict Local Development / Controlled Sandbox Simulation
  // Completely prohibits header-spoofing referer bypass in production
  const host = req.headers.get('host') || '';
  const secFetchSite = req.headers.get('sec-fetch-site') || '';

  const isDevEnvironment = process.env.NODE_ENV !== 'production';
  const isLocalOrigin = host.includes('localhost') || host.includes('127.0.0.1');

  // Allow same-origin local development requests or explicit non-production sandbox header
  if (isDevEnvironment && isLocalOrigin && (secFetchSite === 'same-origin' || isSimulation)) {
    return { authorized: true, reason: 'LOCAL_DEV_AUTHENTICATED' };
  }

  // 4. Unauthorized Access Block (HTTP 401)
  return {
    authorized: false,
    reason: 'UNAUTHORIZED_PDPL_VIOLATION',
    response: NextResponse.json(
      {
        success: false,
        error:
          'Unauthorized: Access to patient data and clinic operations is strictly restricted pursuant to Jordanian Personal Data Protection Law (PDPL No. 24 of 2023). Please provide a valid Authorization Bearer token or API secret key.',
      },
      { status: 401 }
    ),
  };
}
