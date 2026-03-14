import { describe, it, expect, vi } from 'vitest';
import { createLocalEmailService, createSesEmailService } from '../src/lib/external/email';
import type { AppEnv } from '../src/lib/config/app-env';

describe('email service', () => {
  it('creates a service with send method', () => {
    const service = createLocalEmailService();
    expect(typeof service.send).toBe('function');
  });

  it('local service logs to console', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const service = createLocalEmailService();
    await service.send('test@example.com', 'Test Subject', 'Test body');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('test@example.com'));
    spy.mockRestore();
  });

  it('SES service falls back to local when unconfigured', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = createSesEmailService({} as AppEnv);
    expect(typeof service.send).toBe('function');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('SES not configured'));
    spy.mockRestore();
  });

  it('SES service sends via fetch when configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => '' });
    vi.stubGlobal('fetch', mockFetch);

    const service = createSesEmailService({
      SES_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      SES_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      SES_REGION: 'us-east-1',
      SES_FROM: 'test@example.com',
    } as AppEnv);

    await service.send('user@example.com', 'Test', 'Hello');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://email.us-east-1.amazonaws.com/');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toContain('AWS4-HMAC-SHA256');
    expect(opts.body).toContain('Action=SendEmail');
    expect(opts.body).toContain(encodeURIComponent('user@example.com'));

    vi.unstubAllGlobals();
  });

  it('SES service throws on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('<Error><Message>Bad request</Message></Error>'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createSesEmailService({
      SES_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      SES_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      SES_REGION: 'us-east-1',
      SES_FROM: 'test@example.com',
    } as AppEnv);

    await expect(service.send('user@example.com', 'Test', 'Hello'))
      .rejects.toThrow('SES send failed (400)');

    vi.unstubAllGlobals();
  });
});
