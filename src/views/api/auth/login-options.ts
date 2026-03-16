import type { APIContext } from 'astro';
import { env } from '../../../lib/env/env.service';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { credentials } from '../../../db/schema';
import { findUserByIdentifier, getWebAuthnConfig, storeChallenge } from '../../../lib/auth/auth';
import { eq } from 'drizzle-orm';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  try {
    const body = await request.json();
    const identifier = body.identifier || body.email;

    if (!identifier) {
      return jsonError('Email or username is required');
    }

    const database = db();
    const config = getWebAuthnConfig(request.url, env);

    // Look up user by email or username
    const user = await findUserByIdentifier(database, identifier);

    if (!user) {
      return jsonError('Invalid email or credentials');
    }

    const userId = user.id;

    // Get user's credentials
    const userCredentials = await database
      .select()
      .from(credentials)
      .where(eq(credentials.userId, userId));

    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      allowCredentials: userCredentials.map((cred) => ({
        id: cred.credentialId,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      })),
      userVerification: 'preferred',
    });

    // Store challenge in cookie
    storeChallenge(cookies, options.challenge);

    return jsonResponse(options as unknown as Record<string, unknown>);
  } catch (err) {
    console.error('login-options error:', err);
    return jsonError('Internal server error', 500);
  }
}
