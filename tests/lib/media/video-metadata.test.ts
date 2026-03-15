import { describe, it, expect } from 'vitest';
import { buildVideoMetadata, enrichMediaWithVideoJobs } from '../../../src/lib/media/video-metadata';

describe('buildVideoMetadata', () => {
  it('maps videoJobs row fields to AdminMediaItem fields', () => {
    const row = {
      key: 'abc12345',
      width: 1920,
      height: 1080,
      duration: 'PT2M15S',
      orientation: 'landscape',
      lat: 45.4215,
      lng: -75.6972,
      capturedAt: '2024-06-15T14:22:00Z',
      title: 'Greenbelt ride',
      handle: 'greenbelt-ride',
    };
    const result = buildVideoMetadata(row);
    expect(result).toEqual({
      width: 1920,
      height: 1080,
      duration: 'PT2M15S',
      orientation: 'landscape',
      lat: 45.4215,
      lng: -75.6972,
      captured_at: '2024-06-15T14:22:00Z',
    });
  });

  it('omits null/undefined fields', () => {
    const row = { key: 'abc12345', width: 1920, height: 1080, duration: null, orientation: null, lat: null, lng: null, capturedAt: null };
    const result = buildVideoMetadata(row);
    expect(result).toEqual({ width: 1920, height: 1080 });
  });
});

describe('enrichMediaWithVideoJobs', () => {
  it('merges metadata into matching video items', () => {
    const media = [
      { key: 'photo1', type: 'photo' as const },
      { key: 'vid123', type: 'video' as const, title: 'My video', handle: 'my-video' },
    ];
    const jobs = [
      { key: 'vid123', status: 'ready', width: 1920, height: 1080, duration: 'PT30S', orientation: 'landscape', lat: null, lng: null, capturedAt: null },
    ];
    const result = enrichMediaWithVideoJobs(media, jobs);
    expect(result[0]).toEqual({ key: 'photo1', type: 'photo' });
    expect(result[1]).toEqual({
      key: 'vid123', type: 'video', title: 'My video', handle: 'my-video',
      width: 1920, height: 1080, duration: 'PT30S', orientation: 'landscape',
    });
  });

  it('skips non-ready jobs', () => {
    const media = [{ key: 'vid123', type: 'video' as const, title: 'Test' }];
    const jobs = [{ key: 'vid123', status: 'transcoding', width: null, height: null, duration: null, orientation: null, lat: null, lng: null, capturedAt: null }];
    const result = enrichMediaWithVideoJobs(media, jobs);
    expect(result[0]).toEqual({ key: 'vid123', type: 'video', title: 'Test' });
  });

  it('returns original array when no jobs match', () => {
    const media = [{ key: 'vid123', type: 'video' as const }];
    const result = enrichMediaWithVideoJobs(media, []);
    expect(result).toEqual(media);
  });
});
