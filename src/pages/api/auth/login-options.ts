import type { APIContext } from 'astro';
import { env } from '../../../lib/env';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { db } from '../../../lib/get-db';
import { users, credentials } from '../../../db/schema';
import { normalizeEmail, getWebAuthnConfig, storeChallenge } from '../../../lib/auth';
import { eq } from 'drizzle-orm';

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  try {
    const body = await request.json();
    const { email: rawEmail } = body;

    if (!rawEmail) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const database = db();
    const email = normalizeEmail(rawEmail);
    const config = getWebAuthnConfig(request.url, env);

    // Look up user by email
    const userResult = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (userResult.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid email or credentials' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userId = userResult[0].id;

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

    return new Response(JSON.stringify(options), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('login-options error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
