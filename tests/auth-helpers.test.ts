import { describe, it, expect } from 'vitest';
import type { SessionUser } from '../src/lib/auth';

describe('auth role checks', () => {
  const admin: SessionUser = { id: '1', email: 'a@b.com', displayName: 'Admin', role: 'admin' };
  const editor: SessionUser = { id: '2', email: 'e@b.com', displayName: 'Editor', role: 'editor' };

  it('requireUser throws for null user', async () => {
    const { requireUser } = await import('../src/lib/auth');
    expect(() => requireUser(null)).toThrow('Unauthorized');
  });

  it('requireUser returns user for valid user', async () => {
    const { requireUser } = await import('../src/lib/auth');
    expect(requireUser(editor)).toBe(editor);
  });

  it('requireAdmin throws for non-admin', async () => {
    const { requireAdmin } = await import('../src/lib/auth');
    expect(() => requireAdmin(editor)).toThrow('Admin access required');
  });

  it('requireAdmin returns user for admin', async () => {
    const { requireAdmin } = await import('../src/lib/auth');
    expect(requireAdmin(admin)).toBe(admin);
  });

  it('requireAdmin throws for null user', async () => {
    const { requireAdmin } = await import('../src/lib/auth');
    expect(() => requireAdmin(null)).toThrow('Unauthorized');
  });
});
