// Variant coordination — persistent state + show/hide elements with data-variant
function setupVariantSwitch() {
  const variantElements = document.querySelectorAll<HTMLElement>('[data-variant]');
  if (variantElements.length === 0) return;

  // Collect all unique variant keys
  const allKeys = new Set<string>();
  for (const el of variantElements) {
    if (el.dataset.variant) allKeys.add(el.dataset.variant);
  }

  // Initial variant: URL ?variant= param takes priority (permalink/redirect),
  // otherwise use first key found. No hydration delay — runs before Preact.
  // Accepts both slug ("cyclotour") and full key ("variants-cyclotour").
  const urlVariant = new URLSearchParams(location.search).get('variant');
  const defaultKey = variantElements[0]?.dataset.variant || '';
  let resolvedKey = '';
  if (urlVariant) {
    if (allKeys.has(urlVariant)) resolvedKey = urlVariant;
    else {
      for (const k of allKeys) {
        if (k.replace(/^variants-/, '') === urlVariant) { resolvedKey = k; break; }
      }
    }
  }
  const initialKey = resolvedKey || defaultKey;

  // Persistent state — other scripts can read this
  (window as Window & { __currentVariant?: string }).__currentVariant = initialKey;

  function showVariant(key: string) {
    (window as Window & { __currentVariant?: string }).__currentVariant = key;
    for (const el of variantElements) {
      el.style.display = el.dataset.variant === key ? '' : 'none';
    }
  }

  // Show initial state
  showVariant(initialKey);

  // Always broadcast current variant so map/islands sync on load
  window.dispatchEvent(new CustomEvent('variant:change', { detail: { key: initialKey } }));

  // Listen for changes
  window.addEventListener('variant:change', ((e: CustomEvent) => {
    showVariant(e.detail.key);
  }) as EventListener);
}

setupVariantSwitch();
