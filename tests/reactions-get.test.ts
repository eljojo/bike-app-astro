import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.join(import.meta.dirname, '.test-reactions-get.db');

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function setup() {
  const { createLocalDb } = await import('../src/db/local');
  const database = createLocalDb(DB_PATH);
  const { reactions, users } = await import('../src/db/schema');
  const { eq, and, count } = await import('drizzle-orm');
  return { database, reactions, users, eq, and, count };
}

async function ensureUser(database: any, users: any, userId: string) {
  const existing = await database.select().from(users).where((await import('drizzle-orm')).eq(users.id, userId)).get();
  if (!existing) {
    await database.insert(users).values({
      id: userId,
      username: userId,
      role: 'guest',
      createdAt: new Date().toISOString(),
    });
  }
}

function seedReaction(database: any, reactions: any, opts: {
  userId: string; contentType: string; contentSlug: string; reactionType: string;
}) {
  return database.insert(reactions).values({
    id: `${opts.userId}-${opts.contentSlug}-${opts.reactionType}`,
    city: 'test',
    userId: opts.userId,
    contentType: opts.contentType,
    contentSlug: opts.contentSlug,
    reactionType: opts.reactionType,
    createdAt: new Date().toISOString(),
  });
}

describe('reactions GET query logic', () => {
  it('returns riddenCount when user has ridden the requested route', async () => {
    const { database, reactions, users, eq, and, count } = await setup();

    await ensureUser(database, users, 'user-1');
    // User has ridden 3 routes
    await seedReaction(database, reactions, { userId: 'user-1', contentType: 'route', contentSlug: 'route-a', reactionType: 'ridden' });
    await seedReaction(database, reactions, { userId: 'user-1', contentType: 'route', contentSlug: 'route-b', reactionType: 'ridden' });
    await seedReaction(database, reactions, { userId: 'user-1', contentType: 'route', contentSlug: 'route-c', reactionType: 'ridden' });

    // Query: user's own reactions for route-a
    const own = await database
      .select({ reactionType: reactions.reactionType })
      .from(reactions)
      .where(and(
        eq(reactions.city, 'test'),
        eq(reactions.userId, 'user-1'),
        eq(reactions.contentType, 'route'),
        eq(reactions.contentSlug, 'route-a'),
      ));
    const userReactions = own.map((r: any) => r.reactionType);
    expect(userReactions).toContain('ridden');

    // Query: total ridden count for this user across all routes
    const riddenResult = await database
      .select({ total: count(reactions.id) })
      .from(reactions)
      .where(and(
        eq(reactions.city, 'test'),
        eq(reactions.userId, 'user-1'),
        eq(reactions.contentType, 'route'),
        eq(reactions.reactionType, 'ridden'),
      ));
    expect(riddenResult[0].total).toBe(3);
  });

  it('does not include riddenCount for event content type', async () => {
    const { database, reactions, users, eq, and } = await setup();

    await ensureUser(database, users, 'user-2');
    await seedReaction(database, reactions, { userId: 'user-2', contentType: 'event', contentSlug: 'bike-fest', reactionType: 'attended' });

    const own = await database
      .select({ reactionType: reactions.reactionType })
      .from(reactions)
      .where(and(
        eq(reactions.city, 'test'),
        eq(reactions.userId, 'user-2'),
        eq(reactions.contentType, 'event'),
        eq(reactions.contentSlug, 'bike-fest'),
      ));
    const userReactions = own.map((r: any) => r.reactionType);
    expect(userReactions).not.toContain('ridden');
    // For events, riddenCount query should not run — contentType !== 'route'
  });

  it('riddenCount only counts routes, not events', async () => {
    const { database, reactions, users, eq, and, count } = await setup();

    await ensureUser(database, users, 'user-3');
    await seedReaction(database, reactions, { userId: 'user-3', contentType: 'route', contentSlug: 'route-x', reactionType: 'ridden' });
    await seedReaction(database, reactions, { userId: 'user-3', contentType: 'event', contentSlug: 'event-y', reactionType: 'attended' });
    // thumbs-up on a route should not count as ridden
    await seedReaction(database, reactions, { userId: 'user-3', contentType: 'route', contentSlug: 'route-z', reactionType: 'thumbs-up' });

    const riddenResult = await database
      .select({ total: count(reactions.id) })
      .from(reactions)
      .where(and(
        eq(reactions.city, 'test'),
        eq(reactions.userId, 'user-3'),
        eq(reactions.contentType, 'route'),
        eq(reactions.reactionType, 'ridden'),
      ));
    expect(riddenResult[0].total).toBe(1);
  });

  it('riddenCount is 0 for user with no ridden reactions', async () => {
    const { database, reactions, users, eq, and, count } = await setup();

    await ensureUser(database, users, 'user-4');
    await seedReaction(database, reactions, { userId: 'user-4', contentType: 'route', contentSlug: 'route-m', reactionType: 'thumbs-up' });

    const riddenResult = await database
      .select({ total: count(reactions.id) })
      .from(reactions)
      .where(and(
        eq(reactions.city, 'test'),
        eq(reactions.userId, 'user-4'),
        eq(reactions.contentType, 'route'),
        eq(reactions.reactionType, 'ridden'),
      ));
    expect(riddenResult[0].total).toBe(0);
  });
});
