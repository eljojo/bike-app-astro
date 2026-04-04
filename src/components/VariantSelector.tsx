import { useState, useEffect } from 'preact/hooks';

interface VariantOption {
  key: string;
  name: string;
  summary: string;
}

interface Props {
  variants: VariantOption[];
  initialVariant?: string;
}

// "variants-cyclotour" → "cyclotour"
function keyToSlug(key: string): string {
  return key.replace(/^variants-/, '');
}

// "cyclotour" → find matching key (e.g. "variants-cyclotour")
function slugToKey(slug: string, variants: VariantOption[]): string | undefined {
  return variants.find(v => v.key === slug || keyToSlug(v.key) === slug)?.key;
}

export default function VariantSelector({ variants, initialVariant }: Props) {
  const [active, setActive] = useState(initialVariant || variants[0]?.key || '');

  // Read URL ?variant= after hydration — accepts slug ("cyclotour") or full key ("variants-cyclotour")
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('variant');
    if (!param) return;
    const key = slugToKey(param, variants);
    if (key && key !== active) {
      setActive(key);
      window.dispatchEvent(new CustomEvent('variant:change', { detail: { key } }));
    }
  }, []);

  function select(key: string) {
    setActive(key);
    window.dispatchEvent(new CustomEvent('variant:change', { detail: { key } }));
    // Update URL with clean slug (no "variants-" prefix)
    const params = new URLSearchParams(window.location.search);
    if (key === (variants[0]?.key || '')) {
      params.delete('variant');
    } else {
      params.set('variant', keyToSlug(key));
    }
    const qs = params.toString();
    history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }

  if (variants.length <= 1) return null;

  return (
    <div class="variant-selector">
      {variants.map(v => (
        <button
          key={v.key}
          class={`variant-selector-btn ${v.key === active ? 'active' : ''}`}
          onClick={() => select(v.key)}
          type="button"
        >
          <span class="variant-selector-name">{v.name}</span>
          <span class="variant-selector-summary">{v.summary}</span>
        </button>
      ))}
    </div>
  );
}
