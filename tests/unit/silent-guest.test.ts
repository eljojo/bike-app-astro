import { describe, it, expect, vi } from 'vitest';

describe('silent guest session flow', () => {
  it('should retry reaction after creating guest session on 401', async () => {
    const calls: string[] = [];

    global.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
      calls.push(`${opts?.method || 'GET'} ${url}`);

      if (url === '/api/reactions' && calls.filter(c => c.startsWith('POST /api/reactions')).length === 1) {
        return new Response(null, { status: 401 });
      }
      if (url === '/api/auth/guest') {
        return new Response(JSON.stringify({ success: true, username: 'guest-123' }), { status: 200 });
      }
      if (url === '/api/reactions') {
        return new Response(JSON.stringify({ action: 'added' }), { status: 200 });
      }
      return new Response(JSON.stringify({ counts: {}, userReactions: [] }), { status: 200 });
    }) as typeof fetch;

    // Simulate the flow: first reaction POST -> 401 -> create guest -> retry reaction
    let res = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'route', contentSlug: 'test', reactionType: 'star' }),
    });

    if (res.status === 401) {
      const guestRes = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(guestRes.ok).toBe(true);

      res = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: 'route', contentSlug: 'test', reactionType: 'star' }),
      });
    }

    expect(res.ok).toBe(true);
    expect(calls).toEqual([
      'POST /api/reactions',
      'POST /api/auth/guest',
      'POST /api/reactions',
    ]);
  });
});
