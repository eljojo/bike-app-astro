import { describe, it, expect } from 'vitest';

// Test the path-matching logic from middleware
function isProtectedRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/admin') ||
    (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/'))
  );
}

describe('middleware path matching', () => {
  it('protects /admin', () => {
    expect(isProtectedRoute('/admin')).toBe(true);
    expect(isProtectedRoute('/admin/')).toBe(true);
    expect(isProtectedRoute('/admin/routes/my-route')).toBe(true);
  });

  it('protects non-auth API routes', () => {
    expect(isProtectedRoute('/api/routes/my-route')).toBe(true);
    expect(isProtectedRoute('/api/media/presign')).toBe(true);
    expect(isProtectedRoute('/api/admin/invite')).toBe(true);
  });

  it('does not protect auth API routes', () => {
    expect(isProtectedRoute('/api/auth/login')).toBe(false);
    expect(isProtectedRoute('/api/auth/login-options')).toBe(false);
    expect(isProtectedRoute('/api/auth/register')).toBe(false);
    expect(isProtectedRoute('/api/auth/register-options')).toBe(false);
    expect(isProtectedRoute('/api/auth/logout')).toBe(false);
  });

  it('does not protect public pages', () => {
    expect(isProtectedRoute('/')).toBe(false);
    expect(isProtectedRoute('/routes')).toBe(false);
    expect(isProtectedRoute('/routes/my-route')).toBe(false);
    expect(isProtectedRoute('/login')).toBe(false);
    expect(isProtectedRoute('/register')).toBe(false);
    expect(isProtectedRoute('/setup')).toBe(false);
    expect(isProtectedRoute('/map')).toBe(false);
    expect(isProtectedRoute('/guides')).toBe(false);
    expect(isProtectedRoute('/calendar')).toBe(false);
  });
});
