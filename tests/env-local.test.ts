import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DB_PATH = path.join(import.meta.dirname, '.test-env-local.db');
const TEST_UPLOADS_DIR = path.join(import.meta.dirname, '.test-env-uploads');

afterAll(() => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const walPath = TEST_DB_PATH + '-wal';
  const shmPath = TEST_DB_PATH + '-shm';
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  if (fs.existsSync(TEST_UPLOADS_DIR)) fs.rmSync(TEST_UPLOADS_DIR, { recursive: true });
});

describe('local environment', () => {
  it('creates an env object with DB (drizzle instance)', async () => {
    process.env.LOCAL_DB_PATH = TEST_DB_PATH;
    process.env.LOCAL_UPLOADS_DIR = TEST_UPLOADS_DIR;
    const { createLocalEnv } = await import('../src/lib/env/env.adapter-local');
    const localEnv = createLocalEnv();
    expect(localEnv).toHaveProperty('DB');
    // DB should be a drizzle instance (has select, insert, etc.)
    expect(typeof (localEnv.DB as Record<string, unknown>).select).toBe('function');
    expect(typeof (localEnv.DB as Record<string, unknown>).insert).toBe('function');
  });

  it('creates an env object with BUCKET (local storage)', async () => {
    process.env.LOCAL_DB_PATH = TEST_DB_PATH;
    process.env.LOCAL_UPLOADS_DIR = TEST_UPLOADS_DIR;
    const { createLocalEnv } = await import('../src/lib/env/env.adapter-local');
    const localEnv = createLocalEnv();
    expect(localEnv).toHaveProperty('BUCKET');
    expect(typeof localEnv.BUCKET.head).toBe('function');
    expect(typeof localEnv.BUCKET.put).toBe('function');
    expect(typeof localEnv.BUCKET.delete).toBe('function');
  });

  it('reads string env vars from process.env', async () => {
    const original = { ...process.env };
    process.env.LOCAL_DB_PATH = TEST_DB_PATH;
    process.env.LOCAL_UPLOADS_DIR = TEST_UPLOADS_DIR;
    process.env.WEBAUTHN_RP_ID = 'test-localhost';
    process.env.WEBAUTHN_RP_NAME = 'test-app';
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:9999';
    try {
      const { createLocalEnv } = await import('../src/lib/env/env.adapter-local');
      const localEnv = createLocalEnv();
      expect(localEnv.WEBAUTHN_RP_ID).toBe('test-localhost');
      expect(localEnv.WEBAUTHN_RP_NAME).toBe('test-app');
      expect(localEnv.WEBAUTHN_ORIGIN).toBe('http://localhost:9999');
    } finally {
      process.env.WEBAUTHN_RP_ID = original.WEBAUTHN_RP_ID;
      process.env.WEBAUTHN_RP_NAME = original.WEBAUTHN_RP_NAME;
      process.env.WEBAUTHN_ORIGIN = original.WEBAUTHN_ORIGIN;
    }
  });

  it('sets ENVIRONMENT to local by default', async () => {
    process.env.LOCAL_DB_PATH = TEST_DB_PATH;
    process.env.LOCAL_UPLOADS_DIR = TEST_UPLOADS_DIR;
    delete process.env.ENVIRONMENT;
    const { createLocalEnv } = await import('../src/lib/env/env.adapter-local');
    const localEnv = createLocalEnv();
    expect(localEnv.ENVIRONMENT).toBe('local');
  });
});
