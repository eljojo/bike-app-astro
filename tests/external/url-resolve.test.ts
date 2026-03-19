import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveUrl } from '../../src/lib/external/url-resolve.server';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('resolveUrl', () => {
  it('resolves via redirect: follow when res.url differs', async () => {
    mockFetch.mockResolvedValueOnce({
      url: 'https://example.com/final',
    });
    const result = await resolveUrl('https://short.link/abc');
    expect(result).toBe('https://example.com/final');
    // Only one fetch call — no manual fallback needed
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://short.link/abc', { redirect: 'follow' });
  });

  it('falls back to manual redirect following when res.url matches input', async () => {
    // First call (redirect: follow) returns same URL — no resolution
    mockFetch.mockResolvedValueOnce({
      url: 'https://short.link/abc',
    });
    // Manual fallback calls
    mockFetch.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: 'https://example.com/final' }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 200,
    });
    const result = await resolveUrl('https://short.link/abc');
    expect(result).toBe('https://example.com/final');
  });

  it('returns original URL when no redirect', async () => {
    mockFetch.mockResolvedValueOnce({
      url: 'https://example.com/page',
    });
    const result = await resolveUrl('https://example.com/page');
    expect(result).toBe('https://example.com/page');
  });

  it('manual fallback stops after 3 redirects to prevent infinite loops', async () => {
    // First call (redirect: follow) returns same URL
    mockFetch.mockResolvedValueOnce({
      url: 'https://loop.link/start',
    });
    // Manual fallback: 3 redirects then stops
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: `https://loop.link/${i}` }),
      });
    }
    const result = await resolveUrl('https://loop.link/start');
    // 1 follow call + 3 manual calls = 4 total
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(result).toBe('https://loop.link/2');
  });

  it('returns original URL on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await resolveUrl('https://short.link/broken');
    expect(result).toBe('https://short.link/broken');
  });
});
