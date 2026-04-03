/**
 * Expandable map card — shared expand/collapse logic for inline maps.
 *
 * The map has two modes:
 *   compact  — polyline only, no interaction, no controls
 *   expanded — full map with interactions, controls, layers
 *
 * The mode is the single source of truth. Everything flows from setMode().
 */

import type maplibregl from 'maplibre-gl';

export type MapMode = 'compact' | 'expanded';

export interface ExpandableMapElements {
  card: HTMLElement;
  overlay: HTMLElement;
  closeBtn: HTMLElement;
}

export interface ExpandableMapCallbacks {
  /** Called when mode changes. Component wires up layer show/hide here. */
  onModeChange: (mode: MapMode) => void;
  /** Return bounds for fitBounds after expand/collapse. */
  getBounds: () => maplibregl.LngLatBoundsLike | null;
}

const TRANSITION_MS = 350;

export function createExpandableMap(
  map: maplibregl.Map,
  els: ExpandableMapElements,
  callbacks: ExpandableMapCallbacks,
) {
  let mode: MapMode = 'compact';
  let savedRect: DOMRect | null = null;
  const { card, overlay, closeBtn } = els;

  function setMode(newMode: MapMode) {
    mode = newMode;

    if (mode === 'compact') {
      map.scrollZoom.disable();
      map.dragPan.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
      closeBtn.style.display = 'none';
    } else {
      map.scrollZoom.enable();
      map.dragPan.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
      closeBtn.style.display = 'flex';
    }

    callbacks.onModeChange(mode);
  }

  function expand() {
    if (mode === 'expanded') return;
    savedRect = card.getBoundingClientRect();
    card.style.position = 'fixed';
    card.style.top = `${savedRect.top}px`;
    card.style.left = `${savedRect.left}px`;
    card.style.width = `${savedRect.width}px`;
    card.style.height = `${savedRect.height}px`;
    card.style.zIndex = '1000';
    overlay.classList.add('visible');
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
    setMode('expanded');
    setTimeout(() => {
      map.resize();
      const bounds = callbacks.getBounds();
      if (bounds) map.fitBounds(bounds, { padding: 60, animate: false });
    }, TRANSITION_MS);
  }

  function collapse() {
    if (mode === 'compact') return;
    setMode('compact');
    card.classList.remove('expanded');
    card.setAttribute('aria-expanded', 'false');
    overlay.classList.remove('visible');
    if (savedRect) {
      card.style.top = `${savedRect.top}px`;
      card.style.left = `${savedRect.left}px`;
      card.style.width = `${savedRect.width}px`;
      card.style.height = `${savedRect.height}px`;
      card.style.borderRadius = '';
    }
    setTimeout(() => {
      card.style.position = '';
      card.style.top = '';
      card.style.left = '';
      card.style.width = '';
      card.style.height = '';
      card.style.zIndex = '';
      card.style.borderRadius = '';
      map.resize();
      const bounds = callbacks.getBounds();
      if (bounds) map.fitBounds(bounds, { padding: 20, animate: false });
    }, TRANSITION_MS);
  }

  // Wire up events
  card.addEventListener('click', (e) => {
    if (mode === 'expanded') return;
    if ((e.target as HTMLElement).closest('.maplibregl-popup')) return;
    if (card.querySelector('.maplibregl-popup')) return;
    expand();
  });
  card.addEventListener('keydown', (e) => {
    if (mode === 'compact' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); expand(); }
  });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); collapse(); });
  overlay.addEventListener('click', collapse);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mode === 'expanded') collapse(); });

  // Start in compact mode
  setMode('compact');

  return { expand, collapse, getMode: () => mode };
}
