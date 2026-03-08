import { describe, it, expect } from 'vitest';
import { reactions } from '../src/db/schema';
import { getTableName, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';

const reactionSchema = z.object({
  contentType: z.enum(['route', 'event']),
  contentSlug: z.string().min(1),
  reactionType: z.enum(['ridden', 'thumbs-up', 'star']),
});

describe('reactions', () => {
  describe('schema', () => {
    it('has the correct table name', () => {
      expect(getTableName(reactions)).toBe('reactions');
    });

    it('has all expected columns', () => {
      const cols = getTableColumns(reactions);
      expect(Object.keys(cols)).toEqual([
        'id', 'userId', 'contentType', 'contentSlug', 'reactionType', 'createdAt',
      ]);
    });
  });

  describe('validation', () => {
    it('accepts valid ridden reaction', () => {
      expect(() => reactionSchema.parse({
        contentType: 'route',
        contentSlug: 'easy-loop',
        reactionType: 'ridden',
      })).not.toThrow();
    });

    it('accepts valid thumbs-up reaction', () => {
      expect(() => reactionSchema.parse({
        contentType: 'route',
        contentSlug: 'easy-loop',
        reactionType: 'thumbs-up',
      })).not.toThrow();
    });

    it('accepts valid star reaction', () => {
      expect(() => reactionSchema.parse({
        contentType: 'route',
        contentSlug: 'easy-loop',
        reactionType: 'star',
      })).not.toThrow();
    });

    it('accepts event content type', () => {
      expect(() => reactionSchema.parse({
        contentType: 'event',
        contentSlug: '2026/bike-fest',
        reactionType: 'thumbs-up',
      })).not.toThrow();
    });

    it('rejects invalid reaction type', () => {
      expect(() => reactionSchema.parse({
        contentType: 'route',
        contentSlug: 'easy-loop',
        reactionType: 'invalid',
      })).toThrow();
    });

    it('rejects invalid content type', () => {
      expect(() => reactionSchema.parse({
        contentType: 'place',
        contentSlug: 'flora-footbridge',
        reactionType: 'ridden',
      })).toThrow();
    });

    it('rejects empty slug', () => {
      expect(() => reactionSchema.parse({
        contentType: 'route',
        contentSlug: '',
        reactionType: 'thumbs-up',
      })).toThrow();
    });
  });
});
