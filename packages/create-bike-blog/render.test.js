import { describe, it, expect } from 'vitest';
import { renderTemplate } from './index.js';

describe('renderTemplate', () => {
  it('replaces all placeholders', () => {
    const input = 'Hello {{NAME}}, welcome to {{DOMAIN}}!';
    const result = renderTemplate(input, { NAME: 'jojo', DOMAIN: 'eljojo.bike' });
    expect(result).toBe('Hello jojo, welcome to eljojo.bike!');
  });

  it('replaces multiple occurrences', () => {
    const input = '{{X}} and {{X}}';
    const result = renderTemplate(input, { X: 'yes' });
    expect(result).toBe('yes and yes');
  });

  it('leaves unknown placeholders unchanged', () => {
    const input = '{{KNOWN}} and {{UNKNOWN}}';
    const result = renderTemplate(input, { KNOWN: 'ok' });
    expect(result).toBe('ok and {{UNKNOWN}}');
  });
});
