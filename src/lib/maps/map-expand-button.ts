/**
 * Map expand button — adds a toggle button to grow/shrink a map container.
 *
 * Desktop: toggles container height between compact and expanded.
 * Mobile: goes fullscreen (fixed positioning, 100vw/100vh).
 *
 * Reusable — not tied to a specific page. Requires a MapLibre map instance
 * and the container element.
 */

import type maplibregl from 'maplibre-gl';

export interface MapExpandButtonOptions {
  /** Compact height in px (the default state). */
  compactHeight: number;
  /** Expanded height in px (desktop only — mobile always goes fullscreen). */
  expandedHeight: number;
  /** Optional callback after expand completes. */
  onExpand?: () => void;
  /** Optional callback after collapse completes. */
  onCollapse?: () => void;
}

const TRANSITION_MS = 350;
const MOBILE_MQ = '(max-width: 800px)';

export function createMapExpandButton(
  map: maplibregl.Map,
  container: HTMLElement,
  opts: MapExpandButtonOptions,
) {
  let expanded = false;
  let savedRect: DOMRect | null = null;

  // Create the button
  const btn = document.createElement('button');
  btn.className = 'map-expand-btn';
  btn.setAttribute('aria-label', 'Expand map');
  btn.innerHTML = '&#x26F6;'; // ⛶ square with corners
  container.style.position = 'relative';
  container.appendChild(btn);

  function expand() {
    if (expanded) return;
    expanded = true;
    btn.innerHTML = '&#x2715;'; // ✕
    btn.setAttribute('aria-label', 'Collapse map');
    container.classList.add('map-expanded');

    const isMobile = window.matchMedia(MOBILE_MQ).matches;

    if (isMobile) {
      // Fullscreen: save rect, go fixed
      savedRect = container.getBoundingClientRect();
      container.style.position = 'fixed';
      container.style.top = `${savedRect.top}px`;
      container.style.left = `${savedRect.left}px`;
      container.style.width = `${savedRect.width}px`;
      container.style.height = `${savedRect.height}px`;
      container.style.zIndex = '1000';
      requestAnimationFrame(() => {
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '100vw';
        container.style.height = '100vh';
        container.style.borderRadius = '0';
      });
    } else {
      // Desktop: just grow height
      container.style.height = `${opts.expandedHeight}px`;
    }

    setTimeout(() => {
      map.resize();
      opts.onExpand?.();
    }, TRANSITION_MS);
  }

  function collapse() {
    if (!expanded) return;
    expanded = false;
    btn.innerHTML = '&#x26F6;';
    btn.setAttribute('aria-label', 'Expand map');
    container.classList.remove('map-expanded');

    const isMobile = window.matchMedia(MOBILE_MQ).matches;

    if (isMobile && savedRect) {
      // Animate back to original rect
      container.style.top = `${savedRect.top}px`;
      container.style.left = `${savedRect.left}px`;
      container.style.width = `${savedRect.width}px`;
      container.style.height = `${savedRect.height}px`;
      setTimeout(() => {
        container.style.position = 'relative';
        container.style.top = '';
        container.style.left = '';
        container.style.width = '';
        container.style.height = `${opts.compactHeight}px`;
        container.style.zIndex = '';
        container.style.borderRadius = '';
        map.resize();
        opts.onCollapse?.();
      }, TRANSITION_MS);
    } else {
      container.style.height = `${opts.compactHeight}px`;
      setTimeout(() => {
        map.resize();
        opts.onCollapse?.();
      }, TRANSITION_MS);
    }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (expanded) collapse();
    else expand();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && expanded) collapse();
  });

  return { expand, collapse, isExpanded: () => expanded };
}
