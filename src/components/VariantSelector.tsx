import { useState } from 'preact/hooks';

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
  const [active, setActive] = useState(initialVariant || variants[0]?.key || '');

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
