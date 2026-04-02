import { describe, it, expect, vi } from 'vitest';
import { bindText, bindCheckbox, bindTextarea } from '../src/components/admin/field-helpers';

describe('bindText', () => {
  it('returns value and onInput that calls setter with input value', () => {
    const setter = vi.fn();
    const result = bindText('hello', setter);
    expect(result.value).toBe('hello');

    const event = { target: { value: 'world' } } as unknown as Event;
    result.onInput(event);
    expect(setter).toHaveBeenCalledWith('world');
  });
});

describe('bindCheckbox', () => {
  it('returns checked and onChange that calls setter with checked state', () => {
    const setter = vi.fn();
    const result = bindCheckbox(true, setter);
    expect(result.checked).toBe(true);

    const event = { target: { checked: false } } as unknown as Event;
    result.onChange(event);
    expect(setter).toHaveBeenCalledWith(false);
  });
});

describe('bindTextarea', () => {
  it('returns value and onInput that calls setter with textarea value', () => {
    const setter = vi.fn();
    const result = bindTextarea('line 1\nline 2', setter);
    expect(result.value).toBe('line 1\nline 2');

    const event = { target: { value: 'updated' } } as unknown as Event;
    result.onInput(event);
    expect(setter).toHaveBeenCalledWith('updated');
  });
});
