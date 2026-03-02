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
    it('derives rpID and origin from request URL', () => {
      const config = getWebAuthnConfig('https://new.ottawabybike.ca/api/auth/register');
      expect(config.rpID).toBe('new.ottawabybike.ca');
      expect(config.rpName).toBe('whereto-bike');
      expect(config.origin).toBe('https://new.ottawabybike.ca');
    });

    it('works with localhost dev server', () => {
      const config = getWebAuthnConfig('http://localhost:4321/api/auth/register');
      expect(config.rpID).toBe('localhost');
      expect(config.origin).toBe('http://localhost:4321');
    });

    it('env vars override derived values', () => {
      const config = getWebAuthnConfig('https://new.ottawabybike.ca/api/auth/register', {
        WEBAUTHN_RP_ID: 'ottawabybike.ca',
        WEBAUTHN_RP_NAME: 'Ottawa by Bike',
        WEBAUTHN_ORIGIN: 'https://ottawabybike.ca',
      });
      expect(config.rpID).toBe('ottawabybike.ca');
      expect(config.rpName).toBe('Ottawa by Bike');
      expect(config.origin).toBe('https://ottawabybike.ca');
    });
  });
});
