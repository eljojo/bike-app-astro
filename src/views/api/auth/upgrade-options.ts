import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import {
  getWebAuthnConfig,
  storeChallenge,
  validateSession,
} from '../../../lib/auth';
import { db } from '../../../lib/get-db';
import { jsonResponse, jsonError } from '../../../lib/api-response';
import { isBlogInstance } from '../../../lib/city-config';

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  if (isBlogInstance()) {
    return new Response(null, { status: 404 });
  }
  // Upgrade endpoints are under /api/auth/ which the middleware skips,
  // so we must validate the session ourselves.
  const token = cookies.get('session_token')?.value;
  const user = token ? await validateSession(db(), token) : null;
  if (!user || user.role !== 'guest') {
    return jsonError('Only guests can upgrade', 401);
  }

  try {
    const { email } = await request.json();
    if (!email) {
      return jsonError('Email is required');
    }

    const config = getWebAuthnConfig(request.url, env);

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userName: email,
      userDisplayName: user.username,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    storeChallenge(cookies, options.challenge);

    return jsonResponse(options as unknown as Record<string, unknown>);
  } catch (err) {
    console.error('upgrade-options error:', err);
    return jsonError('Internal server error', 500);
  }
}
