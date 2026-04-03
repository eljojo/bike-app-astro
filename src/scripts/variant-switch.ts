// Variant coordination — persistent state + show/hide elements with data-variant
function setupVariantSwitch() {
  const variantElements = document.querySelectorAll<HTMLElement>('[data-variant]');
  if (variantElements.length === 0) return;

  // Collect all unique variant keys
  const allKeys = new Set<string>();
  for (const el of variantElements) {
    if (el.dataset.variant) allKeys.add(el.dataset.variant);
  }

  // Initial variant: use first key found
  const initialKey = variantElements[0]?.dataset.variant || '';

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

  // Listen for changes
  window.addEventListener('variant:change', ((e: CustomEvent) => {
    showVariant(e.detail.key);
  }) as EventListener);
}

setupVariantSwitch();
