import type { AstroIntegration } from 'astro';

export async function getAdapter(runtime: string | undefined): Promise<AstroIntegration> {
  if (runtime === 'local') {
    const node = await import('@astrojs/node');
    return node.default({ mode: 'standalone' });
  }
  const cloudflare = await import('@astrojs/cloudflare');
  return cloudflare.default();
}
