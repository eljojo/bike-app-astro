import { describe, it, expect, vi, afterEach } from 'vitest';

describe('config CITY resolution', () => {
  const originalCity = process.env.CITY;

  afterEach(() => {
    // Restore original CITY value
    if (originalCity !== undefined) {
      process.env.CITY = originalCity;
    } else {
      delete process.env.CITY;
    }
    vi.resetModules();
  });

  it('reads CITY from process.env when __CITY__ is not defined', async () => {
    process.env.CITY = 'testcity';
    const { CITY } = await import('../../src/lib/config/config');
    expect(CITY).toBe('testcity');
  });

  it('throws when CITY is not set and __CITY__ is not defined', async () => {
    delete process.env.CITY;
    await expect(() => import('../../src/lib/config/config')).rejects.toThrow(
      'CITY environment variable is required',
    );
  });

  it('never silently defaults to ottawa', async () => {
    // This test guards against reintroducing `|| "ottawa"` as a default.
    // The bug: in Cloudflare Workers, process.env.CITY is undefined at runtime
    // because Vite doesn't inline process.env values. A silent default caused
    // blog ride imports to commit under ottawa/ instead of blog/.
    delete process.env.CITY;
    await expect(() => import('../../src/lib/config/config')).rejects.toThrow();
  });
});
