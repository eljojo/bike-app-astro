/**
 * Expandable map card — shared expand/collapse for inline maps.
 *
 * Compact: polyline only, interactions disabled, controls CSS-hidden.
 * Expanded: full map, interactions enabled, close button visible.
 *
 * This is a direct extraction of the proven BikePathMap expand/collapse pattern.
 * It was battle-tested before extraction — don't add cleverness.
 */

import type maplibregl from 'maplibre-gl';

export interface ExpandableMapElements {
  card: HTMLElement;
  glEl: HTMLElement;
  overlay: HTMLElement;
  closeBtn: HTMLElement;
}

export interface ExpandableMapCallbacks {
  /** Return bounds for fitBounds after expand/collapse. Must return a LngLatBounds with .isEmpty(). */
  getBounds: () => maplibregl.LngLatBounds | null;
}

const TRANSITION_MS = 350;

export function createExpandableMap(
  map: maplibregl.Map,
  els: ExpandableMapElements,
  callbacks: ExpandableMapCallbacks,
) {
  const { card, glEl, overlay, closeBtn } = els;
  let expanded = false;
  let savedRect: DOMRect | null = null;

  // Start in compact mode — disable interactions
  map.scrollZoom.disable();
  map.dragPan.disable();
  map.doubleClickZoom.disable();
  map.touchZoomRotate.disable();

  function expand() {
    if (expanded) return;
    expanded = true;
    glEl.classList.add('fading');
    savedRect = card.getBoundingClientRect();
    card.style.position = 'fixed';
    card.style.top = `${savedRect.top}px`;
    card.style.left = `${savedRect.left}px`;
    card.style.width = `${savedRect.width}px`;
    card.style.height = `${savedRect.height}px`;
    card.style.zIndex = '1000';
    overlay.classList.add('visible');
    closeBtn.style.display = 'flex';
    card.setAttribute('aria-expanded', 'true');
    const isMobile = window.matchMedia('(max-width: 800px)').matches;
    requestAnimationFrame(() => {
      card.classList.add('expanded');
      if (isMobile) {
        card.style.top = '0';
        card.style.left = '0';
        card.style.width = '100vw';
        card.style.height = '100vh';
        card.style.borderRadius = '0';
      } else {
        card.style.top = '20px';
        card.style.left = '20px';
        card.style.width = 'calc(100vw - 40px)';
        card.style.height = 'calc(100vh - 40px)';
        card.style.borderRadius = '16px';
      }
    });
    map.scrollZoom.enable();
    map.dragPan.enable();
    map.doubleClickZoom.enable();
    map.touchZoomRotate.enable();
    setTimeout(() => {
      map.resize();
      const b = callbacks.getBounds();
      if (b && !b.isEmpty()) map.fitBounds(b, { padding: 60, animate: false });
      requestAnimationFrame(() => glEl.classList.remove('fading'));
    }, TRANSITION_MS);
  }

  function collapse() {
    if (!expanded) return;
    expanded = false;
    glEl.classList.add('fading');
    card.classList.remove('expanded');
    card.setAttribute('aria-expanded', 'false');
    overlay.classList.remove('visible');
    closeBtn.style.display = 'none';
    if (savedRect) {
      card.style.top = `${savedRect.top}px`;
      card.style.left = `${savedRect.left}px`;
      card.style.width = `${savedRect.width}px`;
      card.style.height = `${savedRect.height}px`;
      const isMobile = window.matchMedia('(max-width: 800px)').matches;
      card.style.borderRadius = isMobile ? '8px' : '12px';
    }
    map.scrollZoom.disable();
    map.dragPan.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();
    setTimeout(() => {
      card.style.position = '';
      card.style.top = '';
      card.style.left = '';
      card.style.width = '';
      card.style.height = '';
      card.style.zIndex = '';
      card.style.borderRadius = '';
      map.resize();
      const b = callbacks.getBounds();
      if (b && !b.isEmpty()) map.fitBounds(b, { padding: 20, animate: false });
      requestAnimationFrame(() => glEl.classList.remove('fading'));
    }, TRANSITION_MS);
  }

  // Event wiring
  card.addEventListener('click', (e) => {
    if (expanded) return;
    const target = e.target as HTMLElement;
    if (target.closest('.maplibregl-popup')) return;
    if (card.querySelector('.maplibregl-popup')) return;
    expand();
  });
  card.addEventListener('keydown', (e) => {
    if (!expanded && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); expand(); }
  });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); collapse(); });
  overlay.addEventListener('click', collapse);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded) collapse(); });

  return { expand, collapse, isExpanded: () => expanded };
}
