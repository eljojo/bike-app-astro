import { describe, test, expect } from 'vitest';
import { sanitizeUsername, isValidUsername } from '../src/lib/username';

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
