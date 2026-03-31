/**
 * Touch-lock behavior for embedded maps.
 *
 * On mobile: disables drag pan and shows a two-tap overlay.
 *   First tap primes (shows label), second tap activates the map.
 *   Scrolling away resets the primed state.
 *
 * On desktop: enables drag pan immediately, enables scroll zoom
 *   after the first drag interaction.
 */
import type { Map as MaplibreMap } from 'maplibre-gl';

export function setupMapTouchLock(map: MaplibreMap, overlayEl: HTMLElement | null): void {
  map.scrollZoom.disable();
  map.doubleClickZoom.disable();
  map.touchZoomRotate.disable();

  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  if (isMobile) {
    map.dragPan.disable();
    if (overlayEl) {
      let primed = false;

      overlayEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!primed) {
          primed = true;
          overlayEl.classList.add('primed');
        } else {
          overlayEl.classList.add('dismissed');
          map.dragPan.enable();
          map.touchZoomRotate.enable();
        }
      });

      let scrollTimer: ReturnType<typeof setTimeout> | null = null;
      window.addEventListener('scroll', () => {
        if (primed && !overlayEl.classList.contains('dismissed')) {
          if (scrollTimer) clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => {
            primed = false;
            overlayEl.classList.remove('primed');
          }, 300);
        }
      }, { passive: true });
    }
  } else {
    map.dragPan.enable();
    overlayEl?.remove();

    map.on('dragstart', () => {
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
    });
  }
}
