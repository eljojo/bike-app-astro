import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import {
  getWebAuthnConfig,
  storeChallenge,
} from '../../../lib/auth';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

export async function POST({ request, cookies, locals }: APIContext) {
  const user = locals.user;
  if (!user || user.role !== 'guest') {
    return jsonError('Only guests can upgrade');
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
      userDisplayName: user.displayName,
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
