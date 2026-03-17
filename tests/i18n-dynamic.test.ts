import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: () => ({
    locale: 'es-CL',
    locales: ['es-CL'],
  }),
}));

describe('i18n dynamic loading', () => {
  it('loads Spanish translations when available', async () => {
    const { t } = await import('../src/i18n/index');
    expect(t('nav.about', 'es')).toBe('Acerca de');
  });

  it('falls back to en for missing keys', async () => {
    const { t } = await import('../src/i18n/index');
    expect(t('nav.about', 'xx')).toBeTruthy();
  });
});
