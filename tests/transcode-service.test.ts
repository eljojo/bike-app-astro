import { describe, it, expect } from 'vitest';
import { outputSize } from '../src/lib/transcode-service';

describe('outputSize', () => {
  it('scales 4K landscape to 1080p', () => {
    const result = outputSize(3840, 2160);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(608);
  });

  it('scales 4K portrait to 1080p height', () => {
    const result = outputSize(2160, 3840);
    expect(result.width).toBe(608);
    expect(result.height).toBe(1080);
  });

  it('does not upscale small videos', () => {
    const result = outputSize(640, 480);
    expect(result).toEqual({ width: 640, height: 480 });
  });

  it('produces even dimensions', () => {
    const result = outputSize(1921, 1081);
    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
  });

  it('handles exact 1080p input', () => {
    const result = outputSize(1920, 1080);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(608);
  });

  it('handles square input', () => {
    const result = outputSize(1080, 1080);
    expect(result).toEqual({ width: 1080, height: 1080 });
  });
});
