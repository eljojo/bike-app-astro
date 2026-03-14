import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commitGpxFile } from '../src/lib/git-gpx';

// Mock the LFS module
vi.mock('../src/lib/git-lfs', () => ({
  uploadToLfs: vi.fn().mockResolvedValue('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 100\n'),
}));

import { uploadToLfs } from '../src/lib/git-lfs';

describe('commitGpxFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads to LFS in production (token present)', async () => {
    const result = await commitGpxFile({
      path: 'ottawa/routes/test/main.gpx',
      content: '<gpx>content</gpx>',
      token: 'ghp_abc',
      owner: 'owner',
      repo: 'repo',
    });
    expect(uploadToLfs).toHaveBeenCalledWith('ghp_abc', 'owner', 'repo', '<gpx>content</gpx>');
    expect(result.content).toContain('version https://git-lfs.github.com/spec/v1');
    expect(result.path).toBe('ottawa/routes/test/main.gpx');
  });

  it('commits raw content locally (no token)', async () => {
    const result = await commitGpxFile({
      path: 'blog/rides/2024/03/ride.gpx',
      content: '<gpx>content</gpx>',
      token: undefined,
      owner: 'owner',
      repo: 'repo',
    });
    expect(uploadToLfs).not.toHaveBeenCalled();
    expect(result.content).toBe('<gpx>content</gpx>');
    expect(result.path).toBe('blog/rides/2024/03/ride.gpx');
  });

  it('commits raw content when token is empty string', async () => {
    const result = await commitGpxFile({
      path: 'ottawa/routes/test/variant.gpx',
      content: '<gpx>data</gpx>',
      token: '',
      owner: 'owner',
      repo: 'repo',
    });
    expect(uploadToLfs).not.toHaveBeenCalled();
    expect(result.content).toBe('<gpx>data</gpx>');
  });
});
