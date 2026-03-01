import { describe, it, expect, vi } from 'vitest';

import { i18nRoutes } from '../src/integrations/i18n-routes';

describe('i18nRoutes integration', () => {
  it('injects translated French patterns', () => {
    const integration = i18nRoutes();
    const injectRoute = vi.fn();
    const config = {
      i18n: {
        defaultLocale: 'en',
        locales: ['en', 'fr'],
      },
    };

    const hook = integration.hooks['astro:config:setup'] as Function;
    hook({ injectRoute, config });

    const patterns = injectRoute.mock.calls.map((c: any[]) => c[0].pattern);

    // French patterns should use translated segments
    expect(patterns).toContain('/fr/a-propos');
    expect(patterns).toContain('/fr/parcours');
    expect(patterns).toContain('/fr/parcours/[slug]');
    expect(patterns).toContain('/fr/parcours/[slug]/carte');
    expect(patterns).toContain('/fr/parcours/[slug]/carte/[variant]');
    expect(patterns).toContain('/fr/calendrier');
    expect(patterns).toContain('/fr/carte');

    // Should NOT have untranslated French patterns
    expect(patterns).not.toContain('/fr/about');
    expect(patterns).not.toContain('/fr/routes');
    expect(patterns).not.toContain('/fr/routes/[slug]');
    expect(patterns).not.toContain('/fr/routes/[slug]/map');

    // English patterns should be unchanged
    expect(patterns).toContain('/about');
    expect(patterns).toContain('/routes/[slug]');
    expect(patterns).toContain('/routes/[slug]/map');

    // Guides and videos stay the same in French
    expect(patterns).toContain('/fr/guides');
    expect(patterns).toContain('/fr/guides/[slug]');
    expect(patterns).toContain('/fr/videos');
  });
});
