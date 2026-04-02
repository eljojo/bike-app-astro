// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { useEditorForm } from '../src/components/admin/useEditorForm';
import type { UseEditorFormResult } from '../src/components/admin/useEditorForm';

// Mock fetch globally since useEditorState uses it
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Test harness that exposes hook result for assertions */
function TestEditor(props: {
  deps: unknown[];
  initialBody?: string;
  onResult: (r: UseEditorFormResult) => void;
}) {
  const result = useEditorForm({
    apiBase: '/api/test',
    contentId: 'test-slug',
    deps: props.deps,
    initialBody: props.initialBody,
    buildPayload: () => ({ title: 'Test' }),
  });

  props.onResult(result);

  return (
    <div ref={result.hydratedRef}>
      <textarea ref={result.bodyRef} />
    </div>
  );
}

/** Helper: render into a fresh container using act() to flush effects */
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

describe('useEditorForm', () => {
  it('dirty stays false on initial render', () => {
    let captured: UseEditorFormResult | undefined;
    const container = renderInto(
      <TestEditor
        deps={['a']}
        onResult={(r) => { captured = r; }}
      />,
    );

    expect(captured).toBeDefined();
    expect(captured!.dirty).toBe(false);

    cleanup(container);
  });

  it('dirty becomes true when deps change', () => {
    let captured: UseEditorFormResult | undefined;

    function Wrapper() {
      const [val, setVal] = useState('a');
      return (
        <div>
          <TestEditor
            deps={[val]}
            onResult={(r) => { captured = r; }}
          />
          <button onClick={() => setVal('b')}>change</button>
        </div>
      );
    }

    const container = renderInto(<Wrapper />);
    expect(captured!.dirty).toBe(false);

    // Trigger dep change inside act() to flush state + effects
    act(() => {
      const button = container.querySelector('button')!;
      button.click();
    });

    expect(captured!.dirty).toBe(true);

    cleanup(container);
  });

  it('sets data-hydrated on mount', () => {
    let captured: UseEditorFormResult | undefined;
    const container = renderInto(
      <TestEditor
        deps={[]}
        onResult={(r) => { captured = r; }}
      />,
    );

    expect(captured).toBeDefined();
    const root = container.querySelector('[data-hydrated]');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('data-hydrated')).toBe('true');

    cleanup(container);
  });

  it('bodyRef applies textarea hydration fix', () => {
    let captured: UseEditorFormResult | undefined;
    const container = renderInto(
      <TestEditor
        deps={[]}
        initialBody="Hello world"
        onResult={(r) => { captured = r; }}
      />,
    );

    expect(captured).toBeDefined();
    // The useTextareaValue hook sets value when textarea is empty after mount
    const textarea = container.querySelector('textarea')!;
    expect(textarea.value).toBe('Hello world');

    cleanup(container);
  });

  it('activeTab defaults to edit', () => {
    let captured: UseEditorFormResult | undefined;
    const container = renderInto(
      <TestEditor
        deps={[]}
        onResult={(r) => { captured = r; }}
      />,
    );

    expect(captured).toBeDefined();
    expect(captured!.activeTab).toBe('edit');

    cleanup(container);
  });
});
