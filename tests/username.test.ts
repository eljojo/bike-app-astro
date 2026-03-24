import { describe, test, expect } from 'vitest';
import { sanitizeUsername, isValidUsername, generateUsernameFromEmail } from '../src/lib/username';

describe('sanitizeUsername', () => {
  test('lowercases and strips unsafe chars', () => {
    expect(sanitizeUsername('Hello World')).toBe('hello-world');
  });
  test('collapses hyphens', () => {
    expect(sanitizeUsername('a--b')).toBe('a-b');
  });
  test('trims hyphens', () => {
    expect(sanitizeUsername('-hello-')).toBe('hello');
  });
  test('limits length to 30', () => {
    expect(sanitizeUsername('a'.repeat(50)).length).toBeLessThanOrEqual(30);
  });
  test('fallback for empty', () => {
    expect(sanitizeUsername('!!!')).toBe('anonymous');
  });
});

describe('isValidUsername', () => {
  test('accepts slug-safe names', () => {
    expect(isValidUsername('my-username_123')).toBe(true);
  });
  test('rejects spaces', () => {
    expect(isValidUsername('has space')).toBe(false);
  });
  test('rejects uppercase', () => {
    expect(isValidUsername('HasUpper')).toBe(false);
  });
});

describe('generateUsernameFromEmail', () => {
  test('extracts username from email prefix', () => {
    expect(generateUsernameFromEmail('jose@example.com')).toBe('jose');
  });

  test('sanitizes special characters', () => {
    expect(generateUsernameFromEmail('j.o.s.e@example.com')).toBe('jose');
  });

  test('appends hex suffix for short prefixes', () => {
    const result = generateUsernameFromEmail('a@example.com');
    expect(result).toMatch(/^a-[0-9a-f]{4}$/);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test('truncates long prefixes', () => {
    const long = 'a'.repeat(50) + '@example.com';
    const result = generateUsernameFromEmail(long);
    expect(result.length).toBeLessThanOrEqual(30);
  });
});
