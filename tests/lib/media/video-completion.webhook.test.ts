import { describe, it, expect } from 'vitest';
import { buildVideoMetadata } from '../../../src/lib/media/video-metadata';

describe('webhook persistence helpers', () => {
  it('buildVideoMetadata maps camelCase D1 fields to snake_case media fields', () => {
    const row = {
      key: 'test123',
      width: 1920,
      height: 1080,
      capturedAt: '2024-06-15T14:22:00Z',
      duration: 'PT30S',
      orientation: 'landscape',
      lat: 45.4,
      lng: -75.7,
    };
    const result = buildVideoMetadata(row);
    expect(result.captured_at).toBe('2024-06-15T14:22:00Z');
    expect(result).not.toHaveProperty('capturedAt');
  });
});
