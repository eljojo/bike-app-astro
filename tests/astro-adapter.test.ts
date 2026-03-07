import { describe, it, expect } from 'vitest';

describe('astro adapter selection', () => {
  it('selects node adapter when RUNTIME=local', async () => {
    const { getAdapter } = await import('../src/lib/adapter');
    const adapter = await getAdapter('local');
    expect(adapter.name).toContain('node');
  });

  it('selects cloudflare adapter when RUNTIME is not set', async () => {
    const { getAdapter } = await import('../src/lib/adapter');
    const adapter = await getAdapter(undefined);
    expect(adapter.name).toContain('cloudflare');
  });
});
