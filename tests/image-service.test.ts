import { describe, it, expect } from 'vitest';
import { buildImageUrl, imageUrl, originalUrl } from '../src/lib/media/image-service';

describe('imageUrl', () => {
  it('generates a transform URL with dimensions', () => {
    const url = imageUrl('abc123', { width: 300, height: 300, fit: 'cover' });
    expect(url).toContain('/cdn-cgi/image/');
    expect(url).toContain('width=300');
    expect(url).toContain('height=300');
    expect(url).toContain('fit=cover');
    expect(url).toContain('abc123');
  });

  it('defaults format to auto', () => {
    const url = imageUrl('abc123', { width: 300 });
    expect(url).toContain('format=auto');
  });

  it('generates original URL without transforms', () => {
    const url = originalUrl('abc123');
    expect(url).toContain('abc123');
    expect(url).not.toContain('cdn-cgi');
  });

  it('returns original URL when called with no options', () => {
    const url = imageUrl('abc123');
    expect(url).toContain('abc123');
    expect(url).not.toContain('cdn-cgi');
  });

  it('generates width-only URL without crop', () => {
    const url = imageUrl('abc123', { width: 375 });
    expect(url).toContain('width=375');
    expect(url).not.toContain('height=');
    expect(url).not.toContain('fit=');
  });

  it('generates width+height+fit URL for thumbnails', () => {
    const url = imageUrl('abc123', { width: 375, height: 375, fit: 'cover' });
    expect(url).toContain('width=375');
    expect(url).toContain('height=375');
    expect(url).toContain('fit=cover');
  });
});

describe('buildImageUrl', () => {
  const cdn = 'https://cdn.example.com';

  it('builds URL with width only', () => {
    expect(buildImageUrl(cdn, 'abc123', { width: 400 }))
      .toBe('https://cdn.example.com/cdn-cgi/image/width=400/abc123');
  });

  it('builds URL with width, height, and fit', () => {
    expect(buildImageUrl(cdn, 'abc123', { width: 200, height: 150, fit: 'cover' }))
      .toBe('https://cdn.example.com/cdn-cgi/image/width=200,height=150,fit=cover/abc123');
  });

  it('builds URL with format', () => {
    expect(buildImageUrl(cdn, 'abc123', { width: 300, format: 'auto' }))
      .toBe('https://cdn.example.com/cdn-cgi/image/width=300,format=auto/abc123');
  });

  it('builds URL with scale-down fit', () => {
    expect(buildImageUrl(cdn, 'abc123', { width: 800, fit: 'scale-down' }))
      .toBe('https://cdn.example.com/cdn-cgi/image/width=800,fit=scale-down/abc123');
  });

  it('returns plain URL when no transforms', () => {
    expect(buildImageUrl(cdn, 'abc123'))
      .toBe('https://cdn.example.com/abc123');
  });
});
