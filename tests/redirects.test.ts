import { describe, it, expect } from 'vitest';
import { updateRedirectsYaml } from '../src/lib/redirects';

describe('updateRedirectsYaml', () => {
  it('appends a new redirect entry', () => {
    const existing = 'routes:\n- from: old-a\n  to: new-a\n';
    const result = updateRedirectsYaml(existing, 'routes', 'old-b', 'new-b');
    expect(result).toContain('from: old-b');
    expect(result).toContain('to: new-b');
  });

  it('skips duplicate redirects', () => {
    const existing = 'routes:\n- from: old-a\n  to: new-a\n';
    const result = updateRedirectsYaml(existing, 'routes', 'old-a', 'new-a');
    expect(result).toBe(existing);
  });

  it('collapses redirect chains (A→B + B→C = A→C + B→C)', () => {
    const existing = 'routes:\n- from: a\n  to: b\n';
    const result = updateRedirectsYaml(existing, 'routes', 'b', 'c');
    expect(result).toContain('from: a');
    expect(result).toContain('to: c');
    expect(result).toContain('from: b');
    expect(result).not.toMatch(/to: b/);
  });

  it('creates section if it does not exist', () => {
    const existing = 'guides:\n- from: x\n  to: y\n';
    const result = updateRedirectsYaml(existing, 'routes', 'old', 'new');
    expect(result).toContain('routes:');
    expect(result).toContain('from: old');
  });

  it('handles empty/missing file', () => {
    const result = updateRedirectsYaml('', 'routes', 'old', 'new');
    expect(result).toContain('routes:');
    expect(result).toContain('from: old');
  });
});
