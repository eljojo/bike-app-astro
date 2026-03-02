import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitService } from '../src/lib/git-service';

const TEST_CONFIG = {
  token: 'ghp_test_token_123',
  owner: 'eljojo',
  repo: 'bike-routes',
  branch: 'staging',
};

function mockFetch(responses: Array<{ status: number; body?: unknown }>): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  return vi.fn(async () => {
    const response = responses[callIndex++] || { status: 500, body: { message: 'Unexpected call' } };
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.status === 200 ? 'OK' : response.status === 201 ? 'Created' : response.status === 204 ? 'No Content' : response.status === 404 ? 'Not Found' : 'Error',
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    };
  });
}

describe('GitService ref operations', () => {
  let service: GitService;

  beforeEach(() => {
    service = new GitService(TEST_CONFIG);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getRef', () => {
    it('returns the commit SHA for an existing branch', async () => {
      const fetchMock = mockFetch([
        { status: 200, body: { object: { sha: 'abc123def456' } } },
      ]);
      vi.stubGlobal('fetch', fetchMock);

      const sha = await service.getRef('main');

      expect(sha).toBe('abc123def456');
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.github.com/repos/eljojo/bike-routes/git/ref/heads/main');

    });

    it('returns null when branch does not exist (404)', async () => {
      const fetchMock = mockFetch([{ status: 404 }]);
      vi.stubGlobal('fetch', fetchMock);

      const sha = await service.getRef('nonexistent');

      expect(sha).toBeNull();
    });

    it('throws on non-404 API errors', async () => {
      const fetchMock = mockFetch([{ status: 500 }]);
      vi.stubGlobal('fetch', fetchMock);

      await expect(service.getRef('main')).rejects.toThrow('GitHub API error: 500');

    });
  });

  describe('updateRef', () => {
    it('sends PATCH to update a branch ref', async () => {
      const fetchMock = mockFetch([{ status: 200, body: { object: { sha: 'newsha' } } }]);
      vi.stubGlobal('fetch', fetchMock);

      await service.updateRef('staging', 'newsha123', true);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.github.com/repos/eljojo/bike-routes/git/refs/heads/staging');
      expect(options.method).toBe('PATCH');
      const body = JSON.parse(options.body);
      expect(body.sha).toBe('newsha123');
      expect(body.force).toBe(true);

    });

    it('defaults force to false', async () => {
      const fetchMock = mockFetch([{ status: 200, body: { object: { sha: 'sha' } } }]);
      vi.stubGlobal('fetch', fetchMock);

      await service.updateRef('staging', 'sha456');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.force).toBe(false);

    });

    it('throws on API errors', async () => {
      const fetchMock = mockFetch([{ status: 422 }]);
      vi.stubGlobal('fetch', fetchMock);

      await expect(service.updateRef('staging', 'sha')).rejects.toThrow('GitHub API error: 422');

    });
  });

  describe('createRef', () => {
    it('sends POST to create a new branch ref', async () => {
      const fetchMock = mockFetch([{ status: 201, body: { ref: 'refs/heads/staging' } }]);
      vi.stubGlobal('fetch', fetchMock);

      await service.createRef('staging', 'abc123');

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.github.com/repos/eljojo/bike-routes/git/refs');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.ref).toBe('refs/heads/staging');
      expect(body.sha).toBe('abc123');

    });

    it('throws on API errors', async () => {
      const fetchMock = mockFetch([{ status: 422 }]);
      vi.stubGlobal('fetch', fetchMock);

      await expect(service.createRef('staging', 'sha')).rejects.toThrow('GitHub API error: 422');

    });
  });
});

describe('admin-sync endpoint logic', () => {
  // Test the sync workflow logic: the sequence of getRef, updateRef/createRef, and triggerRebuild
  // Since the endpoint depends on Astro's APIContext and cloudflare env, we test the
  // GitService call sequence that the endpoint orchestrates.

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sync workflow: updates existing staging branch to main SHA', async () => {
    const service = new GitService(TEST_CONFIG);

    const fetchMock = mockFetch([
      // getRef('main') -> returns main SHA
      { status: 200, body: { object: { sha: 'main-sha-abc' } } },
      // getRef('staging') -> exists
      { status: 200, body: { object: { sha: 'old-staging-sha' } } },
      // updateRef('staging', 'main-sha-abc', true)
      { status: 200, body: { object: { sha: 'main-sha-abc' } } },
      // triggerRebuild -> dispatches
      { status: 204 },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    // Step 1: get main SHA
    const mainSha = await service.getRef('main');
    expect(mainSha).toBe('main-sha-abc');

    // Step 2: check staging exists
    const stagingSha = await service.getRef('staging');
    expect(stagingSha).not.toBeNull();

    // Step 3: force-update staging
    await service.updateRef('staging', mainSha!, true);

    // Step 6: trigger rebuild
    await service.triggerRebuild();

    // Verify the dispatch event type is staging-data-updated
    const dispatchBody = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(dispatchBody.event_type).toBe('staging-data-updated');

    expect(fetchMock).toHaveBeenCalledTimes(4);

    vi.unstubAllGlobals();
  });

  it('sync workflow: creates staging branch when it does not exist', async () => {
    const service = new GitService(TEST_CONFIG);

    const fetchMock = mockFetch([
      // getRef('main') -> returns main SHA
      { status: 200, body: { object: { sha: 'main-sha-xyz' } } },
      // getRef('staging') -> 404, doesn't exist
      { status: 404 },
      // createRef('staging', 'main-sha-xyz')
      { status: 201, body: { ref: 'refs/heads/staging' } },
      // triggerRebuild
      { status: 204 },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    // Step 1: get main SHA
    const mainSha = await service.getRef('main');
    expect(mainSha).toBe('main-sha-xyz');

    // Step 2: check staging exists
    const stagingSha = await service.getRef('staging');
    expect(stagingSha).toBeNull();

    // Step 4: create staging branch
    await service.createRef('staging', mainSha!);

    // Verify createRef call
    const createBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(createBody.ref).toBe('refs/heads/staging');
    expect(createBody.sha).toBe('main-sha-xyz');

    // Step 6: trigger rebuild
    await service.triggerRebuild();

    expect(fetchMock).toHaveBeenCalledTimes(4);

    vi.unstubAllGlobals();
  });

  it('sync workflow: fails gracefully when main branch is not found', async () => {
    const service = new GitService(TEST_CONFIG);

    const fetchMock = mockFetch([
      // getRef('main') -> 404
      { status: 404 },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const mainSha = await service.getRef('main');
    expect(mainSha).toBeNull();

    // The endpoint would return a 500 error at this point
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
