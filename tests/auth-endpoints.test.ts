import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { createTestDb } from './test-db';
import { users, credentials, bannedIps } from '../src/db/schema';
import { eq } from 'drizzle-orm';

// Mock external boundaries only — email sending, city config, env, instance features

vi.mock('../src/lib/auth/magic-link.server', () => ({
  sendMagicLinkEmail: vi.fn(),
}));

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: () => ({
    display_name: 'Test City',
    instance_type: 'wiki',
    locale: 'en',
    locales: ['en'],
    domain: 'test.whereto.bike',
    url: 'https://test.whereto.bike',
    cdn_url: 'https://test.whereto.bike',
    videos_cdn_url: 'https://test.whereto.bike',
    plausible_domain: 'test.whereto.bike',
    site_title_html: 'Test City',
    timezone: 'UTC',
  }),
  isBlogInstance: () => false,
  isClubInstance: () => false,
}));

vi.mock('../src/lib/config/instance-features', () => ({
  getInstanceFeatures: () => ({
    allowsRegistration: true,
    allowsGuestAccess: true,
    hasRoutes: true,
    hasRides: false,
    hasEvents: true,
    hasPlaces: true,
    hasGuides: true,
    hasPaths: true,
    hasEnrichedEvents: false,
    allowsReactions: true,
    showsLicenseNotice: true,
    showsContributeLink: true,
  }),
}));

vi.mock('../src/lib/env/env.service', () => ({
  env: { GIT_BRANCH: 'main', GITHUB_TOKEN: 'test' },
}));

let testDb: ReturnType<typeof createTestDb>;

// Mock the db() function to return our test database
vi.mock('../src/lib/get-db', () => ({
  db: () => testDb.db,
}));

afterAll(() => {
  testDb?.cleanup();
});

function makeRequest(body: object, url = 'http://localhost/api/auth/test', headers?: Record<string, string>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function makeContext(request: Request, overrides: Record<string, unknown> = {}) {
  return {
    request,
    url: new URL(request.url),
    cookies: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    },
    ...overrides,
  } as any;
}

describe('signup endpoint', () => {
  beforeEach(() => {
    testDb?.cleanup();
    testDb = createTestDb();
    vi.clearAllMocks();
  });

  it('creates a new user with valid email', async () => {
    // Seed a first user so isFirstUser() returns false
    await testDb.db.insert(users).values({
      id: 'existing-admin',
      email: 'admin@test.com',
      username: 'admin',
      role: 'admin',
      createdAt: new Date().toISOString(),
    });

    const { POST } = await import('../src/views/api/auth/signup');
    const request = makeRequest({ email: 'new@test.com' }, 'http://localhost/api/auth/signup');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.flow).toBe('verify-email');
    expect(data.username).toBe('new');

    // Verify user was actually created in the database
    const [created] = await testDb.db.select().from(users).where(eq(users.email, 'new@test.com'));
    expect(created).toBeDefined();
    expect(created.role).toBe('editor');
    expect(created.email).toBe('new@test.com');
  });

  it('returns passkey flow for existing user with passkey', async () => {
    const userId = 'user-with-passkey';
    await testDb.db.insert(users).values({
      id: userId,
      email: 'passkey@test.com',
      username: 'passkeyuser',
      role: 'editor',
      createdAt: new Date().toISOString(),
    });
    await testDb.db.insert(credentials).values({
      id: 'cred-1',
      userId,
      credentialId: 'cred-id-123',
      publicKey: Buffer.from('fake-key'),
      counter: 0,
      createdAt: new Date().toISOString(),
    });

    const { POST } = await import('../src/views/api/auth/signup');
    const request = makeRequest({ email: 'passkey@test.com' }, 'http://localhost/api/auth/signup');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.flow).toBe('passkey');
  });

  it('sends magic link for existing user without passkey', async () => {
    await testDb.db.insert(users).values({
      id: 'user-no-passkey',
      email: 'nopasskey@test.com',
      username: 'nopasskey',
      role: 'editor',
      createdAt: new Date().toISOString(),
    });

    const { sendMagicLinkEmail } = await import('../src/lib/auth/magic-link.server');
    const { POST } = await import('../src/views/api/auth/signup');
    const request = makeRequest({ email: 'nopasskey@test.com' }, 'http://localhost/api/auth/signup');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.flow).toBe('magic-link');
    expect(sendMagicLinkEmail).toHaveBeenCalledOnce();
  });

  it('returns 400 when no email or identifier provided', async () => {
    const { POST } = await import('../src/views/api/auth/signup');
    const request = makeRequest({}, 'http://localhost/api/auth/signup');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Email or username is required');
  });

  it('returns 404 for username-only signup when user does not exist', async () => {
    const { POST } = await import('../src/views/api/auth/signup');
    const request = makeRequest({ identifier: 'nonexistent' }, 'http://localhost/api/auth/signup');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('No account found with that username');
  });

  it('rate limits after too many attempts', async () => {
    // Seed a first user
    await testDb.db.insert(users).values({
      id: 'existing-admin',
      email: 'admin@test.com',
      username: 'admin',
      role: 'admin',
      createdAt: new Date().toISOString(),
    });

    const { POST } = await import('../src/views/api/auth/signup');
    const { recordAttempt } = await import('../src/lib/auth/rate-limit');

    // Fill up the rate limit (5 per hour)
    for (let i = 0; i < 5; i++) {
      await recordAttempt(testDb.db as any, 'signup', ['ratelimited@test.com']);
    }

    const request = makeRequest({ email: 'ratelimited@test.com' }, 'http://localhost/api/auth/signup');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toBe('Too many attempts. Please try again later.');
  });

  it('redirects to setup when no users exist', async () => {
    const { POST } = await import('../src/views/api/auth/signup');
    const request = makeRequest({ email: 'first@test.com' }, 'http://localhost/api/auth/signup');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Please use the setup page to create the first account');
  });
});

describe('email-login endpoint', () => {
  beforeEach(() => {
    testDb?.cleanup();
    testDb = createTestDb();
    vi.clearAllMocks();
  });

  it('sends magic link for existing user', async () => {
    await testDb.db.insert(users).values({
      id: 'user-email',
      email: 'test@test.com',
      username: 'testuser',
      role: 'editor',
      createdAt: new Date().toISOString(),
    });

    const { sendMagicLinkEmail } = await import('../src/lib/auth/magic-link.server');
    const { POST } = await import('../src/views/api/auth/email-login');
    const request = makeRequest({ email: 'test@test.com' }, 'http://localhost/api/auth/email-login');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(sendMagicLinkEmail).toHaveBeenCalledOnce();
  });

  it('returns constant success response for unknown emails', async () => {
    const { sendMagicLinkEmail } = await import('../src/lib/auth/magic-link.server');
    const { POST } = await import('../src/views/api/auth/email-login');
    const request = makeRequest({ email: 'unknown@test.com' }, 'http://localhost/api/auth/email-login');
    const res = await POST(makeContext(request));

    // Same success response regardless of whether email exists
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    // But no email was actually sent
    expect(sendMagicLinkEmail).not.toHaveBeenCalled();
  });

  it('returns 400 when no email provided', async () => {
    const { POST } = await import('../src/views/api/auth/email-login');
    const request = makeRequest({}, 'http://localhost/api/auth/email-login');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Email is required');
  });

  it('returns 400 for invalid email', async () => {
    const { POST } = await import('../src/views/api/auth/email-login');
    const request = makeRequest({ email: 'notanemail' }, 'http://localhost/api/auth/email-login');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid email address');
  });

  it('rate limits after 3 attempts per hour', async () => {
    const { POST } = await import('../src/views/api/auth/email-login');
    const { recordAttempt } = await import('../src/lib/auth/rate-limit');

    // Fill rate limit for this email
    for (let i = 0; i < 3; i++) {
      await recordAttempt(testDb.db as any, 'email-login', ['ratelimited@test.com']);
    }

    const request = makeRequest({ email: 'ratelimited@test.com' }, 'http://localhost/api/auth/email-login');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toBe('Too many login attempts. Please try again later.');
  });
});

describe('guest endpoint', () => {
  beforeEach(() => {
    testDb?.cleanup();
    testDb = createTestDb();
    vi.clearAllMocks();
  });

  it('creates a guest user with pseudonym', async () => {
    const { POST } = await import('../src/views/api/auth/guest');
    const request = makeRequest({}, 'http://localhost/api/auth/guest', {
      'x-forwarded-for': '10.0.0.1',
    });
    const context = makeContext(request);
    const res = await POST(context);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.username).toMatch(/^cyclist-[a-f0-9]{4}$/);

    // Verify session cookie was set
    expect(context.cookies.set).toHaveBeenCalled();
  });

  it('creates a guest user in the database', async () => {
    const { POST } = await import('../src/views/api/auth/guest');
    const request = makeRequest({}, 'http://localhost/api/auth/guest', {
      'x-forwarded-for': '10.0.0.2',
    });
    const res = await POST(makeContext(request));

    expect(res.status).toBe(200);

    const allUsers = await testDb.db.select().from(users);
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0].role).toBe('guest');
    expect(allUsers[0].ipAddress).toBe('10.0.0.2');
    expect(allUsers[0].username).toMatch(/^cyclist-[a-f0-9]{4}$/);
  });

  it('rejects banned IP', async () => {
    // Create a user and ban their IP
    await testDb.db.insert(users).values({
      id: 'banned-user',
      email: null,
      username: 'banned',
      role: 'guest',
      createdAt: new Date().toISOString(),
      ipAddress: '10.0.0.99',
    });
    await testDb.db.insert(bannedIps).values({
      ip: '10.0.0.99',
      userId: 'banned-user',
      bannedAt: new Date().toISOString(),
    });

    const { POST } = await import('../src/views/api/auth/guest');
    const request = makeRequest({}, 'http://localhost/api/auth/guest', {
      'x-forwarded-for': '10.0.0.99',
    });
    const res = await POST(makeContext(request));

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('Unable to create account');
  });

  it('rate limits guest creation per IP', async () => {
    const { POST } = await import('../src/views/api/auth/guest');
    const { recordAttempt } = await import('../src/lib/auth/rate-limit');

    // Fill rate limit (5 per hour)
    for (let i = 0; i < 5; i++) {
      await recordAttempt(testDb.db as any, 'guest-create', ['ip:10.0.0.50']);
    }

    const request = makeRequest({}, 'http://localhost/api/auth/guest', {
      'x-forwarded-for': '10.0.0.50',
    });
    const res = await POST(makeContext(request));

    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toBe('Too many accounts created. Please try again later.');
  });
});

describe('login endpoint', () => {
  beforeEach(() => {
    testDb?.cleanup();
    testDb = createTestDb();
    vi.clearAllMocks();
  });

  it('returns error when credential is missing', async () => {
    const { POST } = await import('../src/views/api/auth/login');
    const request = makeRequest({ identifier: 'test@test.com' }, 'http://localhost/api/auth/login');
    const res = await POST(makeContext(request));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing required fields');
  });

  it('returns error when challenge cookie is missing', async () => {
    const { POST } = await import('../src/views/api/auth/login');
    const request = makeRequest(
      { identifier: 'test@test.com', credential: { id: 'fake', response: {} } },
      'http://localhost/api/auth/login',
    );
    const context = makeContext(request);
    context.cookies.get = vi.fn().mockReturnValue(undefined);
    const res = await POST(context);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Challenge expired, please try again');
  });
});
