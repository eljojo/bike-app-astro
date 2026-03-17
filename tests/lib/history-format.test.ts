import { describe, it, expect } from 'vitest';
import { parseCommitMessage, formatDetail } from '../../src/lib/history-format';

describe('parseCommitMessage', () => {
  it('parses a route create', () => {
    const msg = 'Create Rideau Canal Western (3 media)\n\nChanges: ottawa/routes/rideau-canal-western';
    const result = parseCommitMessage(msg, 'ottawa');
    expect(result.action).toBe('created');
    expect(result.headline).toBe('Rideau Canal Western');
    expect(result.contentType).toBe('routes');
    expect(result.contentSlug).toBe('rideau-canal-western');
    expect(result.editorUrl).toBe('/admin/routes/rideau-canal-western');
    expect(result.detail).toBe('3 media');
  });

  it('parses a route update', () => {
    const msg = 'Update Rideau Canal Western (5 media, GPX added)\n\nChanges: ottawa/routes/rideau-canal-western';
    const result = parseCommitMessage(msg, 'ottawa');
    expect(result.action).toBe('updated');
    expect(result.detail).toBe('5 media, GPX added');
  });

  it('parses an event create', () => {
    const msg = 'Create event Tour de Fat\n\nChanges: ottawa/events/2026/tour-de-fat';
    const result = parseCommitMessage(msg, 'ottawa');
    expect(result.action).toBe('created');
    expect(result.headline).toBe('Tour de Fat');
    expect(result.contentType).toBe('events');
    expect(result.editorUrl).toBe('/admin/events/2026/tour-de-fat');
  });

  it('handles messages without Changes: trailer', () => {
    const msg = 'Update something';
    const result = parseCommitMessage(msg, 'ottawa');
    expect(result.action).toBe('updated');
    expect(result.contentType).toBeNull();
    expect(result.editorUrl).toBeNull();
  });
});

describe('formatDetail', () => {
  it('converts media count to human-readable', () => {
    expect(formatDetail('3 media')).toBe('added 3 photos');
  });

  it('preserves extra detail after media count', () => {
    expect(formatDetail('5 media, GPX added')).toBe('added 5 photos, GPX added');
  });

  it('returns empty string for empty input', () => {
    expect(formatDetail('')).toBe('');
  });
});
