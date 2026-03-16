import { describe, it, expect } from 'vitest';
import { outputSize } from '../src/lib/media/transcode.service';

describe('outputSize', () => {
  it('scales 4K landscape to 1080p', () => {
    const result = outputSize(3840, 2160);
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it('scales 4K portrait to 1080p', () => {
    const result = outputSize(2160, 3840);
    expect(result).toEqual({ width: 1080, height: 1920 });
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

  it('preserves exact 1080p input', () => {
    const result = outputSize(1920, 1080);
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it('handles square input', () => {
    const result = outputSize(1080, 1080);
    expect(result).toEqual({ width: 1080, height: 1080 });
  });

  it('scales ultrawide by short edge', () => {
    // 2560x1080 ultrawide: long edge 2560 / 1920 = 1.33, short edge 1080 / 1080 = 1.0
    // min(1920/2560, 1080/1080) = min(0.75, 1.0) = 0.75
    const result = outputSize(2560, 1080);
    expect(result).toEqual({ width: 1920, height: 810 });
  });

  it('scales tall portrait by short edge', () => {
    // 1080x2400 phone video: long=2400, short=1080
    // min(1920/2400, 1080/1080) = min(0.8, 1.0) = 0.8
    const result = outputSize(1080, 2400);
    expect(result).toEqual({ width: 864, height: 1920 });
  });
});
