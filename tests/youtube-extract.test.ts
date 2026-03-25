import { describe, it, expect } from 'vitest';
import { extractYouTubeUrls } from '../src/lib/youtube-extract';

describe('extractYouTubeUrls', () => {
  it('extracts bare youtube.com URL', () => {
    const md = 'Some text\n\nhttps://www.youtube.com/watch?v=2ajt7RW00yo\n\nMore text';
    const result = extractYouTubeUrls(md);
    expect(result.videoIds).toEqual(['2ajt7RW00yo']);
    expect(result.cleanedMarkdown).not.toContain('youtube');
    expect(result.cleanedMarkdown).toContain('Some text');
    expect(result.cleanedMarkdown).toContain('More text');
  });

  it('extracts youtu.be short URL', () => {
    const md = 'Text\n\nhttps://youtu.be/2ajt7RW00yo\n\nEnd';
    const result = extractYouTubeUrls(md);
    expect(result.videoIds).toEqual(['2ajt7RW00yo']);
  });

  it('leaves inline markdown links with YouTube URLs untouched', () => {
    const md = 'Check out [this video](https://www.youtube.com/watch?v=2ajt7RW00yo)';
    const result = extractYouTubeUrls(md);
    expect(result.videoIds).toEqual([]);
    expect(result.cleanedMarkdown).toBe(md);
  });

  it('returns empty for markdown with no YouTube URLs', () => {
    const md = 'Just regular text with a [link](https://example.com)';
    const result = extractYouTubeUrls(md);
    expect(result.videoIds).toEqual([]);
    expect(result.cleanedMarkdown).toBe(md);
  });

  it('extracts multiple YouTube URLs', () => {
    const md = 'https://youtube.com/watch?v=abc123\n\nhttps://youtu.be/def456';
    const result = extractYouTubeUrls(md);
    expect(result.videoIds).toEqual(['abc123', 'def456']);
  });

  it('handles URL with extra query params', () => {
    const md = 'https://www.youtube.com/watch?v=2ajt7RW00yo&t=42';
    const result = extractYouTubeUrls(md);
    expect(result.videoIds).toEqual(['2ajt7RW00yo']);
  });

  it('cleans up empty lines left by extraction', () => {
    const md = 'First paragraph.\n\nhttps://youtube.com/watch?v=abc123\n\nSecond paragraph.';
    const result = extractYouTubeUrls(md);
    expect(result.cleanedMarkdown).not.toMatch(/\n{3,}/);
  });
});
