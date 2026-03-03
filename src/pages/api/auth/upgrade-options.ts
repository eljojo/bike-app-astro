import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import {
  getWebAuthnConfig,
  storeChallenge,
} from '../../../lib/auth';

export const prerender = false;

export async function POST({ request, cookies, locals }: APIContext) {
  const user = locals.user;
  if (!user || user.role !== 'guest') {
    return new Response(JSON.stringify({ error: 'Only guests can upgrade' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { email } = await request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
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

    return new Response(JSON.stringify(options), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('upgrade-options error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
