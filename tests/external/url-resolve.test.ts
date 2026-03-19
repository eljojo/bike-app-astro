import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveUrl } from '../../src/lib/external/url-resolve.server';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('resolveUrl', () => {
  it('follows a single redirect', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: 'https://example.com/final' }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      url: 'https://example.com/final',
    });
    const result = await resolveUrl('https://short.link/abc');
    expect(result).toBe('https://example.com/final');
  });

  it('follows a chain of redirects', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 301,
      headers: new Headers({ location: 'https://mid.link/step' }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: 'https://example.com/final' }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      url: 'https://example.com/final',
    });
    const result = await resolveUrl('https://short.link/abc');
    expect(result).toBe('https://example.com/final');
  });

  it('returns original URL when no redirect', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      url: 'https://example.com/page',
    });
    const result = await resolveUrl('https://example.com/page');
    expect(result).toBe('https://example.com/page');
  });

  it('stops after 3 redirects to prevent infinite loops', async () => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: `https://loop.link/${i}` }),
      });
    }
    const result = await resolveUrl('https://loop.link/start');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toBe('https://loop.link/2');
  });

  it('returns original URL on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await resolveUrl('https://short.link/broken');
    expect(result).toBe('https://short.link/broken');
  });
});
