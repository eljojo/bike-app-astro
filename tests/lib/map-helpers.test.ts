import { describe, it, expect } from 'vitest';
import { html, raw } from '../../src/lib/map-helpers';

describe('html tagged template', () => {
  it('escapes interpolated strings', () => {
    const name = '<script>alert(1)</script>';
    expect(html`<strong>${name}</strong>`).toBe(
      '<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>'
    );
  });

  it('escapes ampersands and quotes', () => {
    const val = 'A & "B"';
    expect(html`<span title="${val}">${val}</span>`).toBe(
      '<span title="A &amp; &quot;B&quot;">A &amp; &quot;B&quot;</span>'
    );
  });

  it('passes raw values through unescaped', () => {
    const link = raw('<a href="/">Home</a>');
    expect(html`<div>${link}</div>`).toBe('<div><a href="/">Home</a></div>');
  });

  it('handles numbers and nullish values', () => {
    expect(html`<span>${42}</span>`).toBe('<span>42</span>');
    expect(html`<span>${null}</span>`).toBe('<span></span>');
    expect(html`<span>${undefined}</span>`).toBe('<span></span>');
  });
});
