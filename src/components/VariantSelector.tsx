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

export default function VariantSelector({ variants, initialVariant }: Props) {
  // Check URL for ?variant= param (used by map page redirects)
  const urlVariant = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('variant') || undefined
    : undefined;
  const startKey = urlVariant && variants.some(v => v.key === urlVariant) ? urlVariant : initialVariant || variants[0]?.key || '';
  const [active, setActive] = useState(startKey);

  // Dispatch variant:change on mount if URL had a variant param
  useEffect(() => {
    if (urlVariant && urlVariant !== (variants[0]?.key || '') && variants.some(v => v.key === urlVariant)) {
      window.dispatchEvent(new CustomEvent('variant:change', { detail: { key: urlVariant } }));
    }
  }, []);

  function select(key: string) {
    setActive(key);
    window.dispatchEvent(new CustomEvent('variant:change', { detail: { key } }));
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
