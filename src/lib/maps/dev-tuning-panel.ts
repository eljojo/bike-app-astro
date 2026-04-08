import type { Map } from 'maplibre-gl';
import { setBaseCyclingOpacity } from './base-layer-control';

const FG_LINES = ['paths-network-line', 'paths-network-line-dashed'];
const BG_LINES = ['paths-network-bg', 'paths-network-bg-dashed'];
const ALL_PATH_LINES = [...FG_LINES, ...BG_LINES];

function slider(id: string, valId: string, fmt: (v: number) => string, handler: (v: number) => void) {
  const input = document.getElementById(id) as HTMLInputElement | null;
  const display = document.getElementById(valId);
  input?.addEventListener('input', () => {
    const raw = parseInt(input.value);
    handler(raw);
    if (display) display.textContent = fmt(raw);
  });
}

/** Wire up the dev tuning panel. Returns a show/hide callback. */
export function initDevTuningPanel(map: Map): (show: boolean) => void {
  const tuningEl = document.getElementById('map-tuning');

  slider('t-base-opacity', 't-base-opacity-val', v => (v / 100).toFixed(2), v => {
    setBaseCyclingOpacity(map, v / 100);
  });

  slider('t-fg-width', 't-fg-width-val', v => (v / 10).toFixed(1), v => {
    for (const id of FG_LINES) if (map.getLayer(id)) map.setPaintProperty(id, 'line-width', v / 10);
  });

  slider('t-fg-opacity', 't-fg-opacity-val', v => (v / 100).toFixed(2), v => {
    for (const id of FG_LINES) if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', v / 100);
  });

  slider('t-bg-width', 't-bg-width-val', v => (v / 10).toFixed(1), v => {
    for (const id of BG_LINES) if (map.getLayer(id)) map.setPaintProperty(id, 'line-width', v / 10);
  });

  slider('t-bg-opacity', 't-bg-opacity-val', v => (v / 100).toFixed(2), v => {
    for (const id of BG_LINES) if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', v / 100);
  });

  const colorInput = document.getElementById('t-path-color') as HTMLInputElement | null;
  colorInput?.addEventListener('input', () => {
    for (const id of ALL_PATH_LINES) {
      if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', colorInput.value);
    }
  });

  document.getElementById('t-log-values')?.addEventListener('click', () => {
    const vals = {
      baseCyclingOpacity: parseFloat(document.getElementById('t-base-opacity-val')!.textContent!),
      pathInteractiveWidth: parseFloat(document.getElementById('t-fg-width-val')!.textContent!),
      pathInteractiveOpacity: parseFloat(document.getElementById('t-fg-opacity-val')!.textContent!),
      pathOtherWidth: parseFloat(document.getElementById('t-bg-width-val')!.textContent!),
      pathOtherOpacity: parseFloat(document.getElementById('t-bg-opacity-val')!.textContent!),
      pathColor: colorInput?.value ?? '#350091',
    };
    console.log('[map-tuning]', JSON.stringify(vals, null, 2));
    navigator.clipboard?.writeText(JSON.stringify(vals, null, 2));
    const btn = document.getElementById('t-log-values')!;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Log current values'; }, 1500);
  });

  return (show: boolean) => {
    if (tuningEl) tuningEl.style.display = show ? 'block' : 'none';
  };
}
