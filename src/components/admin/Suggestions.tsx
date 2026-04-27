import { useEffect, useState } from 'preact/hooks';

/**
 * Generic shape any suggestions endpoint must return. The producer (e.g. the
 * calendar-suggestions endpoint) is responsible for projecting its
 * domain-specific data into this shape — formatting dates in the right
 * timezone, building hrefs, naming the dismiss payload fields. This component
 * never parses dates or builds URLs.
 */
export interface SuggestionItem {
  /** Stable React key + dismissal correlation handle. */
  id: string;
  title: string;
  /** Pre-formatted secondary text. Producer-side formatting only. */
  meta: string;
  href: string;
  /** JSON body POSTed to dismissUrl when the user dismisses this item. */
  dismissPayload: Record<string, string>;
}

interface Props {
  loadUrl: string;
  dismissUrl: string;
  heading: string;
}

/**
 * Reusable suggestions widget. Loads from `loadUrl`, renders rows, and
 * dismisses by POSTing each item's `dismissPayload` to `dismissUrl`. Has no
 * knowledge of what the suggestions are about — calendars, route renames, or
 * anything else. The hosting page provides URLs and a heading; the
 * suggestions endpoint owns formatting and href construction.
 */
export default function Suggestions({ loadUrl, dismissUrl, heading }: Props) {
  const [items, setItems] = useState<SuggestionItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(loadUrl)
      .then(r => r.ok ? r.json() : null)
      .then((data: { suggestions: SuggestionItem[] } | null) => {
        if (!cancelled) setItems(data?.suggestions ?? []);
      })
      .catch(err => { console.error('Failed to load suggestions', err); });
    return () => { cancelled = true; };
  }, [loadUrl]);

  async function dismiss(item: SuggestionItem) {
    const prev = items;
    setItems((items ?? []).filter(x => x.id !== item.id));
    const res = await fetch(dismissUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.dismissPayload),
    });
    if (!res.ok) {
      console.error('Dismiss failed', res.status);
      setItems(prev);
    }
  }

  if (!items || items.length === 0) return null;

  return (
    <div class="admin-sidebar-section">
      <h4 class="admin-sidebar-heading">{heading}</h4>
      <div class="admin-sidebar-list">
        {items.map(item => (
          <div class="admin-sidebar-item suggestion-item" key={item.id}>
            <a href={item.href}>
              <span class="suggestion-name">{item.title}</span>
              <span class="suggestion-meta">{item.meta}</span>
            </a>
            <button type="button" class="suggestion-dismiss" aria-label="Dismiss suggestion" onClick={() => dismiss(item)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
