// src/lib/maps/map-path-card.ts
//
// Centralized floating "path card" element used by the paths-browse map
// (/bike-paths index) and the BigMap (/map with the paths tab active).
// The card is a status widget showing information about the currently-
// locked path — name, surface mix, parent entry when the click resolved
// to a named sub-section, and related metadata — anchored at the bottom
// of the map container.
//
// The card DOM is created once and updated in place so that switching
// between paths swaps content without flicker. Dismissed by:
//
//   1. clicking the × close button inside the card,
//   2. clicking outside the configured `outsideClickScope` (when set),
//      or outside the card when no scope is set,
//   3. the caller calling `handle.hide()` directly — e.g. from a
//      `setupPathHighlight` `onLockChange(false)` callback.
//
// The inner HTML is provided by `buildPathCardContent` in `map-helpers.ts`
// (shared between both callers). This module is purely about the
// container, lifecycle, and dismiss semantics.

export interface MapPathCardOptions {
  /** DOM element the card is appended to — typically the map element itself. */
  container: HTMLElement;
  /**
   * Called when the user dismisses the card (× click OR outside click).
   * Callers typically wire this to their highlight lock's `unlock()`
   * method so the card hides indirectly via the `onLockChange` flow —
   * keeping the card's visibility coupled to the lock state rather
   * than to individual DOM events.
   */
  onClose: () => void;
  /**
   * CSS selector for the "inside" scope. Clicks on any element matching
   * this selector (or its descendants) will NOT dismiss the card. Use
   * this when the card is part of a larger interactive widget — e.g.
   * paths-browse pairs the card with a sidebar list, and clicks on the
   * list should not dismiss the card.
   *
   * When omitted, only clicks on the card itself (and its children) are
   * treated as "inside". Anything else on the document dismisses.
   */
  outsideClickScope?: string;
  /**
   * Localized label for the close (×) button — used as both `aria-label`
   * and `title`. Callers on fr/es instances should pass the translated
   * `paths.clear_selection` string. Falls back to English when omitted
   * so that tests and single-locale callers don't have to plumb it.
   */
  closeLabel?: string;
}

export interface MapPathCardHandle {
  /** The outer `.map-path-card` element. Exposed for callers that need
   *  its dimensions (e.g. to compute fitBounds padding). */
  element: HTMLElement;
  /** Update the card's inner HTML and mark it visible. */
  show(html: string): void;
  /** Mark the card hidden. Idempotent. */
  hide(): void;
  /** Remove listeners and detach the card from the DOM. */
  destroy(): void;
}

export function createMapPathCard(opts: MapPathCardOptions): MapPathCardHandle {
  const card = document.createElement('div');
  card.className = 'map-path-card';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');

  const content = document.createElement('div');
  content.className = 'map-path-card-content';
  card.appendChild(content);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'map-path-card-close';
  close.innerHTML = '&#x2715;'; // ✕
  const closeLabel = opts.closeLabel ?? 'Clear selection';
  close.setAttribute('aria-label', closeLabel);
  close.title = closeLabel;
  card.appendChild(close);

  opts.container.appendChild(card);

  const onCloseClick = (e: Event) => {
    e.stopPropagation();
    opts.onClose();
  };
  close.addEventListener('click', onCloseClick);

  const onDocumentClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Clicks on the card itself should never dismiss — that would make
    // the card eat its own lifecycle. The × button has its own listener.
    if (target.closest('.map-path-card')) return;
    // If an inside-scope is configured, clicks inside it are part of
    // the same widget as the card and do not dismiss.
    if (opts.outsideClickScope && target.closest(opts.outsideClickScope)) return;
    opts.onClose();
  };
  document.addEventListener('click', onDocumentClick);

  return {
    element: card,
    show(html: string) {
      content.innerHTML = html;
      card.classList.add('map-path-card--visible');
    },
    hide() {
      card.classList.remove('map-path-card--visible');
    },
    destroy() {
      close.removeEventListener('click', onCloseClick);
      document.removeEventListener('click', onDocumentClick);
      card.remove();
    },
  };
}
