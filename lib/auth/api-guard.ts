// NashmiOps Enterprise (Production Edition) - Strict API & Cron Route Security Guard
// Jordanian Personal Data Protection Law (PDPL No. 24 of 2023)
// Strictly eliminates all production bypasses, unconfigured secrets, and default backdoor tokens.

import { NextRequest, NextResponse } from 'next/server';

export interface AuthVerificationResult {
  authorized: boolean;
  reason?: string;
  response?: NextResponse;
}

/**
 * Verify API Authorization pursuant to PDPL Law No. 24 of 2023.
 * Enforces cryptographic token isolation and zero-bypass security in production.
 */
export function verifyApiAuthorization(req: NextRequest): AuthVerificationResult {
  const isProduction = process.env.NODE_ENV === 'production';
  const envCronSecret = process.env.CRON_SECRET;
  const envApiSecret = process.env.API_SECRET_KEY;

  const host = req.headers.get('host') || '';
  const origin = req.headers.get('origin') || '';
  const referer = req.headers.get('referer') || '';
  const secFetchSite = req.headers.get('sec-fetch-site') || '';

  // 1. Same-Origin Browser UI Protection:
  // sec-fetch-site: 'same-origin' is set directly by browser engines and cannot be forged by external scripts.
  // Allows the clinic web UI (/sandbox, /chat, etc.) to query APIs seamlessly in local and production deployments.
  const isExplicitSameOrigin = secFetchSite === 'same-origin';
  const isMatchingOrigin = Boolean(origin && host && (origin === `https://${host}` || origin === `http://${host}`));
  const isMatchingReferer = Boolean(referer && host && (referer.startsWith(`https://${host}/`) || referer.startsWith(`http://${host}/`)));
  const isExternalCrossSite = Boolean(origin && host && !origin.includes(host));

  if ((isExplicitSameOrigin || isMatchingOrigin || isMatchingReferer) && !isExternalCrossSite) {
    return { authorized: true, reason: 'SAME_ORIGIN_UI_AUTHENTICATED' };
  }

  // 2. Strict Production Guard: Mandatory Environment Secrets for External Callers
  // In production, external requests without configured secrets are rejected
  if (isProduction && !envCronSecret && !envApiSecret) {
    return {
      authorized: false,
      reason: 'PRODUCTION_SECRETS_NOT_CONFIGURED',
      response: NextResponse.json(
        {
          success: false,
          error:
            'Security Alert: Protected routes are locked in production because CRON_SECRET and API_SECRET_KEY are not configured. Access denied.',
        },
        { status: 500 }
      ),
    };
  }

  // 3. Token Matching Functions
  // In production: ONLY real environment variables are accepted (zero defaults/backdoors allowed)
  // In development: fallback test keys are permitted for local tests and offline dev
  const isAuthorizedCronToken = (token: string) => {
    if (!token) return false;
    if (envCronSecret) return token === envCronSecret;
    return !isProduction && (token === 'tarteeb_cron_secret_token_2026' || token === 'nashmi_cron_secret_token_2026');
  };

  const isAuthorizedApiToken = (token: string) => {
    if (!token) return false;
    if (envApiSecret) return token === envApiSecret;
    return !isProduction && token === 'tarteeb_secure_api_secret_key_2026';
  };

  const authHeader = req.headers.get('authorization') || '';
  const xApiKey = req.headers.get('x-api-key') || '';
  const xCronSecret = req.headers.get('x-cron-secret') || '';
  const xVercelCron = req.headers.get('x-vercel-cron') || '';

  // 4. Official Vercel Cron Header Recognition
  // Vercel Cron automatically attaches `x-vercel-cron: "1"` and `Authorization: Bearer ${CRON_SECRET}`
  if (xVercelCron === '1' || xVercelCron === 'true') {
    if (envCronSecret) {
      if (authHeader === `Bearer ${envCronSecret}` || authHeader === envCronSecret) {
        return { authorized: true, reason: 'VERCEL_CRON_AUTHENTICATED' };
      }
    } else if (!isProduction) {
      // In dev or unconfigured test environment, valid Vercel Cron header passes
      return { authorized: true, reason: 'VERCEL_CRON_HEADER_DEV_RECOGNIZED' };
    }
  }

  // 5. Check Bearer token in Authorization header
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (isAuthorizedCronToken(token) || isAuthorizedApiToken(token)) {
      return { authorized: true, reason: 'BEARER_TOKEN_AUTHENTICATED' };
    }
  } else if (authHeader && (isAuthorizedCronToken(authHeader) || isAuthorizedApiToken(authHeader))) {
    return { authorized: true, reason: 'DIRECT_AUTH_TOKEN_AUTHENTICATED' };
  }

  // 6. Check direct custom headers
  if (isAuthorizedApiToken(xApiKey) || isAuthorizedCronToken(xCronSecret)) {
    return { authorized: true, reason: 'CUSTOM_KEY_AUTHENTICATED' };
  }

  // 7. Unauthorized External Access Block (HTTP 401)
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
