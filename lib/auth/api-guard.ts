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

  // 1. Strict Production Guard: Mandatory Environment Secrets
  // In production, failure to configure CRON_SECRET or API_SECRET_KEY is a fatal misconfiguration
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

  // 2. Token Matching Functions
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

  // 3. Official Vercel Cron Header Recognition
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

  // 4. Check Bearer token in Authorization header
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (isAuthorizedCronToken(token) || isAuthorizedApiToken(token)) {
      return { authorized: true, reason: 'BEARER_TOKEN_AUTHENTICATED' };
    }
  } else if (authHeader && (isAuthorizedCronToken(authHeader) || isAuthorizedApiToken(authHeader))) {
    return { authorized: true, reason: 'DIRECT_AUTH_TOKEN_AUTHENTICATED' };
  }

  // 5. Check direct custom headers
  if (isAuthorizedApiToken(xApiKey) || isAuthorizedCronToken(xCronSecret)) {
    return { authorized: true, reason: 'CUSTOM_KEY_AUTHENTICATED' };
  }

  // 6. Strict Non-Production Local Development Isolation
  // Completely forbidden in production, staging, and preview deployments to eliminate SSRF and spoofing
  const host = req.headers.get('host') || '';
  const isStrictLocalHost = host.includes('localhost') || host.includes('127.0.0.1');
  const vercelEnv = process.env.VERCEL_ENV;
  const isStagingOrPreview = vercelEnv === 'preview' || vercelEnv === 'staging';

  if (!isProduction && !isStagingOrPreview && isStrictLocalHost) {
    const secFetchSite = req.headers.get('sec-fetch-site') || '';
    // Allow local browser same-origin UI navigation without exposing external bypasses
    if (secFetchSite === 'same-origin') {
      return { authorized: true, reason: 'LOCAL_DEV_SAME_ORIGIN' };
    }
  }

  // 7. Unauthorized Access Block (HTTP 401)
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
