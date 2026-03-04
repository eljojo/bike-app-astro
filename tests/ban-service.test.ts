import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ban-service', () => {
  const dbPath = path.join(import.meta.dirname, '.test-ban.db');
  let database: any;

  beforeEach(async () => {
    // Clean up any leftover DB
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    const { createLocalDb } = await import('../src/db/local');
    database = createLocalDb(dbPath);

    const { users } = await import('../src/db/schema');
    await database.insert(users).values({
      id: 'guest-1', email: null, username: 'anon-fox', role: 'guest',
      createdAt: new Date().toISOString(), ipAddress: '1.2.3.4',
    });
    await database.insert(users).values({
      id: 'editor-1', email: 'ed@test.com', username: 'editor', role: 'editor',
      createdAt: new Date().toISOString(),
    });
  });

  afterAll(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const f = dbPath + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('banUser sets bannedAt on user', async () => {
    const { banUser } = await import('../src/lib/ban-service');
    const { users } = await import('../src/db/schema');
    const { eq } = await import('drizzle-orm');

    await banUser(database, 'guest-1');

    const [user] = await database.select().from(users).where(eq(users.id, 'guest-1'));
    expect(user.bannedAt).toBeTruthy();
  });

  it('banUser adds IP to bannedIps for guests', async () => {
    const { banUser } = await import('../src/lib/ban-service');
    const { bannedIps } = await import('../src/db/schema');

    await banUser(database, 'guest-1');

    const ips = await database.select().from(bannedIps).all();
    expect(ips).toHaveLength(1);
    expect(ips[0].ip).toBe('1.2.3.4');
  });

  it('banUser does not add IP for editors', async () => {
    const { banUser } = await import('../src/lib/ban-service');
    const { bannedIps } = await import('../src/db/schema');

    await banUser(database, 'editor-1');

    const ips = await database.select().from(bannedIps).all();
    expect(ips).toHaveLength(0);
  });

  it('unbanUser clears bannedAt and removes IP', async () => {
    const { banUser, unbanUser } = await import('../src/lib/ban-service');
    const { users, bannedIps } = await import('../src/db/schema');
    const { eq } = await import('drizzle-orm');

    await banUser(database, 'guest-1');
    await unbanUser(database, 'guest-1');

    const [user] = await database.select().from(users).where(eq(users.id, 'guest-1'));
    expect(user.bannedAt).toBeNull();

    const ips = await database.select().from(bannedIps).all();
    expect(ips).toHaveLength(0);
  });

  it('isIpBanned returns true for banned IP', async () => {
    const { banUser, isIpBanned } = await import('../src/lib/ban-service');

    await banUser(database, 'guest-1');
    expect(await isIpBanned(database, '1.2.3.4')).toBe(true);
  });

  it('isIpBanned returns false for clean IP', async () => {
    const { isIpBanned } = await import('../src/lib/ban-service');
    expect(await isIpBanned(database, '5.6.7.8')).toBe(false);
  });
});
