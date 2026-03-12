import { describe, it, expect, vi } from 'vitest';
import { createLocalEmailService } from '../src/lib/email';

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
});
