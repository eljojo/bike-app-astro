import { describe, it, expect } from 'vitest';
import { normalizeEmail, generateId, getWebAuthnConfig } from '../src/lib/auth';

describe('auth helpers', () => {
  describe('normalizeEmail', () => {
    it('lowercases email', () => {
      expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
    });

    it('trims whitespace', () => {
      expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
    });

    it('handles already-normalized email', () => {
      expect(normalizeEmail('user@example.com')).toBe('user@example.com');
    });
  });

  describe('generateId', () => {
    it('returns a 32-character hex string', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('getWebAuthnConfig', () => {
    it('returns defaults when env vars are not set', () => {
      const config = getWebAuthnConfig({});
      expect(config.rpID).toBe('localhost');
      expect(config.rpName).toBe('whereto-bike');
      expect(config.origin).toBe('http://localhost:4321');
    });

    it('reads from env vars when set', () => {
      const config = getWebAuthnConfig({
        WEBAUTHN_RP_ID: 'whereto.bike',
        WEBAUTHN_RP_NAME: 'whereto-bike',
        WEBAUTHN_ORIGIN: 'https://whereto.bike',
      });
      expect(config.rpID).toBe('whereto.bike');
      expect(config.rpName).toBe('whereto-bike');
      expect(config.origin).toBe('https://whereto.bike');
    });
  });
});
