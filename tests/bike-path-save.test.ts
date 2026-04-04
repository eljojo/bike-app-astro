import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';

// Replicate the schema from src/views/api/bike-path-save.ts
// (not exported, so we define it here for isolated validation testing)
const bikePathUpdateSchema = z.object({
  frontmatter: z.object({
    name: z.string().optional(),
    vibe: z.string().optional(),
    hidden: z.boolean().optional(),
    stub: z.boolean().optional(),
    featured: z.boolean().optional(),
    includes: z.array(z.string()).default([]),
    photo_key: z.string().optional(),
    tags: z.array(z.string()).default([]),
    wikipedia: z.string().optional(),
    operator: z.string().optional(),
  }).catchall(z.unknown()),
  body: z.string().default(''),
  contentHash: z.string().optional(),
});

describe('bikePathUpdateSchema', () => {
  it('validates a minimal update with just name', () => {
    const input = { frontmatter: { name: 'Rideau Canal Path' } };
    const result = bikePathUpdateSchema.parse(input);
    expect(result.frontmatter.name).toBe('Rideau Canal Path');
  });

  it('provides defaults for body, includes, and tags', () => {
    const input = { frontmatter: { name: 'Test' } };
    const result = bikePathUpdateSchema.parse(input);
    expect(result.body).toBe('');
    expect(result.frontmatter.includes).toEqual([]);
    expect(result.frontmatter.tags).toEqual([]);
  });

  it('accepts locale-specific keys via catchall', () => {
    const input = {
      frontmatter: {
        name: 'Canal Path',
        name_fr: 'Sentier du canal',
        name_es: 'Camino del canal',
      },
    };
    const result = bikePathUpdateSchema.parse(input);
    expect(result.frontmatter.name_fr).toBe('Sentier du canal');
    expect(result.frontmatter.name_es).toBe('Camino del canal');
  });

  it('rejects invalid types (hidden must be boolean)', () => {
    const input = { frontmatter: { hidden: 'not-a-boolean' } };
    expect(() => bikePathUpdateSchema.parse(input)).toThrow();
  });

  it('accepts empty frontmatter', () => {
    const input = { frontmatter: {} };
    const result = bikePathUpdateSchema.parse(input);
    expect(result.frontmatter.includes).toEqual([]);
    expect(result.frontmatter.tags).toEqual([]);
    expect(result.body).toBe('');
  });

  it('treats contentHash as optional', () => {
    const withHash = { frontmatter: {}, contentHash: 'abc123' };
    const withoutHash = { frontmatter: {} };
    expect(bikePathUpdateSchema.parse(withHash).contentHash).toBe('abc123');
    expect(bikePathUpdateSchema.parse(withoutHash).contentHash).toBeUndefined();
  });

  it('accepts all frontmatter fields together', () => {
    const input = {
      frontmatter: {
        name: 'Rideau Canal Path',
        vibe: 'scenic',
        hidden: false,
        stub: true,
        featured: true,
        includes: ['segment-a', 'segment-b'],
        photo_key: 'rideau-canal-winter',
        tags: ['urban', 'waterfront'],
        wikipedia: 'https://en.wikipedia.org/wiki/Rideau_Canal',
        operator: 'NCC',
      },
      body: 'A path along the Rideau Canal.',
      contentHash: 'deadbeef',
    };
    const result = bikePathUpdateSchema.parse(input);
    expect(result.frontmatter.name).toBe('Rideau Canal Path');
    expect(result.frontmatter.vibe).toBe('scenic');
    expect(result.frontmatter.hidden).toBe(false);
    expect(result.frontmatter.stub).toBe(true);
    expect(result.frontmatter.featured).toBe(true);
    expect(result.frontmatter.includes).toEqual(['segment-a', 'segment-b']);
    expect(result.frontmatter.photo_key).toBe('rideau-canal-winter');
    expect(result.frontmatter.tags).toEqual(['urban', 'waterfront']);
    expect(result.frontmatter.wikipedia).toBe('https://en.wikipedia.org/wiki/Rideau_Canal');
    expect(result.frontmatter.operator).toBe('NCC');
    expect(result.body).toBe('A path along the Rideau Canal.');
    expect(result.contentHash).toBe('deadbeef');
  });

  it('rejects non-string values in includes array', () => {
    const input = { frontmatter: { includes: [123, true] } };
    expect(() => bikePathUpdateSchema.parse(input)).toThrow();
  });

  it('rejects non-string values in tags array', () => {
    const input = { frontmatter: { tags: [42, null] } };
    expect(() => bikePathUpdateSchema.parse(input)).toThrow();
  });
});
