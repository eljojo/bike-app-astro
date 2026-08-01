// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useEditorState } from '../src/components/admin/useEditorState';

type EditorState = ReturnType<typeof useEditorState>;

// Plain object, not `new Response()` — avoids depending on the happy-dom
// environment's fetch globals (unlike guest-fetch.test.ts, which runs node-env).
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Test harness that exposes hook result for assertions, mirroring use-editor-form.test.tsx */
function TestEditor(props: {
  contentId: string | null;
  initialContentHash?: string;
  buildPayload: () => Record<string, unknown> | null;
  onResult: (r: EditorState) => void;
}) {
  const result = useEditorState({
    apiBase: '/api/test',
    contentId: props.contentId,
    initialContentHash: props.initialContentHash,
    buildPayload: props.buildPayload,
  });

  props.onResult(result);

  return <div />;
}

function renderInto(vnode: preact.VNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(vnode, container);
  });
  return container;
}

function cleanup(container: HTMLElement) {
  act(() => {
    render(null, container);
  });
  container.remove();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useEditorState.save', () => {
  it('carries the server-returned contentHash into the second save, not the initial one', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: 'test-slug', contentHash: 'hash-2' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'test-slug', contentHash: 'hash-3' }));
    vi.stubGlobal('fetch', fetchMock);

    let captured: EditorState | undefined;
    const container = renderInto(
      <TestEditor
        contentId="test-slug"
        initialContentHash="hash-1"
        buildPayload={() => ({ title: 'Test' })}
        onResult={(r) => { captured = r; }}
      />,
    );

    await act(async () => {
      await captured!.save();
    });
    await act(async () => {
      await captured!.save();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.contentHash).toBe('hash-1');
    // Regression guard: the second save must adopt the hash the first response
    // returned, not resend the stale initial hash — see _ctx/preact-islands.md.
    expect(secondBody.contentHash).toBe('hash-2');
    expect(captured!.contentHash).toBe('hash-3');

    cleanup(container);
  });

  it('409 conflict: saving flips false, error+githubUrl set from response, contentHash untouched', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(409, {
        error: 'Someone else edited this',
        conflict: true,
        githubUrl: 'https://github.com/example/pull/1',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    let captured: EditorState | undefined;
    const container = renderInto(
      <TestEditor
        contentId="test-slug"
        initialContentHash="hash-1"
        buildPayload={() => ({ title: 'Test' })}
        onResult={(r) => { captured = r; }}
      />,
    );

    await act(async () => {
      await captured!.save();
    });

    expect(captured!.saving).toBe(false);
    expect(captured!.error).toBe('Someone else edited this');
    expect(captured!.githubUrl).toBe('https://github.com/example/pull/1');
    expect(captured!.contentHash).toBe('hash-1');

    cleanup(container);
  });

  it('non-409 error response: error set from body.error, saving false', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(500, { error: 'Internal error' }));
    vi.stubGlobal('fetch', fetchMock);

    let captured: EditorState | undefined;
    const container = renderInto(
      <TestEditor
        contentId="test-slug"
        initialContentHash="hash-1"
        buildPayload={() => ({ title: 'Test' })}
        onResult={(r) => { captured = r; }}
      />,
    );

    await act(async () => {
      await captured!.save();
    });

    expect(captured!.saving).toBe(false);
    expect(captured!.error).toBe('Internal error');

    cleanup(container);
  });

  it('401 mints a guest and retries: guestCreated flips true, save succeeds', async () => {
    let targetCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/guest') return jsonResponse(200, { success: true });
      targetCalls++;
      return targetCalls === 1
        ? jsonResponse(401, { error: 'Unauthorized' })
        : jsonResponse(200, { id: 'test-slug', contentHash: 'hash-2' });
    });
    vi.stubGlobal('fetch', fetchMock);

    let captured: EditorState | undefined;
    const container = renderInto(
      <TestEditor
        contentId="test-slug"
        initialContentHash="hash-1"
        buildPayload={() => ({ title: 'Test' })}
        onResult={(r) => { captured = r; }}
      />,
    );

    expect(captured!.guestCreated).toBe(false);

    await act(async () => {
      await captured!.save();
    });

    expect(captured!.guestCreated).toBe(true);
    expect(captured!.saving).toBe(false);
    expect(captured!.contentHash).toBe('hash-2');
    expect(targetCalls).toBe(2); // initial 401 + retry

    cleanup(container);
  });

  it('create-flow success (contentId null) leaves saving true — caller navigates away on onSuccess', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { id: 'new-slug', contentHash: 'hash-1' }));
    vi.stubGlobal('fetch', fetchMock);

    let captured: EditorState | undefined;
    const container = renderInto(
      <TestEditor
        contentId={null}
        buildPayload={() => ({ title: 'Test' })}
        onResult={(r) => { captured = r; }}
      />,
    );

    await act(async () => {
      await captured!.save();
    });

    // Intentional, not a bug: for creates, useEditorState.ts keeps `saving=true` after
    // success so a stray click during post-save navigation can't fire a second POST —
    // see the comment above the `if (contentId !== null)` guard in save().
    expect(captured!.saving).toBe(true);
    expect(captured!.saved).toBe(true);

    cleanup(container);
  });
});
