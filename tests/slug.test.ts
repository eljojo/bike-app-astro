import { describe, it, expect } from 'vitest';
import { slugify, validateSlug } from '../src/lib/slug';

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('collapses multiple special chars into single hyphen', () => {
    expect(slugify('a   b!!!c')).toBe('a-b-c');
  });

  it('handles accented characters by stripping them', () => {
    expect(slugify('café')).toBe('caf');
  });
});

describe('validateSlug', () => {
  it('rejects empty slug', () => {
    expect(validateSlug('')).toBe('Invalid slug');
  });

  it('rejects slug with leading hyphen', () => {
    expect(validateSlug('-hello')).toBe('Invalid slug');
  });

  it('rejects slug with trailing hyphen', () => {
    expect(validateSlug('hello-')).toBe('Invalid slug');
  });

  it('accepts valid slug', () => {
    expect(validateSlug('hello-world')).toBeNull();
  });

  it('rejects single character', () => {
    expect(validateSlug('a')).toBe('Invalid slug');
  });
});
